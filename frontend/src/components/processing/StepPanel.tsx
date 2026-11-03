import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { StepView } from "../../api/processing";
import { AdviceList } from "./AdviceList";

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setState("copied"))
          .catch(() => setState("failed"))
          .finally(() => setTimeout(() => setState("idle"), 2000));
      }}
    >
      {state === "copied" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

export function StepPanel({ step, total, actions }: { step: StepView; total: number; actions: ReactNode }) {
  return (
    <section aria-labelledby="coach-step-title" className="panel flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-5">
      <div>
        <p className="text-xs text-muted">
          Step {step.n} of {total}
        </p>
        <h2 id="coach-step-title" className="mt-0.5 font-semibold tracking-tight text-2xl text-ink">
          {step.title}
        </h2>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{step.does}</p>

      {step.blocked ? (
        <div role="note" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
          {step.blocked}
        </div>
      ) : (
        <AdviceList advice={step.advice} />
      )}

      <div className="text-sm leading-relaxed text-muted">
        <p>
          <b className="text-ink-2">In Siril:</b> {step.gui}
        </p>
        {step.expect && (
          <p className="mt-1.5">
            <b className="text-ink-2">You should see:</b> {step.expect}
          </p>
        )}
      </div>

      {step.command && (
        <div className="flex flex-col gap-2">
          <pre className="overflow-x-auto rounded-lg border border-line bg-panel-2 p-3 text-xs text-ink">
            <code>{step.command}</code>
          </pre>
          <div>
            <CopyButton text={step.command} />
          </div>
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-2">{actions}</div>
    </section>
  );
}
