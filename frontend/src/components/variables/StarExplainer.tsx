import { ExternalLink } from "lucide-react";

const VAR_TYPES_URL = "https://vsx.aavso.org/index.php?view=about.vartypes";

export function StarExplainer({ sourceUrl, starName }: { sourceUrl: string; starName: string }) {
  return (
    <section className="panel flex flex-col gap-2 p-4" aria-labelledby="vh-explainer">
      <h2 id="vh-explainer" className="font-semibold text-lg">
        How to read a variable star
      </h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-2">
        <li>A light curve plots brightness over time. Magnitudes run backwards: a smaller number is brighter, so brighter is up.</li>
        <li>Brightness is measured against comparison stars in the same frame whose magnitudes are known. Your own number is only as good as those references.</li>
        <li>Stars that are too bright saturate the sensor, and a saturated star cannot be measured. Check your frames before trusting a value.</li>
        <li>Every measurement has uncertainty. Treat a single value as an estimate, not a fact.</li>
      </ul>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={sourceUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ice hover:underline">
          {starName} on AAVSO VSX <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <a href={VAR_TYPES_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ice hover:underline">
          Variable star types (VSX) <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </p>
    </section>
  );
}
