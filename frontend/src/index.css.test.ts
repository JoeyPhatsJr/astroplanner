import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read from disk: Vitest runs with `css: false`, which empties `?raw` imports of .css files.
const css = readFileSync(resolve(__dirname, "index.css"), "utf8");
const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");

/** Strip comments so prose in them can't satisfy or trip a check. */
const sheet = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Returns the body of each `@media (hover: hover) and (pointer: fine) { ... }` block. */
function hoverMediaBlocks(src: string): string[] {
  const blocks: string[] = [];
  const re = /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{/g;
  for (const m of src.matchAll(re)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    blocks.push(src.slice(start, i - 1));
  }
  return blocks;
}

describe("index.css motion and platform baseline", () => {
  it("is actually read (guards the negative checks against an empty file)", () => {
    expect(sheet.length).toBeGreaterThan(500);
  });

  it("defines the drawer easing token verbatim", () => {
    expect(sheet).toContain("--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)");
  });

  it("gives buttons a pressed state", () => {
    expect(sheet).toContain(".btn:active");
  });

  it("never uses transition: all", () => {
    expect(sheet).not.toMatch(/transition:\s*all/);
  });

  it("keeps every .btn hover rule inside a hover-capable media query", () => {
    const blocks = hoverMediaBlocks(sheet);
    expect(blocks.length).toBeGreaterThan(0);
    let outside = sheet;
    for (const b of blocks) outside = outside.replace(b, "");
    expect(outside).not.toMatch(/\.btn[\w-]*:hover/);
    expect(blocks.join("\n")).toMatch(/\.btn:hover/);
  });

  it("removes the mobile tap highlight", () => {
    expect(sheet).toContain("-webkit-tap-highlight-color: transparent");
  });
});

describe("index.html viewport", () => {
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1] ?? "";

  it("extends under the notch", () => {
    expect(viewport).toContain("viewport-fit=cover");
  });

  it("does not block pinch zoom", () => {
    expect(viewport).not.toContain("user-scalable");
    expect(viewport).not.toContain("maximum-scale");
  });
});

describe("night vision", () => {
  const rule = (sheet.match(/\.vision-img\s*\{[^}]*\}/) ?? [""])[0];

  it("filters pictures through the red-only SVG filter, not sepia", () => {
    expect(rule).toContain("url(#vision-red)");
    expect(rule).not.toContain("sepia(");
  });

  it("defines #vision-red as a colour matrix that keeps only the red channel", () => {
    expect(html).toContain('id="vision-red"');
    expect(html).toMatch(/<feColorMatrix[^>]*values="\s*\.17 \.33 \.06 0 0\s+0 0 0 0 0\s+0 0 0 0 0\s+0 0 0 1 0\s*"/);
  });

  it("uses a readable muted red in the night palette", () => {
    const night = sheet.match(/:root\[data-vision="night"\]\s*\{[^}]*\}/)?.[0] ?? "";
    expect(night).toContain("--color-muted: #a23a30");
  });
});
