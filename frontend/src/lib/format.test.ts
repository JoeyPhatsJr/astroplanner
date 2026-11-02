import { describe, expect, it } from "vitest";
import { formatDec, formatDeg, formatRA, formatSize } from "./format";
import { bandSegments, nearestHour, skyBand } from "./sky";

describe("RA/Dec formatting", () => {
  it("formats OpenNGC positions of M42 and M31", () => {
    // M42: 05:35:16.48 −05:23:22.8 ; M31: 00:42:44.35 +41:16:08.6
    expect(formatRA(83.818667)).toBe("05h 35m 16.5s");
    expect(formatDec(-5.389667)).toBe("−05° 23′ 23″");
    // 10.684792° = 44.35008 s (degree rounding in the catalog), so one decimal rounds up
    expect(formatRA(10.684792)).toBe("00h 42m 44.4s");
    expect(formatDec(41.269056)).toBe("+41° 16′ 09″");
  });
  it("wraps RA at 24h and handles the poles", () => {
    expect(formatRA(359.99999)).toBe("00h 00m 00.0s");
    expect(formatRA(-15)).toBe("23h 00m 00.0s");
    expect(formatDec(90)).toBe("+90° 00′ 00″");
    expect(formatDec(-89.99999)).toBe("−90° 00′ 00″");
  });
  it("formats other values", () => {
    expect(formatDeg(-12.4)).toBe("−12°");
    expect(formatDeg(null)).toBe("–");
    expect(formatSize(177.83, 69.66)).toBe("178′ × 70′");
    expect(formatSize(1.27, null)).toBe("1.3′");
    expect(formatSize(null, null)).toBe("Not listed");
  });
});

describe("sky bands", () => {
  it("uses the same thresholds as the backend", () => {
    expect(skyBand(5)).toBe("day");
    expect(skyBand(-0.5)).toBe("day");
    expect(skyBand(-3)).toBe("civil");
    expect(skyBand(-6.5)).toBe("nautical");
    expect(skyBand(-15)).toBe("astronomical");
    expect(skyBand(-18.1)).toBe("dark");
  });
  it("builds contiguous segments", () => {
    const t = [0, 1, 2, 3, 4, 5];
    const s = bandSegments(t, [2, -3, -8, -20, -20, -8]);
    expect(s.map((x) => x.band)).toEqual(["day", "civil", "nautical", "dark", "nautical"]);
    for (let i = 1; i < s.length; i++) expect(s[i].start).toBeCloseTo(s[i - 1].end);
  });
  it("never fills forecast gaps beyond 30 minutes", () => {
    const rows = [{ t_ms: 0, cloud_cover: 10 }, { t_ms: 3_600_000, cloud_cover: 20 }] as never[];
    expect(nearestHour(rows, 1_000_000)).toMatchObject({ cloud_cover: 10 });
    expect(nearestHour(rows, 3_600_000 + 31 * 60_000)).toBeNull();
  });
});
