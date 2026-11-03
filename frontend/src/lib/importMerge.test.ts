import { describe, expect, it } from "vitest";
import type { PreviewGroup, PreviewResponse } from "../api/astrolog";
import { mergeGroups } from "./importMerge";

const g = (over: Partial<PreviewGroup> = {}): PreviewGroup => ({
  group_key: "g1",
  is_canon: false,
  night_date: "2026-09-11",
  device: "Seestar S30",
  target: { library_key: "catalog:ngc7635", catalog_target_id: "ngc7635", display_name: "NGC 7635", kind: "catalog" },
  frames: 10,
  exptime_s: 10,
  captured_s: 100,
  first_utc: "2026-09-12T03:00:00Z",
  last_utc: "2026-09-12T03:10:00Z",
  filters: ["LP"],
  gains: [200],
  ccd_temp_range: [30, 32],
  new_frames: 4,
  plan_session_ids: ["p1"],
  ...over,
});
const resp = (groups: PreviewGroup[]): PreviewResponse => ({
  needs_location: false, location_id: "L", location_candidates: [], groups, stacks: [], skipped: [],
});

describe("mergeGroups", () => {
  it("merges one group split across three batches", () => {
    const out = mergeGroups([
      resp([g()]),
      resp([g({ frames: 5, new_frames: 5, captured_s: 50, first_utc: "2026-09-12T02:00:00Z", last_utc: "2026-09-12T02:30:00Z", filters: ["IR"], gains: [100], plan_session_ids: ["p2"], ccd_temp_range: [28, 29] })]),
      resp([g({ frames: 1, new_frames: 0, captured_s: 10, last_utc: "2026-09-12T05:00:00Z", plan_session_ids: ["p1"] })]),
    ]);
    expect(out).toHaveLength(1);
    const m = out[0];
    expect(m.frames).toBe(16);
    expect(m.new_frames).toBe(9);
    expect(m.captured_s).toBe(160);
    expect(m.first_utc).toBe("2026-09-12T02:00:00Z");
    expect(m.last_utc).toBe("2026-09-12T05:00:00Z");
    expect(m.filters).toEqual(["IR", "LP"]);
    expect(m.gains).toEqual([100, 200]);
    expect(m.plan_session_ids.sort()).toEqual(["p1", "p2"]);
    expect(m.ccd_temp_range).toEqual([28, 32]);
    expect(m.exptime_s).toBe(10);
  });
  it("gives a null exposure when batches disagree", () => {
    expect(mergeGroups([resp([g()]), resp([g({ exptime_s: 30 })])])[0].exptime_s).toBeNull();
  });
  it("tolerates a null first_utc", () => {
    const m = mergeGroups([resp([g({ first_utc: null, last_utc: null })]), resp([g()])])[0];
    expect(m.first_utc).toBe("2026-09-12T03:00:00Z");
    expect(m.last_utc).toBe("2026-09-12T03:10:00Z");
    expect(mergeGroups([resp([g({ first_utc: null, last_utc: null })]), resp([g({ first_utc: null, last_utc: null })])])[0].first_utc).toBeNull();
  });
  it("keeps disjoint groups separate, ordered by night", () => {
    const out = mergeGroups([resp([g({ group_key: "b", night_date: "2026-09-12" })]), resp([g({ group_key: "a" })])]);
    expect(out.map((x) => x.group_key)).toEqual(["a", "b"]);
  });
});
