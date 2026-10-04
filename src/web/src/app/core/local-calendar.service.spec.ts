import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalCalendar } from "./local-calendar.service";
import { localDay, offsetDay } from "../daily-note/daily-note.models";

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});
describe("Live local calendar", () => {
  it("rolls across local midnight and the year boundary without user interaction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
    const calendar = TestBed.inject(LocalCalendar);
    expect(calendar.today()).toBe("2026-12-31");
    vi.advanceTimersByTime(1000);
    expect(calendar.today()).toBe("2027-01-01");
    expect(offsetDay(calendar.today(), -1)).toBe("2026-12-31");
    expect(offsetDay(calendar.today(), 1)).toBe("2027-01-02");
  });
  it("catches up immediately after sleep or returning to the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 12));
    const calendar = TestBed.inject(LocalCalendar);
    vi.setSystemTime(new Date(2026, 8, 30, 9));
    window.dispatchEvent(new Event("focus"));
    expect(calendar.today()).toBe("2026-09-30");
    vi.setSystemTime(new Date(2026, 9, 1, 9));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calendar.today()).toBe("2026-10-01");
    expect(vi.getTimerCount()).toBe(1);
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses calendar dates across DST and month boundaries, rather than elapsed 24-hour windows", () => {
    for (const [from, yesterday, tomorrow] of [
      ["2026-03-08", "2026-03-07", "2026-03-09"],
      ["2026-11-01", "2026-10-31", "2026-11-02"],
      ["2028-03-01", "2028-02-29", "2028-03-02"],
    ]) {
      expect(offsetDay(from, -1)).toBe(yesterday);
      expect(offsetDay(from, 1)).toBe(tomorrow);
    }
    const now = new Date(2026, 8, 28, 0, 1);
    expect(localDay(now)).toBe("2026-09-28");
  });
});
