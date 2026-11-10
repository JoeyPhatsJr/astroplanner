import { useEffect, useRef, type ReactNode, type Ref } from "react";

/** Safety net if no transitionend arrives (reduced motion, display:none, background tab). */
const CLOSE_FALLBACK_MS = 260;

type Props = {
  open: boolean;
  /** Runs once the exit animation has finished and the dialog is closed. */
  onClosed: () => void;
  /** Runs immediately when the user asks to close (Esc, scrim click); the parent should set open=false. */
  onDismiss?: () => void;
  variant: "drawer" | "modal";
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
  panelRef?: Ref<HTMLDivElement>;
  panelClassName?: string;
};

/**
 * Native <dialog> (focus trap, Esc, inert page) with a real scrim and panel element so motion
 * and, later, a drag gesture can style them directly. data-state is "open" or "closing";
 * absent while closed. Both elements share one timing so they move as a single object.
 */
export function Overlay({ open, onClosed, onDismiss, variant, labelledBy, describedBy, children, panelRef, panelClassName = "" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelEl = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const finish = () => {
    const d = ref.current;
    clearTimer();
    if (!d || d.dataset.state !== "closing") return;
    delete d.dataset.state;
    if (d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open"); // jsdom / very old browsers
    }
    onClosedRef.current();
  };

  const beginClose = () => {
    const d = ref.current;
    if (!d || !d.open || d.dataset.state === "closing") return;
    d.dataset.state = "closing";
    clearTimer();
    timer.current = window.setTimeout(finish, CLOSE_FALLBACK_MS);
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      clearTimer();
      if (!d.open) {
        if (typeof d.showModal === "function") d.showModal();
        else d.setAttribute("open", "");
      }
      // Commit the closed styles once so the first frame has something to transition from.
      void d.offsetHeight;
      d.dataset.state = "open";
    } else {
      beginClose();
    }
    // beginClose is stable in behaviour (reads refs only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(
    () => () => {
      clearTimer();
      const d = ref.current;
      if (d?.open && typeof d.close === "function") d.close();
      else d?.removeAttribute("open");
    },
    [],
  );

  const dismiss = () => {
    beginClose();
    onDismiss?.();
  };

  return (
    <dialog
      ref={ref}
      className="overlay"
      data-variant={variant}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        if (!panelEl.current?.contains(e.target as Node)) dismiss();
      }}
      onTransitionEnd={(e) => {
        if (e.target === panelEl.current && ref.current?.dataset.state === "closing") finish();
      }}
    >
      <div className="overlay-scrim" aria-hidden />
      <div
        className={`overlay-panel ${panelClassName}`}
        ref={(el) => {
          panelEl.current = el;
          if (typeof panelRef === "function") panelRef(el);
          else if (panelRef) (panelRef as { current: HTMLDivElement | null }).current = el;
        }}
      >
        {children}
      </div>
    </dialog>
  );
}
