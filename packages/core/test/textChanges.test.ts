import { expect, it } from "vitest";
import {
  applyTextChanges,
  matchesTextChanges,
  type TextChange,
} from "../src/textChanges";

it("assembles thousands of disjoint Unicode edits against one original source", () => {
  const source = Array.from({ length: 5000 }, (_, i) => `line${i} 🙂\r\n`).join(
    "",
  );
  const changes = Array.from(source.matchAll(/^line/gm), (match) => ({
    from: match.index,
    to: match.index + 4,
    text: "row",
  }));
  const output = applyTextChanges(source, changes);
  expect(output).toBe(source.replace(/^line/gm, "row"));
  expect(matchesTextChanges(source, changes, output)).toBe(true);
  expect(() =>
    applyTextChanges(source, [
      ...changes,
      { from: source.length, to: source.length + 1, text: "" },
    ]),
  ).toThrow("Invalid recovery");
});

it("keeps ordered same-position inserts before a replacement at that position", () => {
  expect(
    applyTextChanges("🙂tail", [
      { from: 0, to: 0, text: "A" },
      { from: 0, to: 0, text: "B" },
      { from: 0, to: 2, text: "😀" },
    ]),
  ).toBe("AB😀tail");
});

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
  ]) {
    expect(() => applyTextChanges("words", changes)).toThrow(
      "Invalid recovery",
    );
    expect(() => matchesTextChanges("words", changes, "words")).toThrow(
      "Invalid recovery",
    );
  }
});

it("matches complete UTF-16 edit output including unchanged spans and same-position insertions", () => {
  const source = "A😀\r\nB words";
  const changes = [
    { from: 1, to: 3, text: "বাংলা" },
    { from: 7, to: 12, text: "kept" },
  ];
  const result = "Aবাংলা\r\nB kept";
  expect(matchesTextChanges(source, changes, result)).toBe(true);
  for (const altered of [
    "Xবাংলা\r\nB kept",
    "AবাংXX\r\nB kept",
    "Aবাংলা\r\nX kept",
    `${result}!`,
  ])
    expect(matchesTextChanges(source, changes, altered)).toBe(false);
  expect(
    matchesTextChanges(
      "tail",
      [
        { from: 0, to: 0, text: "a" },
        { from: 0, to: 0, text: "b" },
      ],
      "abtail",
    ),
  ).toBe(true);
  expect(
    matchesTextChanges("tail", [{ from: 0, to: 0, text: "a" }], "atail"),
  ).toBe(true);
  expect(
    matchesTextChanges("tail", [{ from: 0, to: 0, text: "a" }], "ataix"),
  ).toBe(false);
  expect(matchesTextChanges("words", [], "words")).toBe(true);
  expect(matchesTextChanges("words", [], "Words")).toBe(false);
  expect(matchesTextChanges("", [], "")).toBe(true);
  expect(matchesTextChanges("all", [{ from: 0, to: 3, text: "" }], "")).toBe(
    true,
  );
});

it("agrees with replay across replacements, insertions and deletions in a Unicode corpus", () => {
  const source = "A😀\r\nবাংলা \nwords";
  for (let start = 0; start <= source.length; start++) {
    for (let end = start; end <= source.length; end++) {
      for (const text of ["", "x", "😀\r\n"]) {
        const changes: TextChange[] = [{ from: start, to: end, text }];
        if (end < source.length)
          changes.push({ from: end, to: end, text: "!" });
        const expected = applyTextChanges(source, changes);
        expect(matchesTextChanges(source, changes, expected)).toBe(true);
        if (expected.length) {
          const index = Math.floor(expected.length / 2);
          const altered = `${expected.slice(0, index)}\u0000${expected.slice(index + 1)}`;
          expect(matchesTextChanges(source, changes, altered)).toBe(false);
        }
      }
    }
  }
});

it("compares independently decoded large documents and rejects changed unchanged spans", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const source = decoder.decode(
    encoder.encode(`😀\r\n${"word ".repeat(70000)}tail`),
  );
  const changes = [
    { from: 2, to: 2, text: "বাংলা" },
    { from: source.length - 4, to: source.length, text: "END!" },
  ];
  const result = decoder.decode(
    encoder.encode(applyTextChanges(source, changes)),
  );
  expect(matchesTextChanges(source, changes, result)).toBe(true);
  const altered = `${result.slice(0, 100_000)}X${result.slice(100_001)}`;
  expect(altered.length).toBe(result.length);
  expect(matchesTextChanges(source, changes, altered)).toBe(false);
});
