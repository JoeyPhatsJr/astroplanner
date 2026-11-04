import type { Advice, Basis } from "../../api/processing";

export const BASIS_LABEL: Record<Basis, string> = {
  measured: "Measured",
  "siril-docs": "Siril docs",
  "tutorial-default": "Tutorial default",
  taste: "Your taste",
};

export function AdviceList({ advice }: { advice: Advice[] }) {
  if (advice.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Settings to use">
      {advice.map((a) => (
        <li key={a.rule_id} className="rounded-lg border border-line px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-ink">{a.setting}</span>
            <span className="badge">{BASIS_LABEL[a.basis]}</span>
            {a.heuristic && <span className="badge border-ice/40 text-ice">Heuristic</span>}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{a.why}</p>
          {a.basis === "siril-docs" && a.source_url && (
            <a href={a.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-ice hover:underline">
              Siril documentation
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
