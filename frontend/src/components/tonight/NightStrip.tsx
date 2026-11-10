import { useId, useState } from "react";
import type { ForecastPayload, HourlyRow, NightClear, NightSummary } from "../../api/types";
import { formatDuration, formatTime, localHour } from "../../lib/time";
import { useElementWidth } from "../../lib/useElementWidth";

const HOUR = 3600_000;
const QUARTER = 900_000;
const LABEL_H = 26;
const MOON_GAP = 4;
const MOON_H = 5;
const AXIS_H = 24;
const NARROW = 480;

interface Props {
  night: NightSummary;
  forecast: ForecastPayload;
  clear: NightClear | null;
  bestWindow: { start_utc: string; end_utc: string; minutes: number } | null;
  tz: string;
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
const pad2 = (n: number) => String(n).padStart(2, "0");
const num = (v: number | null) => (v === null ? null : Math.round(v));

/** Hour-by-hour dusk-to-dawn strip: sky bands, forecast cloud cells, clear run, best window, Moon band. */
export function NightStrip({ night, forecast, clear, bestWindow, tz }: Props) {
  const [boxRef, W] = useElementWidth<HTMLDivElement>(752);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [tip, setTip] = useState<string | null>(null);

  const narrow = W < NARROW;
  const barH = narrow ? 78 : 104;
  const barBottom = LABEL_H + barH;
  const moonY = barBottom + MOON_GAP;
  const tickY = moonY + MOON_H + 1;
  const H = tickY + AXIS_H;
  const labelEvery = narrow ? 3 : 2;

  const t0 = ms(night.display_start_utc) as number;
  const t1 = ms(night.display_end_utc) as number;
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => ((Math.min(Math.max(t, t0), t1) - t0) / span) * W;

  // sky gradient from the twilight events; the dark span comes from dark_intervals
  const ev = night.events;
  const darkStart = night.dark_intervals.length ? ms(night.dark_intervals[0].start_utc) : null;
  const darkEnd = night.dark_intervals.length ? ms(night.dark_intervals[night.dark_intervals.length - 1].end_utc) : null;
  const frac = (t: number | null) => (t === null ? null : Math.min(1, Math.max(0, (t - t0) / span)));
  const stopsRaw: [number | null, string][] = [
    [frac(ms(ev.sunset_utc)), "day"],
    [frac(ms(ev.civil_dusk_utc)), "civil"],
    [frac(ms(ev.nautical_dusk_utc)), "nautical"],
    [frac(darkStart ?? ms(ev.astronomical_dusk_utc)), "dark"],
    [frac(darkEnd ?? ms(ev.astronomical_dawn_utc)), "dark"],
    [frac(ms(ev.nautical_dawn_utc)), "nautical"],
    [frac(ms(ev.civil_dawn_utc)), "civil"],
    [frac(ms(ev.sunrise_utc)), "day"],
  ];
  const known = stopsRaw.filter((s): s is [number, string] => s[0] !== null).sort((a, b) => a[0] - b[0]);
  const stops: [number, string][] = known.length
    ? [[0, known[0][1] === "day" ? "day" : "nautical"], ...known, [1, "day"]]
    : [[0, "dark"], [1, "dark"]];

  // hourly cells in range
  const inRange = forecast.hourly.filter((h) => h.t_ms + HOUR > t0 && h.t_ms < t1);
  const hasHourly = inRange.length > 0;
  const rowAt = new Map(inRange.map((h) => [h.t_ms, h]));
  // One slot per hour of the displayed night: a forecast row, or a gap where the
  // forecast has no row (it ends mid-night). Gaps are drawn hatched, never as clear.
  const slots: { t: number; h: HourlyRow | null; xa: number; w: number }[] = [];
  if (hasHourly) {
    for (const h of inRange) slots.push({ t: h.t_ms, h, xa: x(h.t_ms), w: x(h.t_ms + HOUR) - x(h.t_ms) });
    for (let t = Math.floor(t0 / HOUR) * HOUR; t < t1; t += HOUR) {
      if (t + HOUR > t0 && !rowAt.has(t)) slots.push({ t, h: null, xa: x(t), w: x(t + HOUR) - x(t) });
    }
    slots.sort((a, b) => a.t - b.t);
  }

  // hour ticks at local whole hours (quarter-hour stepping handles :30 and :45 zones)
  const ticks: { t: number; label: string | null }[] = [];
  for (let t = Math.ceil(t0 / QUARTER) * QUARTER; t <= t1; t += QUARTER) {
    if (formatTime(t, tz).endsWith(":00")) {
      const hr = localHour(t, tz);
      ticks.push({ t, label: hr % labelEvery === 0 ? pad2(hr) : null });
    }
  }

  // Moon band: spans where the Moon is above the horizon
  const moonSegs: { a: number; b: number }[] = [];
  const { t_ms: st, moon_alt_deg: alt } = night.series;
  for (let i = 0; i < st.length; i++) {
    if (alt[i] > 0) {
      const a = Math.max(st[i], t0);
      const b = Math.min(i + 1 < st.length ? st[i + 1] : t1, t1);
      if (b <= a) continue;
      const last = moonSegs[moonSegs.length - 1];
      if (last && Math.abs(last.b - x(a)) < 0.01) last.b = x(b);
      else moonSegs.push({ a: x(a), b: x(b) });
    }
  }

  const clearA = clear ? ms(clear.start_utc) : null;
  const clearB = clear ? ms(clear.end_utc) : null;
  const showClear = hasHourly && clear && clearA !== null && clearB !== null && clearB > t0 && clearA < t1;
  const bestA = bestWindow ? ms(bestWindow.start_utc) : null;
  const bestB = bestWindow ? ms(bestWindow.end_utc) : null;
  const showBest = !!bestWindow && bestA !== null && bestB !== null && bestB > t0 && bestA < t1;

  const describe = (s: (typeof slots)[number]) => {
    if (!s.h) return `${formatTime(s.t, tz)}: No forecast`;
    const cloud = num(s.h.cloud_cover);
    const rain = num(s.h.precipitation_probability);
    if (cloud === null) return `${formatTime(s.t, tz)}: No forecast for cloud, rain chance ${rain === null ? "not available" : `${rain} %`}`;
    return `${formatTime(s.t, tz)}: cloud ${cloud} %, rain chance ${rain === null ? "not available" : `${rain} %`}`;
  };

  const readAt = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width > 0 ? W / rect.width : 1;
    const px = (e.clientX - rect.left) * scale;
    const hit = slots.find((c) => px >= c.xa && px < c.xa + c.w) ?? null;
    setTip(hit ? describe(hit) : null);
  };

  const clipId = `strip-clip-${uid}`;
  const gradId = `strip-sky-${uid}`;
  const hatchId = `strip-hatch-${uid}`;

  return (
    <div ref={boxRef} className="night-strip">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="Night from sunset to sunrise, hour by hour: forecast cloud cover, forecast-clear run, best window and Moon"
        style={{ display: "block", overflow: "visible", touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none" }}
      >
        <defs>
          <linearGradient id={gradId}>
            {stops.map(([o, k], i) => (
              <stop key={i} offset={o.toFixed(4)} style={{ stopColor: `var(--strip-${k})` }} />
            ))}
          </linearGradient>
          <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} strokeWidth={1.5} style={{ stroke: "var(--color-muted)" }} />
          </pattern>
          <clipPath id={clipId}>
            <rect x={0} y={LABEL_H} width={W} height={barH} rx={10} />
          </clipPath>
        </defs>
        <rect x={0} y={LABEL_H} width={W} height={barH} rx={10} fill={`url(#${gradId})`} />

        <g clipPath={`url(#${clipId})`}>
          {slots.map((c) => {
            const cloud = c.h ? c.h.cloud_cover : null;
            const w = Math.max(0, c.w - 1);
            return (
              <g key={c.t} {...(c.h ? { "data-cell": true } : { "data-gap": true })}>
                {cloud !== null ? (
                  <rect data-cloud x={c.xa + 0.5} y={LABEL_H} width={w} height={barH} style={{ fill: "var(--cloud)", opacity: (cloud / 100) * 0.82 }} />
                ) : (
                  <rect data-missing x={c.xa + 0.5} y={LABEL_H} width={w} height={barH} fill={`url(#${hatchId})`} opacity={0.55} />
                )}
              </g>
            );
          })}
        </g>

        {hasHourly && (
          <rect
            data-hit
            x={0}
            y={LABEL_H}
            width={W}
            height={barH}
            fill="transparent"
            style={{ cursor: "crosshair" }}
            onPointerMove={readAt}
            onPointerDown={readAt}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setTip(null);
            }}
          />
        )}

        {!hasHourly && (
          <text x={W / 2} y={LABEL_H + barH / 2} textAnchor="middle" dominantBaseline="middle" style={{ fill: "var(--color-ink)", fontSize: 12.5 }}>
            No forecast this far ahead
          </text>
        )}

        {showClear && (
          <g data-clearbar>
            <rect x={x(clearA as number)} y={13} width={Math.max(2, x(clearB as number) - x(clearA as number))} height={3} rx={1.5} style={{ fill: "var(--color-ice)" }} />
            <text
              x={(x(clearA as number) + x(clearB as number)) / 2}
              y={9}
              textAnchor="middle"
              style={{ fill: "var(--color-ice)", fontSize: 11, fontWeight: 600 }}
            >
              {`forecast clear · ${formatDuration(clear!.minutes)}`}
            </text>
          </g>
        )}

        {showBest && (
          <g data-best>
            <rect x={x(bestA as number)} y={barBottom - 7} width={Math.max(2, x(bestB as number) - x(bestA as number))} height={4} rx={2} style={{ fill: "var(--color-ink)" }} />
            <text
              x={(x(bestA as number) + x(bestB as number)) / 2}
              y={barBottom - 12}
              textAnchor="middle"
              style={{ fill: "var(--color-ink)", fontSize: 11 }}
            >
              {`best ${formatDuration(bestWindow!.minutes)}`}
            </text>
          </g>
        )}

        {moonSegs.map((s, i) => (
          <rect key={i} data-moon x={s.a} y={moonY} width={Math.max(1, s.b - s.a)} height={MOON_H} rx={2.5} style={{ fill: "var(--color-muted)" }} />
        ))}

        {ticks.map((tk) => (
          <g key={tk.t}>
            <line x1={x(tk.t)} x2={x(tk.t)} y1={tickY} y2={tickY + 5} style={{ stroke: "var(--color-line)" }} />
            {tk.label && (
              <text x={x(tk.t)} y={H - 2} textAnchor="middle" style={{ fill: "var(--color-muted)", fontSize: 11 }}>
                {tk.label}
              </text>
            )}
          </g>
        ))}
      </svg>

      <p data-testid="strip-tip" className="mt-2 min-h-[18px] text-label text-muted">
        {tip ?? (hasHourly ? "Hover or tap the strip for hourly values." : "")}
      </p>

      <table className="sr-only">
        <caption>Hourly forecast for the night, local time {tz}</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Cloud cover</th>
            <th scope="col">Rain chance</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.t}>
              <th scope="row">{formatTime(s.t, tz)}</th>
              <td>{!s.h || num(s.h.cloud_cover) === null ? "No forecast" : `${num(s.h.cloud_cover)} %`}</td>
              <td>{!s.h || num(s.h.precipitation_probability) === null ? "No forecast" : `${num(s.h.precipitation_probability)} %`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
