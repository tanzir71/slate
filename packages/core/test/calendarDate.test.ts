import { expect, it } from "vitest";
import { isIsoDate } from "../src/calendarDate";

it.each(["2026-11-18", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])(
  "accepts a real ISO calendar date: %s",
  (value) => {
    expect(isIsoDate(value)).toBe(true);
  },
);
it.each([
  "",
  "2026-2-01",
  "2026-02-29",
  "1900-02-29",
  "2026-04-31",
  "2026-00-01",
  "2026-13-01",
  "2026-01-00",
  "2026-01-32",
  "0000-01-01",
  "10000-01-01",
  "2026-11-18T00:00:00Z",
  " 2026-11-18",
  "2026-11-18\n",
])("rejects an invalid or noncanonical calendar date: %s", (value) => {
  expect(isIsoDate(value)).toBe(false);
});
