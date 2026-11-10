import { describe, expect, it } from "vitest";
import { activeIndex } from "./useChapterProgress";

describe("activeIndex", () => {
  const vh = 800; // middle of the viewport is 400

  it("is the first chapter while the story is still below the fold (back at the top)", () => {
    expect(activeIndex([1500, 2400, 3300], vh)).toBe(0);
  });
  it("is the last chapter whose top has passed the middle", () => {
    expect(activeIndex([-900, 350, 1250], vh)).toBe(1);
  });
  it("counts a chapter exactly at the middle as active", () => {
    expect(activeIndex([-500, 400, 1300], vh)).toBe(1);
  });
  it("stays on the last chapter after the story has scrolled away", () => {
    expect(activeIndex([-4000, -3000, -2000], vh)).toBe(2);
  });
});
