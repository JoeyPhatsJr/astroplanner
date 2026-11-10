import { describe, expect, it } from "vitest";
import { dragPosition, shouldDismiss } from "./sheetDrag";

describe("shouldDismiss", () => {
  it("dismisses once the drag passes 35% of the height", () => {
    expect(shouldDismiss(351, 0, 1000)).toBe(true);
  });
  it("keeps the sheet at exactly 35% and below when slow", () => {
    expect(shouldDismiss(350, 0.1, 1000)).toBe(false);
    expect(shouldDismiss(0, 0, 1000)).toBe(false);
  });
  it("treats a slow drag that goes nowhere as a settle", () => {
    expect(shouldDismiss(40, 0.05, 700)).toBe(false);
  });
  it("dismisses a fast short flick", () => {
    expect(shouldDismiss(30, 0.6, 700)).toBe(true);
  });
  it("needs velocity strictly above 0.5 px/ms", () => {
    expect(shouldDismiss(30, 0.5, 700)).toBe(false);
  });
  it("does not dismiss an upward flick", () => {
    expect(shouldDismiss(-80, -0.9, 700)).toBe(false);
  });
});

describe("dragPosition", () => {
  it("follows the finger 1:1 downward", () => {
    expect(dragPosition(120)).toBe(120);
    expect(dragPosition(0)).toBe(0);
  });
  it("resists upward travel with a rubber band", () => {
    expect(dragPosition(-100)).toBeCloseTo(-(100 ** 0.6), 6);
    expect(Math.abs(dragPosition(-100))).toBeLessThan(100);
    expect(dragPosition(-200)).toBeLessThan(dragPosition(-100));
  });
});
