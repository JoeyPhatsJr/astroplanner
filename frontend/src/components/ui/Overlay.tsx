import { createContext, useContext, useEffect, useRef, type ReactNode, type Ref } from "react";
import { usePhone } from "../../lib/usePhone";
import { useSheetDrag } from "./useSheetDrag";

/** Safety net if no transitionend arrives (reduced motion, display:none, background tab). */
const CLOSE_FALLBACK_MS = 260;

type Drag = ReturnType<typeof useSheetDrag>;
const SheetDragContext = createContext<Drag | null>(null);

/**
 * The sticky top of an overlay's panel: a grabber bar (phones only) above the header. On phones, where the
 * drawer is a bottom sheet, dragging anywhere here (not on its buttons) moves the sheet. The body scrolls normally.
 */
export function SheetTop({ children, className = "" }: { children: ReactNode; className?: string }) {
  const drag = useContext(SheetDragContext);
  return (
    <div className={`sheet-top ${className}`} {...(drag ?? {})}>
      <span className="sheet-grabber-bar" aria-hidden />
      {children}
    </div>
  );
}

type Props = {
  open: boolean;
  /** Runs once the exit animation has finished and the dialog is closed. */
  onClosed: () => void;
  /** Runs immediately when the user asks to close (Esc, scrim click); the parent should set open=false. */
  onDismiss?: () => void;
  /** A phone sheet caught mid-close and released without dismissing: the parent should set open=true again. */
  onReopen?: () => void;
  variant: "drawer" | "modal";
  /** "alertdialog" for a confirmation that interrupts, such as deleting an account. */
  role?: "dialog" | "alertdialog";
  /**
   * False while the dialog must stay put (a request it started is still running): Escape and a press on the
   * scrim do nothing. Defaults to true.
   */
  dismissible?: boolean;
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
export function Overlay({ open, onClosed, onDismiss, onReopen, variant, role, dismissible = true, labelledBy, describedBy, children, panelRef, panelClassName = "" }: Props) {
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
    if (!d || !d.open) return;
    if (d.dataset.state === "closing") {
      // Already closing (a caught sheet being let go again): make sure the safety net is armed.
      if (timer.current === null) timer.current = window.setTimeout(finish, CLOSE_FALLBACK_MS);
      return;
    }
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

  // The drag exists only where the drawer is a bottom sheet; on wider screens it is a plain side drawer.
  const phone = usePhone();
  const scrimEl = useRef<HTMLDivElement>(null);
  const drag = useSheetDrag(panelEl, scrimEl, dismiss, {
    // Holding a closing sheet stops it finishing underneath the finger.
    onGrab: clearTimer,
    onSettle: () => {
      const d = ref.current;
      if (d?.dataset.state !== "closing") return;
      if (onReopen) {
        d.dataset.state = "open";
        onReopen();
      } else dismiss();
    },
  });

  return (
    <dialog
      ref={ref}
      className="overlay"
      data-variant={variant}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault(); // the native close would skip the exit animation
        if (dismissible) dismiss();
      }}
      onClick={(e) => {
        // Only a click that lands on the scrim itself dismisses. Select and date popups (and a modal
        // select's full-screen backdrop) portal into this dialog beside the panel, and a text selection
        // dragged out of the panel fires its click on the dialog; neither is a scrim click.
        if (e.target === scrimEl.current && dismissible) dismiss();
      }}
      onTransitionEnd={(e) => {
        if (e.target === panelEl.current && ref.current?.dataset.state === "closing") finish();
      }}
    >
      <div className="overlay-scrim" ref={scrimEl} aria-hidden />
      <div
        className={`overlay-panel ${panelClassName}`}
        ref={(el) => {
          panelEl.current = el;
          if (typeof panelRef === "function") panelRef(el);
          else if (panelRef) (panelRef as { current: HTMLDivElement | null }).current = el;
        }}
      >
        <SheetDragContext.Provider value={variant === "drawer" && phone ? drag : null}>{children}</SheetDragContext.Provider>
      </div>
    </dialog>
  );
}
