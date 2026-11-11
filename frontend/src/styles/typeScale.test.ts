import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vitest blanks `?raw` imports of .css files, so read the stylesheet directly.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

const sources = import.meta.glob("../**/*.tsx", { query: "?raw", eager: true, import: "default" }) as Record<
  string,
  string
>;
const components = Object.entries(sources).filter(([path]) => !path.endsWith(".test.tsx"));

function theme(): string {
  const m = css.match(/@theme\s*{[\s\S]*?\n}/);
  return m ? m[0] : "";
}

describe("type scale", () => {
  it("imports the optical-size Inter file", () => {
    expect(css).toContain('@import "@fontsource-variable/inter/opsz.css"');
    expect(css).not.toContain('@import "@fontsource-variable/inter";');
  });

  it("body keeps only cv11 as a font feature", () => {
    const body = css.match(/body\s*{[^}]*}/)?.[0] ?? "";
    expect(body).toMatch(/font-feature-settings:\s*"cv11" 1;/);
    expect(body).not.toContain("tnum");
  });

  it("defines the scale in @theme", () => {
    const t = theme();
    const expected = [
      "--text-xs--line-height: 1.35",
      "--text-xs--letter-spacing: 0.01em",
      "--text-sm--line-height: 1.45",
      "--text-sm--letter-spacing: 0",
      "--text-base--line-height: 1.5",
      "--text-base--letter-spacing: 0",
      "--text-lg--line-height: 1.35",
      "--text-lg--letter-spacing: -0.005em",
      "--text-xl--line-height: 1.25",
      "--text-xl--letter-spacing: -0.008em",
      "--text-2xl--line-height: 1.2",
      "--text-2xl--letter-spacing: -0.011em",
      "--text-3xl--line-height: 1.15",
      "--text-3xl--letter-spacing: -0.014em",
      "--text-display: 2.5rem",
      "--text-display--line-height: 1.05",
      "--text-display--letter-spacing: -0.02em",
      "--text-score: 4.75rem",
      "--text-score--line-height: 0.9",
      "--text-score--letter-spacing: -0.035em",
    ];
    for (const line of expected) expect(t, line).toContain(line + ";");
  });

  it("no component uses ad-hoc tracking or one-off sizes", () => {
    const offenders = components
      .filter(([, src]) => /\btracking-(tight|wider|\[)/.test(src) || /\btext-(4xl|5xl|\[1\.35rem\])/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("no component overrides the scale line height with leading-tight or leading-snug", () => {
    const offenders = components.filter(([, src]) => /\bleading-(tight|snug|none)\b/.test(src)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
  it("defines .badge-accent and no inline accent badge variant remains", () => {
    expect(css).toMatch(/\.badge-accent\s*{/);
    const offenders = components.filter(([, src]) => src.includes("border-ice/40 text-ice")).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("no user-visible string contains an em-dash (comments are ignored)", () => {
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    const offenders = components.filter(([, src]) => stripComments(src).includes("\u2014")).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
