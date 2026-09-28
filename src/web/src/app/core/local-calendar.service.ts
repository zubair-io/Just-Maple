import { DestroyRef, Injectable, inject, signal } from "@angular/core";
import { localDay } from "../daily-note/daily-note.models";

/** One reactive local calendar for day links and document date labels. */
@Injectable({ providedIn: "root" })
export class LocalCalendar {
  private readonly value = signal(localDay());
  readonly today = this.value.asReadonly();
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.refresh();
    window.addEventListener("focus", this.refresh);
    window.addEventListener("pageshow", this.refresh);
    document.addEventListener("visibilitychange", this.refresh);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      window.removeEventListener("focus", this.refresh);
      window.removeEventListener("pageshow", this.refresh);
      document.removeEventListener("visibilitychange", this.refresh);
    });
  }

  readonly refresh = (): string => {
    clearTimeout(this.timer);
    const now = new Date(),
      day = localDay(now);
    this.value.set(day);
    // Calendar arithmetic handles short/long DST days. A minute fallback also
    // catches system clock/time-zone changes while the window remains focused.
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    this.timer = setTimeout(
      this.refresh,
      Math.min(60_000, Math.max(1, midnight.getTime() - now.getTime())),
    );
    return day;
  };
}
