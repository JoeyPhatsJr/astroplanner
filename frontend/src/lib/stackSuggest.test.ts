import { describe, expect, it } from "vitest";
import type { StackOut } from "../api/astrolog";
import { suggestStackId } from "./stackSuggest";

const st = (id: string, source_filename: string, stack_count: number | null = null): StackOut => ({
  id, source_filename, stack_count, livetime_s: null, exptime_s: null, expstart_jd: null, expend_jd: null,
  program: null, provenance: "header", integration_s: null, integration_provenance: "header",
});

// Newest first, as the target payload lists them.
const stacks = [st("c", "Stacked_300_NGC 7635.fit", 300), st("b", "NGC_7635_654x10sec.fit"), st("a", "old.fit", 100)];

describe("suggestStackId (chosen file name, before upload)", () => {
  it("matches the <N>x<S>sec count against each stack's filename or STACKCNT", () => {
    expect(suggestStackId("NGC7635_654x10sec_starnet.tif", stacks)).toBe("b");
    expect(suggestStackId("M27_100x10.0sec_final.tif", stacks)).toBe("a");
  });
  it("suggests nothing when the count contradicts every stack", () => {
    expect(suggestStackId("NGC7635_999x10sec.tif", stacks)).toBeNull();
  });
  it("suggests the latest stack when the name has no count", () => {
    expect(suggestStackId("final.tif", stacks)).toBe("c");
  });
  it("is null without stacks", () => {
    expect(suggestStackId("x_654x10sec.tif", [])).toBeNull();
  });
});
