import { describe, expect, it } from "vitest";
import { addDays, defaultNightDate, formatDayMonthYear, formatDuration, formatExposures, formatIntegration, formatLocalSpan, formatTime, formatTimeTz, localDate, nightLabel, tzAbbrev } from "./time";

describe("formatTime in the observer's timezone", () => {
  it("formats in the given zone, not the runner's", () => {
    // 2026-11-03T02:00Z = 21:00 EST on 2 Nov in New York, 13:00 AEDT in Sydney
    expect(formatTime("2026-11-03T02:00:00Z", "America/New_York")).toBe("21:00");
    expect(formatTime("2026-11-03T02:00:00Z", "Australia/Sydney")).toBe("13:00");
    expect(formatTime("2026-11-03T02:00:00Z", "UTC")).toBe("02:00");
  });

  it("handles the US spring-forward DST transition (8 Mar 2026)", () => {
    expect(formatTimeTz("2026-03-08T06:30:00Z", "America/New_York")).toBe("01:30 EST");
    // 07:00Z is 02:00 EST, which does not exist; clocks jump to 03:00 EDT
    expect(formatTimeTz("2026-03-08T07:00:00Z", "America/New_York")).toBe("03:00 EDT");
  });

  it("handles the fall-back transition (1 Nov 2026) where 01:30 occurs twice", () => {
    expect(formatTimeTz("2026-11-01T05:30:00Z", "America/New_York")).toBe("01:30 EDT");
    expect(formatTimeTz("2026-11-01T06:30:00Z", "America/New_York")).toBe("01:30 EST");
  });

  it("reports zone abbreviations", () => {
    expect(tzAbbrev("2026-07-01T00:00:00Z", "America/New_York")).toBe("EDT");
    expect(tzAbbrev("2026-12-01T00:00:00Z", "America/New_York")).toBe("EST");
  });
});

describe("calendar dates and night labels", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("labels the evening-to-morning night explicitly", () => {
    expect(nightLabel("2026-11-02")).toBe("Night of Mon 2 Nov → morning of Tue 3 Nov");
    expect(nightLabel("2026-12-31")).toBe("Night of Thu 31 Dec → morning of Fri 1 Jan");
  });

  it("computes the local calendar date in the zone", () => {
    expect(localDate("2026-11-03T03:00:00Z", "America/New_York")).toBe("2026-11-02");
    expect(localDate("2026-11-03T03:00:00Z", "Asia/Tokyo")).toBe("2026-11-03");
  });
});

describe("defaultNightDate", () => {
  it("uses today's evening after the 06:00 rollover", () => {
    expect(defaultNightDate("2026-11-02T19:00:00Z", "America/New_York")).toBe("2026-11-02"); // 14:00 EST
  });
  it("keeps the previous evening before 06:00 local time", () => {
    expect(defaultNightDate("2026-11-03T08:00:00Z", "America/New_York")).toBe("2026-11-02"); // 03:00 EST
    expect(defaultNightDate("2026-11-03T11:30:00Z", "America/New_York")).toBe("2026-11-03"); // 06:30 EST
  });
  it("uses the location's zone, not UTC", () => {
    // 2026-06-21T15:00Z is 01:00 on 22 Jun in Sydney -> still the night of the 21st
    expect(defaultNightDate("2026-06-21T15:00:00Z", "Australia/Sydney")).toBe("2026-06-21");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(304)).toBe("5 h 04 min");
  });
});

describe("formatIntegration", () => {
  it("formats long, short and unknown times", () => {
    expect(formatIntegration(6540)).toBe("1 h 49 m");
    expect(formatIntegration(10150)).toBe("2 h 49 m");
    expect(formatIntegration(200)).toBe("3 m 20 s");
    expect(formatIntegration(3600)).toBe("1 h 0 m");
    expect(formatIntegration(45)).toBe("45 s");
    expect(formatIntegration(null)).toBe("unknown");
  });

  it("is exact for non-round seconds and never rounds up", () => {
    expect(formatIntegration(125)).toBe("2 m 5 s");
    expect(formatIntegration(20)).toBe("20 s");
    expect(formatIntegration(14380)).toBe("3 h 59 m");
    expect(formatIntegration(14380)).not.toMatch(/60 m|^4 h/);
  });

  it("floors to whole seconds under an hour (never '60 m')", () => {
    expect(formatIntegration(3599.6)).toBe("59 m 59 s");
    expect(formatIntegration(59.9)).toBe("59 s");
    expect(formatIntegration(119.5)).toBe("1 m 59 s");
    expect(formatIntegration(0.4)).toBe("0 s");
  });
});

describe("formatExposures", () => {
  it("shows count × exposure, listing distinct values when mixed", () => {
    expect(formatExposures(1015, [10])).toBe("1,015 × 10 s");
    expect(formatExposures(5, [10, 30])).toBe("5 frames · 10 s, 30 s");
    expect(formatExposures(3, [0.5])).toBe("3 × 0.5 s");
    expect(formatExposures(3, [])).toBe("3 frames");
  });
});

describe("formatLocalSpan", () => {
  it("formats first → last in the location's timezone, with seconds", () => {
    expect(formatLocalSpan("2026-09-12T03:11:24.634Z", "2026-09-12T09:43:55.1Z", "America/New_York")).toBe("23:11:24 → 05:43:55 EDT");
  });
  it("falls back to UTC, labelled, when the timezone is unknown", () => {
    expect(formatLocalSpan("2026-09-12T03:11:24Z", "2026-09-12T09:43:55Z", null)).toBe("03:11:24 → 09:43:55 UTC");
  });
  it("is empty when the times are unknown", () => {
    expect(formatLocalSpan(null, null, "UTC")).toBe("");
  });
});

describe("formatDayMonthYear", () => {
  it("writes the day, a three-letter month and the year", () => {
    expect(formatDayMonthYear("2026-11-11T10:00:00Z")).toBe("11 Nov 2026");
    // September stays "Sep" (en-GB in some engines writes "Sept").
    expect(formatDayMonthYear("2026-09-15T12:00:00Z")).toBe("15 Sep 2026");
    expect(formatDayMonthYear("not a date")).toBeNull();
  });
});
