import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { dragPosition, shouldDismiss } from "../../lib/sheetDrag";

type Options = {
  /** The pointer went down on a sheet that was still animating closed; it is now held. */
  onGrab?: () => void;
  /** The drag ended without dismissing: the sheet returns to its open position. */
  onSettle?: () => void;
};

/** Never start a drag from something the user is pressing for its own sake. */
const INTERACTIVE = "button, a, input, select, textarea, [role='button'], [data-no-drag]";

/** Live translateY of an element, including mid-transition values. */
function liveTranslateY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  try {
    return new DOMMatrixReadOnly(t).m42;
  } catch {
    return 0;
  }
}

type Drag = { id: number; startY: number; base: number; height: number; lastY: number; lastT: number; v: number };

/**
 * Pointer handlers for a bottom sheet's top region. The track phase writes transform on the panel
 * and opacity on the scrim straight to their styles (no React state, no CSS variables). The release
 * phase hands control back to the stylesheet's transitions by clearing the inline styles.
 */
export function useSheetDrag(
  panelRef: RefObject<HTMLElement | null>,
  scrimRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options: Options = {},
) {
  const s = useRef<Drag | null>(null);
  const opts = useRef(options);
  opts.current = options;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const release = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const st = s.current;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!st || e.pointerId !== st.id || !panel) return;
    s.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
    const dy = st.base + (e.clientY - st.startY);
    // A finger that paused before lifting is not a flick.
    const idle = e.timeStamp - st.lastT > 100;
    const v = cancelled || idle ? 0 : st.v;
    const dismiss = !cancelled && shouldDismiss(dy, v, st.height);

    // Give the transitions back and flush first, so clearing the inline values animates from where the finger left it.
    panel.style.transition = "";
    if (scrim) scrim.style.transition = "";
    void panel.offsetHeight;
    panel.style.transform = "";
    if (scrim) scrim.style.opacity = "";
    if (dismiss) dismissRef.current();
    else opts.current.onSettle?.();
  };

  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      const panel = panelRef.current;
      if (!panel || s.current || (e.pointerType === "mouse" && e.button !== 0)) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      // Read where a closing sheet really is before anything is overwritten, so it can be caught.
      const base = liveTranslateY(panel);
      opts.current.onGrab?.();
      panel.style.transition = "none";
      if (scrimRef.current) scrimRef.current.style.transition = "none";
      panel.style.transform = `translate3d(0, ${base}px, 0)`;
      s.current = { id: e.pointerId, startY: e.clientY, base, height: panel.offsetHeight || 1, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best effort */
      }
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const st = s.current;
      const panel = panelRef.current;
      if (!st || !panel || e.pointerId !== st.id) return;
      const dt = e.timeStamp - st.lastT;
      if (dt > 0) {
        // Smoothed so one jittery sample cannot decide the release.
        st.v = 0.6 * ((e.clientY - st.lastY) / dt) + 0.4 * st.v;
        st.lastY = e.clientY;
        st.lastT = e.timeStamp;
      }
      const y = dragPosition(st.base + (e.clientY - st.startY));
      panel.style.transform = `translate3d(0, ${y}px, 0)`;
      if (scrimRef.current) scrimRef.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / st.height)));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => release(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => release(e, true),
  };
}
