import { expect, it } from "vitest";
import {
  defaultEditorPreferences,
  parseEditorPreferences,
} from "../src/editorPreferences";

it.each([
  [false, false],
  [true, true],
  [undefined, true],
  ["false", true],
])("validates selection-pair preference %j", (value, expected) => {
  expect(
    parseEditorPreferences({
      version: 1,
      smartLists: {},
      selectionPairs: value,
    }).selectionPairs,
  ).toBe(expected);
});

it.each([
  undefined,
  null,
  [],
  "bad",
  { version: 2, smartLists: {} },
  { version: 1 },
  { version: 1, smartLists: [] },
])("defaults unsupported editor preferences: %j", (value) => {
  expect(parseEditorPreferences(value)).toEqual(defaultEditorPreferences);
});

it("retains explicit disabled rules and defaults individual invalid fields", () => {
  expect(
    parseEditorPreferences({
      version: 1,
      smartLists: { continuation: false, indent: false, move: false },
    }).smartLists,
  ).toEqual({ continuation: false, indent: false, move: false });
  expect(
    parseEditorPreferences({
      version: 1,
      smartLists: { continuation: "false", indent: 0, move: null },
    }),
  ).toEqual(defaultEditorPreferences);
  expect(
    parseEditorPreferences({
      version: 1,
      smartLists: {
        continuation: true,
        indent: false,
        move: true,
        unknown: true,
      },
    }).smartLists,
  ).toEqual({ continuation: true, indent: false, move: true });
  expect(Object.isFrozen(defaultEditorPreferences.smartLists)).toBe(true);
});

it.each([
  "wikiCompletion",
  "tagCompletion",
  "dateCompletion",
  "smartTables",
  "pasteRichText",
  "pasteLinks",
  "pasteImages",
  "pasteTables",
] as const)(
  "validates optional %s independently and defaults older settings",
  (rule) => {
    for (const [value, expected] of [
      [false, false],
      [true, true],
      [undefined, true],
      ["false", true],
    ] as const) {
      const preferences = parseEditorPreferences({
        version: 1,
        smartLists: {},
        [rule]: value,
      });
      expect(preferences[rule]).toBe(expected);
      expect(
        preferences[
          rule === "wikiCompletion" ? "tagCompletion" : "wikiCompletion"
        ],
      ).toBe(true);
    }
  },
);
