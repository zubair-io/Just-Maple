import { describe, expect, it } from "vitest";
import { relativeDayLabel } from "./relative-day";

describe("daily note date chip", () => {
  it("names adjacent calendar days", () => {
    expect(relativeDayLabel("2026-09-27", "2026-09-27")).toBe("Today");
    expect(relativeDayLabel("2026-09-26", "2026-09-27")).toBe("Yesterday");
    expect(relativeDayLabel("2026-09-28", "2026-09-27")).toBe("Tomorrow");
  });
  it("formats distant dates in either direction", () => {
    expect(relativeDayLabel("2026-09-13", "2026-09-27")).toBe("2 weeks ago");
    expect(relativeDayLabel("2026-09-24", "2026-09-27")).toBe("3 days ago");
    expect(relativeDayLabel("2026-10-11", "2026-09-27")).toBe("in 2 weeks");
  });
  it("uses calendar boundaries through DST, midnight, and year rollover", () => {
    expect(relativeDayLabel("2026-03-08", "2026-03-09")).toBe("Yesterday");
    expect(relativeDayLabel("2026-11-01", "2026-11-02")).toBe("Yesterday");
    expect(relativeDayLabel("2026-12-31", "2027-01-01")).toBe("Yesterday");
    expect(relativeDayLabel("2026-09-27", "2026-09-28")).toBe("Yesterday");
  });
});
