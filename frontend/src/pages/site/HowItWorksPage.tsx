import { SitePageIntro } from "../../components/site/SitePageIntro";
import weights from "../../components/site/scoreWeights.json";

const DOCS = "https://github.com/JoeyPhatsJr/astroplanner/blob/main/docs";

const SECTIONS = [
  { id: "sky", label: "The sky" },
  { id: "tonight-score", label: "Tonight’s Score" },
  { id: "ranking", label: "Ranking targets" },
  { id: "limits", label: "What it won’t claim" },
];

type Row = { label: string; note: string; badge: "Forecast" | "Calculated"; pts: number; seg?: string };

const t = weights.tonight;
const g = weights.target;

const TONIGHT_ROWS: Row[] = [
  { label: "Cloud cover", note: `${t.cloud} × (1 − cloud %)`, badge: "Forecast", pts: t.cloud, seg: "var(--color-seg-1)" },
  { label: "Rain risk", note: `${t.precipitation} × (1 − precipitation probability)`, badge: "Forecast", pts: t.precipitation, seg: "var(--color-seg-2)" },
  { label: "Moonlight", note: `${t.moon} × (1 − illuminated fraction) while it is up`, badge: "Calculated", pts: t.moon, seg: "var(--color-seg-3)" },
  { label: "Darkness available", note: `${t.darkness} × min(dark minutes / 360, 1)`, badge: "Calculated", pts: t.darkness, seg: "var(--color-seg-4)" },
];

const TARGET_ROWS: Row[] = [
  { label: "Altitude", note: "higher means less air to shoot through", badge: "Calculated", pts: g.altitude },
  { label: "Imaging time", note: "full points at 4 hours", badge: "Calculated", pts: g.duration },
  { label: "Forecast weather", note: "cloud and rain for those hours", badge: "Forecast", pts: g.weather },
  { label: "Moon interference", note: "its brightness and distance; gentler on emission nebulae", badge: "Calculated", pts: g.moon },
];

const tonightNoForecast = t.moon + t.darkness;
const targetNoForecast = g.altitude + g.duration + g.moon;

function Badge({ kind }: { kind: Row["badge"] }) {
  return <span className={kind === "Forecast" ? "site-badge site-badge-fc" : "site-badge"}>{kind}</span>;
}

function ScoreTable({ label, rows, mono }: { label: string; rows: Row[]; mono: boolean }) {
  return (
    <table className="site-rows" aria-label={label}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            {r.seg && (
              <td className="site-dot-cell" aria-hidden="true">
                <span className="site-dot" style={{ background: r.seg }} />
              </td>
            )}
            <td className="site-row-main">
              <b>{r.label}</b>
              <small className={mono ? "site-mono" : undefined}>{r.note}</small>
            </td>
            <td>
              <Badge kind={r.badge} />
            </td>
            <td className="site-pts">{r.pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HowItWorksPage() {
  return (
    <div className="site-page">
      <SitePageIntro
        docTitle="How it works"
        eyebrow="How it works"
        title="Every number shows its work."
        lede="Where the sky positions come from, how the two scores add up, and what AstroPlanner will never claim."
      />
      <div className="site-doc">
        <ul className="site-toc">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a className="landing-press" href={`#${s.id}`}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>

        <h2 id="sky" className="landing-h2 site-h2">
          The sky, for your spot
        </h2>
        <p>
          Sun, Moon and target positions are computed with Astropy for your saved latitude, longitude and elevation, every five minutes
          through the night. Times are worked out in UTC and shown in your own timezone. A night runs from local noon to noon, so an
          evening that crosses midnight stays one night.
        </p>
        <p>
          The results are checked automatically against independent references: US Naval Observatory sunrise, sunset, twilight and
          moonrise across both 2026 clock changes, a southern-hemisphere site, a midnight-sun case, USNO Moon phases and a worked
          example from Meeus.
        </p>

        <h2 id="tonight-score" className="landing-h2 site-h2">
          Tonight’s Score
        </h2>
        <p>A 0 to 100 planning estimate for the best two hours of darkness. Each part says whether it comes from a forecast or a calculation.</p>
        <div className="site-figure">
          <div className="site-bar" aria-hidden="true">
            {TONIGHT_ROWS.map((r) => (
              <span key={r.label} style={{ flex: r.pts, background: r.seg }} />
            ))}
          </div>
          <ScoreTable label="How Tonight’s Score is split" rows={TONIGHT_ROWS} mono />
        </div>
        <p>
          <b className="site-strong">No forecast, no total.</b> If the weather can’t be fetched, you see the Moon and darkness parts on
          their own, out of {tonightNoForecast}, never a made-up 100. Missing forecast hours are skipped, not treated as clear.
        </p>

        <h2 id="ranking" className="landing-h2 site-h2">
          Ranking targets
        </h2>
        <p>Only targets with at least 30 minutes above your minimum altitude in darkness are ranked. Each is scored over its longest window:</p>
        <div className="site-figure">
          <ScoreTable label="How a target is scored" rows={TARGET_ROWS} mono={false} />
        </div>
        <p>Without a forecast the weather part is left out and the score is shown out of {targetNoForecast}, not stretched to look like 100.</p>

        <h2 id="limits" className="landing-h2 site-h2">
          What it won’t claim
        </h2>
        <ul className="site-limits">
          <li>
            <b className="site-strong">Scores are estimates, not sky quality.</b> They don’t measure transparency or seeing, and say so on
            screen.
          </li>
          <li>
            <b className="site-strong">Framing is approximate.</b> The Seestar S30’s published 2.46° field doesn’t say which axis it is,
            so “larger than the field” notes are advice and never change a score.
          </li>
          <li>
            <b className="site-strong">The Seestar’s range for variable stars is an estimate</b> (about magnitude 7 to 12.5), labelled as
            not yet measured.
          </li>
          <li>
            <b className="site-strong">Your own data stays unknown when it is.</b> AstroLog never guesses a value a file doesn’t contain.
          </li>
        </ul>
        <p className="site-meta">
          Full formulas:{" "}
          <a href={`${DOCS}/SCORING.md`} target="_blank" rel="noreferrer">
            docs/SCORING.md
          </a>{" "}
          and{" "}
          <a href={`${DOCS}/ASTRONOMY.md`} target="_blank" rel="noreferrer">
            docs/ASTRONOMY.md
          </a>{" "}
          in the source.
        </p>
      </div>
    </div>
  );
}
