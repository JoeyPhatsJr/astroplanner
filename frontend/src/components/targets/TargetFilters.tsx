import type { Category } from "../../api/types";
import { CATEGORY_LABEL } from "../../lib/format";
import { usePrefs } from "../../state/prefs";

export const MIN_ALT_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50, 60];

export function TargetFilters({
  category,
  onCategory,
  observableOnly,
  onObservableOnly,
  idPrefix,
}: {
  category: Category;
  onCategory: (c: Category) => void;
  observableOnly?: boolean;
  onObservableOnly?: (v: boolean) => void;
  idPrefix: string;
}) {
  const { prefs, update } = usePrefs();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`${idPrefix}-cat`} className="label">
          Type
        </label>
        <select id={`${idPrefix}-cat`} className="field py-1.5" value={category} onChange={(e) => onCategory(e.target.value as Category)}>
          {(["all", "galaxy", "nebula", "cluster"] as const).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-alt`} className="label">
          Minimum altitude
        </label>
        <select
          id={`${idPrefix}-alt`}
          className="field py-1.5"
          value={prefs.minAltitudeDeg}
          onChange={(e) => update({ minAltitudeDeg: Number(e.target.value) })}
        >
          {MIN_ALT_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a}°{a === 30 ? " (default)" : ""}
            </option>
          ))}
        </select>
      </div>
      {onObservableOnly && (
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-2">
          <input type="checkbox" className="size-4 accent-ice" checked={!!observableOnly} onChange={(e) => onObservableOnly(e.target.checked)} />
          Observable only
        </label>
      )}
    </div>
  );
}
