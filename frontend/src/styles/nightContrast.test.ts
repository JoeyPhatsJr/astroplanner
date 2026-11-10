import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vitest blanks `?raw` imports of .css files, so read the stylesheet directly.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

function nightTokens(): Record<string, string> {
  const block = css.match(/:root\[data-vision="night"\]\s*{([^}]*)}/)?.[1] ?? "";
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function luminance(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const t = nightTokens();
const grounds = ["--color-night", "--color-night-deep", "--color-panel-2"];
const texts = ["--color-ink", "--color-ink-2", "--color-muted", "--color-ice"];

describe("night vision contrast", () => {
  for (const text of texts) {
    for (const ground of grounds) {
      it(`${text} on ${ground} is at least 4.5:1`, () => {
        expect(contrast(t[text], t[ground])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("on-accent text on the accent fill is at least 4.5:1", () => {
    expect(contrast(t["--color-on-accent"], t["--color-ice"])).toBeGreaterThanOrEqual(4.5);
  });

  it("ink stays visibly brighter than ink-2", () => {
    const ink = contrast(t["--color-ink"], t["--color-night"]);
    const ink2 = contrast(t["--color-ink-2"], t["--color-night"]);
    expect(ink / ink2).toBeGreaterThanOrEqual(1.2);
  });

  it("underlines inline accent links", () => {
    expect(css).toMatch(
      /:root\[data-vision="night"\]\s+a\.text-ice:not\(\.btn\)\s*{[^}]*text-decoration-line:\s*underline;[^}]*text-underline-offset:\s*2px/,
    );
  });
});
