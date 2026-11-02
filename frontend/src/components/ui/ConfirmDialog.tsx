import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  /** Destructive actions get a warning-coloured button and initial focus on Cancel. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirmation using the native <dialog> element, which gives a
 * focus trap, Esc-to-cancel and an inert backdrop. Replaces window.confirm().
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false); // a newer request supersedes an unanswered one
          return { ...opts, resolve };
        });
      }),
    [],
  );

  useEffect(() => {
    const d = ref.current;
    if (!d || !pending) return;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", ""); // jsdom / very old browsers
    }
    (pending.destructive ? cancelRef : okRef).current?.focus();
  }, [pending]);

  const settle = (ok: boolean) => {
    const d = ref.current;
    if (d?.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={ref}
        aria-labelledby="confirm-title"
        aria-describedby={pending?.body ? "confirm-body" : undefined}
        onCancel={(e) => {
          e.preventDefault();
          settle(false);
        }}
        className="panel m-auto w-[min(28rem,calc(100vw-2rem))] p-0 text-ink backdrop:bg-night-deep/75"
      >
        {pending && (
          <div className="flex flex-col gap-4 p-5">
            <h2 id="confirm-title" className="font-semibold tracking-tight text-xl">
              {pending.title}
            </h2>
            {pending.body && (
              <div id="confirm-body" className="text-sm leading-relaxed text-ink-2">
                {pending.body}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={() => settle(false)}>
                Cancel
              </button>
              <button
                ref={okRef}
                type="button"
                className={pending.destructive ? "btn border-warn/50 text-warn" : "btn btn-primary"}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return fn;
}
