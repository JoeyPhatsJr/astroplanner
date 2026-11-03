import type { PreviewGroup, PreviewResponse } from "../api/astrolog";

// ---- merging per-batch previews --------------------------------------------------------

export function mergeGroups(previews: PreviewResponse[]): PreviewGroup[] {
  const by = new Map<string, PreviewGroup>();
  for (const p of previews) {
    for (const g of p.groups) {
      const prev = by.get(g.group_key);
      if (!prev) {
        by.set(g.group_key, { ...g });
        continue;
      }
      const temps = [prev.ccd_temp_range, g.ccd_temp_range].filter((t): t is [number, number] => !!t);
      by.set(g.group_key, {
        ...prev,
        frames: prev.frames + g.frames,
        new_frames: prev.new_frames + g.new_frames,
        captured_s: prev.captured_s + g.captured_s,
        exptime_s: prev.exptime_s === g.exptime_s ? prev.exptime_s : null,
        first_utc: [prev.first_utc, g.first_utc].filter(Boolean).sort()[0] ?? null,
        last_utc: [prev.last_utc, g.last_utc].filter(Boolean).sort().reverse()[0] ?? null,
        filters: [...new Set([...prev.filters, ...g.filters])].sort(),
        gains: [...new Set([...prev.gains, ...g.gains])].sort((a, b) => a - b),
        ccd_temp_range: temps.length ? [Math.min(...temps.map((t) => t[0])), Math.max(...temps.map((t) => t[1]))] : null,
        plan_session_ids: [...new Set([...prev.plan_session_ids, ...g.plan_session_ids])],
      });
    }
  }
  return [...by.values()].sort((a, b) => (a.night_date ?? "9999").localeCompare(b.night_date ?? "9999") || a.device.localeCompare(b.device));
}
