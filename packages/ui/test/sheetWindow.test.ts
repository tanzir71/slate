import { expect, it } from "vitest";
import { sheetWindow } from "../src/browser/sheetWindow";

it("renders small lists completely and bounds large lists with overscan", () => {
  expect(sheetWindow(5, 600, 0, 88)).toEqual({ start: 0, end: 5 });
  expect(sheetWindow(10000, 600, 0, 88)).toEqual({ start: 0, end: 13 });
  expect(sheetWindow(10000, 600, 8800, 88)).toEqual({ start: 94, end: 113 });
  const end = sheetWindow(100, 600, 8800, 88);
  expect(end).toEqual({ start: 94, end: 100 });
});
