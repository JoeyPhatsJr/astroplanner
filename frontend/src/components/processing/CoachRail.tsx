import type { StepView } from "../../api/processing";

/** Step list: a left rail on wide screens, a horizontal scroller on narrow ones. */
export function CoachRail({ steps, currentId, onSelect }: { steps: StepView[]; currentId: string; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Processing steps" className="min-[720px]:w-56 min-[720px]:shrink-0">
      <ol className="flex gap-1.5 overflow-x-auto pb-1 min-[720px]:flex-col min-[720px]:overflow-visible min-[720px]:pb-0">
        {steps.map((s) => {
          const current = s.id === currentId;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                onClick={() => onSelect(s.id)}
                className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-sm ${
                  current ? "border-ice/50 bg-ice/10 font-semibold text-ink" : "border-transparent text-ink-2 hover:bg-panel"
                } ${s.state === "done" && !current ? "text-muted" : ""}`}
              >
                <span className="w-4 text-center text-ok" aria-hidden={s.state !== "done"}>
                  {s.state === "done" ? "✓" : ""}
                </span>
                {s.state === "done" && <span className="sr-only">Done: </span>}
                <span>
                  {s.n} · {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
