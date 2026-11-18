import { expect, it } from "vitest";
import {
  defaultEditorPreferences,
  parseEditorPreferences,
} from "../src/editorPreferences";

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
