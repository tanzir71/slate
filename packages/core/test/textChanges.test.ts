import { expect, it } from "vitest";
import { applyTextChanges } from "../src/textChanges";

it("applies a batch against original UTF-16 positions without changing other words or CRLF bytes", () => {
  expect(
    applyTextChanges("A😀\r\nB words", [
      { from: 1, to: 3, text: "বাংলা" },
      { from: 7, to: 12, text: "kept" },
    ]),
  ).toBe("Aবাংলা\r\nB kept");
  expect(applyTextChanges("words", [])).toBe("words");
  expect(applyTextChanges("words", [{ from: 5, to: 5, text: "!" }])).toBe(
    "words!",
  );
});

it("rejects negative, fractional, reversed, overlapping and out-of-range edits", () => {
  for (const changes of [
    [{ from: -1, to: 0, text: "" }],
    [{ from: 0.5, to: 1, text: "" }],
    [{ from: 2, to: 1, text: "" }],
    [{ from: 0, to: 8, text: "" }],
    [
      { from: 0, to: 2, text: "" },
      { from: 1, to: 3, text: "" },
    ],
  ])
    expect(() => applyTextChanges("words", changes)).toThrow(
      "Invalid recovery",
    );
});
