import type { Category } from "../../api/types";
import { CATEGORY_LABEL } from "../../lib/format";
import { Select } from "../ui/Select";
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
        <Select
          id={`${idPrefix}-cat`}
          className="py-1.5"
          value={category}
          options={(["all", "galaxy", "nebula", "cluster"] as const).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          onChange={(c) => onCategory(c as Category)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-alt`} className="label">
          Minimum altitude
        </label>
        <Select
          id={`${idPrefix}-alt`}
          className="py-1.5"
          value={String(prefs.minAltitudeDeg)}
          options={MIN_ALT_OPTIONS.map((a) => ({ value: String(a), label: `${a}°${a === 30 ? " (default)" : ""}` }))}
          onChange={(a) => update({ minAltitudeDeg: Number(a) })}
        />
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
