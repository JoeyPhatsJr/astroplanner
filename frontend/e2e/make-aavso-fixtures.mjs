// Writes SYNTHETIC AAVSO VSX CSV fixtures for the e2e fixture backend (never real observations).
// JDs are relative to "now" so the alert rule (>= 2 distinct observers brighter than the threshold
// within 48 h) holds whenever the tests run; run this right before the fixture backend starts.
// The header is the exact VSX api.delim column list (spec section 2); private columns carry
// sentinel values (ZZ_SENTINEL_*) so a privacy leak would be visible.
//
// U Gem is deliberately given NO file: the fixture provider then fails for it, which the app must
// show as "No AAVSO data yet" (acceptance 8), never as "no change".
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "aavso-fixtures");
const HEADER = "JD,mag,uncert,band,by,comCode,compStar1,compStar2,charts,comment,transformed,airmass,val,cmag,kmag,starName,obsAffil,mtype,adsRef,digitizer,credit,obsID,fainterThan,obsType,software,obsName,obsCountry".split(",");
const nowJd = Date.now() / 86400000 + 2440587.5;
const CODES = ["ZZOB1", "ZZOB2", "ZZOB3"];

function csvRow(star, jd, mag, by) {
  const v = {
    JD: jd.toFixed(5), mag: mag.toFixed(1), band: "Vis.", by, charts: "ZZ_SENTINEL_CHART",
    comment: '"ZZ_SENTINEL_COMMENT, with a comma"', transformed: "0", val: "Z", starName: star, mtype: "STD",
    obsID: String(Math.round(jd * 100000)), fainterThan: "0", obsType: "Visual",
    obsName: "ZZ_SENTINEL_NAME", obsCountry: "ZZ_SENTINEL_COUNTRY",
  };
  return HEADER.map((h) => v[h] ?? "").join(",");
}

// magAt(daysAgo) -> magnitude; 4 estimates a day from rotating observers, none in the future.
function write(slug, star, daysBack, magAt) {
  const lines = [HEADER.join(",")];
  for (let d = daysBack; d >= 0; d--) {
    for (let i = 0; i < 4; i++) {
      const ago = d + (3 - i) * 0.25 + 0.05; // always in the past
      if (ago < 0.05) continue;
      const jd = nowJd - ago;
      const wobble = 0.1 * (((d + i) % 3) - 1);
      lines.push(csvRow(star, jd, magAt(ago) + wobble, CODES[(d + i) % 3]));
    }
  }
  writeFileSync(join(OUT, `${slug}.csv`), lines.join("\n") + "\n");
}

function outburst(ago, peakAgo, peak, quiet, fade) {
  if (ago > peakAgo + 1) return null;
  if (ago >= peakAgo) return peak + (quiet - peak) * (ago - peakAgo); // quick rise
  return Math.min(quiet, peak + fade * (peakAgo - ago)); // slower fade
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// SS Cyg: quiescent ~12 V with four synthetic outbursts, the last one still bright now.
write("ss-cyg", "SS CYG", 120, (ago) => {
  let m = 12.0;
  for (const peakAgo of [100, 68, 36, 3]) {
    const o = outburst(ago, peakAgo, 8.6, 12.0, 0.3);
    if (o !== null) m = Math.min(m, o);
  }
  return m;
});
// T CrB: quiet near 10 V (alert needs 3 observers brighter than 8.0: none).
write("t-crb", "T CRB", 60, () => 10.0);
// R Leo: no alert rule; a flat faint curve is enough for its page.
write("r-leo", "R LEO", 60, () => 10.5);
