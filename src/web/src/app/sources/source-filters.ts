import { SourceQuery } from "./sources.service";

export interface SourceFilters {
  search: string;
  type: string | string[];
  connector: string | string[];
  account: string | string[];
  state: string | string[];
  receivedFrom: string;
  receivedTo: string;
}

function localMidnight(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("Choose received dates in YYYY-MM-DD format.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (
    year < 1 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    throw Error("Choose a valid received calendar date.");
  return date;
}

/** Both date controls are inclusive local calendar days. The backend uses >= / <=. */
export function sourceDateRange(
  from: string,
  to: string,
): Pick<SourceQuery, "receivedAfter" | "receivedBefore"> {
  const first = from ? localMidnight(from) : undefined;
  const last = to ? localMidnight(to) : undefined;
  if (first && last && first.getTime() > last.getTime())
    throw Error("Received from must be on or before Received to.");
  // Calendar arithmetic preserves 23/25-hour days across daylight-saving changes.
  if (last) {
    last.setDate(last.getDate() + 1);
    last.setMilliseconds(-1);
  }
  return {
    receivedAfter: first?.toISOString(),
    receivedBefore: last?.toISOString(),
  };
}

export function sourceFilterValues(value: string | string[]): string[] {
  return [...new Set((Array.isArray(value) ? value : [value]).filter(Boolean))].sort();
}

export function buildSourceQuery(filters: SourceFilters): SourceQuery {
  return {
    types: sourceFilterValues(filters.type),
    connectors: sourceFilterValues(filters.connector),
    accounts: sourceFilterValues(filters.account),
    states: sourceFilterValues(filters.state),
    text: filters.search.trim() || undefined,
    ...sourceDateRange(filters.receivedFrom, filters.receivedTo),
  };
}
