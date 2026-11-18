import { isIsoDate } from "./calendarDate.js";

/** A caller-supplied wall clock; the renderer never reads ambient time or locale. */
export interface TemplateClock {
  readonly date: string;
  readonly time: string;
  readonly offsetMinutes?: number;
}
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
function ordinal(value: number) {
  const end = value % 100;
  return (
    value +
    (end >= 11 && end <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[
          value % 10
        ] ?? "th"))
  );
}
function isoWeek(date: Date) {
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const first = new Date(0);
  first.setUTCFullYear(year, 0, 1);
  return {
    year,
    week: Math.ceil(
      ((thursday.getTime() - first.getTime()) / 86_400_000 + 1) / 7,
    ),
  };
}
function clockTokens(clock: TemplateClock): Record<string, string> | undefined {
  const time =
    /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(
      clock.time,
    );
  const offset = clock.offsetMinutes ?? 0;
  if (
    !isIsoDate(clock.date) ||
    !time ||
    !Number.isSafeInteger(offset) ||
    Math.abs(offset) > 840
  )
    return;
  const date = new Date(clock.date + "T00:00:00Z");
  const year = date.getUTCFullYear(),
    month = date.getUTCMonth() + 1,
    day = date.getUTCDate(),
    weekday = date.getUTCDay();
  const hour = Number(time[1]),
    minute = Number(time[2]),
    second = Number(time[3] ?? 0);
  const milliseconds = (time[4] ?? "").padEnd(3, "0");
  const timestamp =
    date.getTime() +
    ((hour * 60 + minute - offset) * 60 + second) * 1000 +
    Number(milliseconds);
  const start = new Date(0);
  start.setUTCFullYear(year, 0, 1);
  const dayOfYear =
    Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1;
  const week = isoWeek(date),
    quarter = Math.ceil(month / 3);
  const zone =
    (offset < 0 ? "-" : "+") + pad(Math.floor(Math.abs(offset) / 60));
  return {
    YYYY: pad(year, 4),
    YY: pad(year % 100),
    M: String(month),
    MM: pad(month),
    MMM: months[month - 1]!.slice(0, 3),
    MMMM: months[month - 1]!,
    D: String(day),
    DD: pad(day),
    Do: ordinal(day),
    DDD: String(dayOfYear),
    DDDD: pad(dayOfYear, 3),
    d: String(weekday),
    dd: weekdays[weekday]!.slice(0, 2),
    ddd: weekdays[weekday]!.slice(0, 3),
    dddd: weekdays[weekday]!,
    E: String(weekday || 7),
    Q: String(quarter),
    Qo: ordinal(quarter),
    H: String(hour),
    HH: pad(hour),
    h: String(hour % 12 || 12),
    hh: pad(hour % 12 || 12),
    m: String(minute),
    mm: pad(minute),
    s: String(second),
    ss: pad(second),
    S: milliseconds.slice(0, 1),
    SS: milliseconds.slice(0, 2),
    SSS: milliseconds,
    A: hour < 12 ? "AM" : "PM",
    a: hour < 12 ? "am" : "pm",
    Z: zone + ":" + pad(Math.abs(offset) % 60),
    ZZ: zone + pad(Math.abs(offset) % 60),
    W: String(week.week),
    WW: pad(week.week),
    Wo: ordinal(week.week),
    GGGG: pad(week.year, 4),
    GG: pad(week.year % 100),
    X: String(Math.floor(timestamp / 1000)),
    x: String(timestamp),
  };
}

/** Moment-style calendar/time tokens, with bracketed literal text. */
export function formatTemplateClock(
  clock: TemplateClock,
  format: string,
): string | undefined {
  const values = clockTokens(clock);
  if (!values || !format) return;
  const tokens = Object.keys(values).sort(
    (left, right) => right.length - left.length,
  );
  const parts: string[] = [];
  for (let at = 0; at < format.length;) {
    if (format[at] === "[") {
      const end = format.indexOf("]", at + 1);
      if (end < 0) return;
      parts.push(format.slice(at + 1, end));
      at = end + 1;
      continue;
    }
    const token = tokens.find((token) => format.startsWith(token, at));
    if (token) {
      parts.push(values[token]!);
      at += token.length;
    } else {
      if (/[A-Za-z\]]/.test(format[at]!)) return;
      parts.push(format[at++]!);
    }
  }
  return parts.join("");
}
