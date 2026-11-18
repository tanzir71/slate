import { isIsoDate } from "./calendarDate.js";

/** Canonical daily notes only; calendar ordering is independent of timezones. */
export function previousDailyNote(
  paths: readonly string[],
  day: string,
): string | undefined {
  if (!isIsoDate(day))
    throw new Error("A daily note needs a valid calendar date.");
  let previous: string | undefined;
  for (const path of paths) {
    const match = /^Daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
    if (
      match &&
      match[0] === path &&
      isIsoDate(match[1]!) &&
      match[1]! < day &&
      (!previous || path > previous)
    )
      previous = path;
  }
  return previous;
}
