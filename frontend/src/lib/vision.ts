/** Night-vision mode lives on <html data-vision>, so CSS variables switch the whole palette at once. */
export type Vision = "normal" | "night";

const THEME_COLOR: Record<Vision, string> = { normal: "#02030a", night: "#050000" };

export function applyVision(nightVision: boolean): void {
  try {
    const v: Vision = nightVision ? "night" : "normal";
    document.documentElement.dataset.vision = v;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[v]);
  } catch {
    /* no DOM (tests without jsdom): nothing to do */
  }
}
