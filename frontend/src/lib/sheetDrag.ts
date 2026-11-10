/** A drag past this fraction of the sheet height dismisses it. */
export const DISMISS_DISTANCE_FRACTION = 0.35;
/** A downward flick faster than this (px per ms) dismisses it whatever the distance. */
export const DISMISS_VELOCITY = 0.5;

/** Dismiss on distance or on a fast flick, never on a slow drag that goes nowhere. */
export function shouldDismiss(dy: number, velocityPxPerMs: number, height: number): boolean {
  return dy > DISMISS_DISTANCE_FRACTION * height || velocityPxPerMs > DISMISS_VELOCITY;
}

/** Downward travel tracks the finger 1:1; upward travel past the open position is rubber-banded. */
export function dragPosition(dy: number): number {
  return dy >= 0 ? dy : -(Math.abs(dy) ** 0.6);
}
