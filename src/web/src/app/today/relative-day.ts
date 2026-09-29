// Compare calendar dates, not elapsed local hours, so DST never shifts a label.
export function relativeDayLabel(day: string, today: string): string {
  const calendarTime = (value: string) => {
    const [year, month, date] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  const days = Math.round((calendarTime(day) - calendarTime(today)) / 86_400_000);
  if (!Number.isFinite(days)) return day;
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  const magnitude = Math.abs(days);
  const [divisor, unit] = magnitude >= 365 ? [365, "year"] as const
    : magnitude >= 30 ? [30, "month"] as const
    : magnitude >= 7 ? [7, "week"] as const
    : [1, "day"] as const;
  const amount = Math.sign(days) * Math.floor(magnitude / divisor);
  return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(amount, unit);
}
