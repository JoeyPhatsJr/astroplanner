import { describe, expect, it, vi } from "vitest";
import { readNightFolder } from "./nightFolder";

function fake(rel: string, size = 100, text = "") {
  const t = vi.fn(async () => text);
  const f = { name: rel.split("/").pop() as string, size, webkitRelativePath: rel, text: t } as unknown as File;
  return { f, t };
}

describe("readNightFolder", () => {
  it("groups runs by first-level subfolder and reads only the three text files", async () => {
    const items = [
      fake("Bubble/lights/a.fit"),
      fake("Bubble/process/pp_light_.seq", 100, "SEQ1"),
      fake("Bubble/process/cache/x.lst", 100, "LST"),
      fake("Bubble/process/light_conversion.txt", 100, "CONV"),
      fake("Bubble/process-coach/pp_light_.seq", 100, "SEQ2"),
      fake("Bubble/flats/f1.fit"),
    ];
    const out = await readNightFolder(items.map((i) => i.f));
    expect(out.runs.map((r) => r.runDir)).toEqual(["process", "process-coach"]);
    expect(out.runs[0].files).toEqual([
      { path: "process/pp_light_.seq", text: "SEQ1" },
      { path: "process/light_conversion.txt", text: "CONV" },
    ]);
    expect(out.runs[1].files).toEqual([{ path: "process-coach/pp_light_.seq", text: "SEQ2" }]);
    expect(out.calibrationDirs).toEqual(["flats"]);
    const read = items.filter((i) => i.t.mock.calls.length > 0).map((i) => i.f.webkitRelativePath);
    expect(read.sort()).toEqual(["Bubble/process-coach/pp_light_.seq", "Bubble/process/light_conversion.txt", "Bubble/process/pp_light_.seq"]);
  });

  it("skips a .seq over 5 MB without reading it", async () => {
    const big = fake("Bubble/process/huge.seq", 8 * 1024 * 1024, "X");
    const ok = fake("Bubble/other/a.seq", 10, "S");
    const out = await readNightFolder([big.f, ok.f]);
    expect(out.skipped).toEqual(["process/huge.seq"]);
    expect(big.t).not.toHaveBeenCalled();
    expect(out.runs.map((r) => r.runDir)).toEqual(["other"]);
  });

  it("returns no runs when there is no .seq", async () => {
    const out = await readNightFolder([fake("Bubble/lights/a.fit").f, fake("Bubble/darks/d.fit").f]);
    expect(out.runs).toEqual([]);
    expect(out.calibrationDirs).toEqual(["darks"]);
  });
});
