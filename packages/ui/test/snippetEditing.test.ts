import { expect, it } from "vitest";
import type { SnippetFile } from "../../storage/src/browserSnippets";
import { readSnippetConfiguration } from "@slate/core";
import {
  editSnippetSource,
  snippetFileSource,
  type SnippetDraft,
} from "../src/snippets/snippetEditing";

const draft: SnippetDraft = {
  scope: "space",
  name: "Test",
  trigger: ";x",
  body: "${1:Name}$0",
  expandOn: "both",
  enabled: true,
};
const missing: SnippetFile = {
  status: "missing",
  path: ".slate/snippets.json",
};
it("adds a normal definition and only materializes global built-ins when that scope is explicitly saved", () => {
  expect(JSON.parse(editSnippetSource(missing, draft)).snippets).toEqual([
    {
      name: "Test",
      trigger: ";x",
      body: "${1:Name}$0",
      expandOn: "both",
      enabled: true,
    },
  ]);
  expect(
    JSON.parse(
      snippetFileSource({ ...missing, path: "global/snippets.json" }, "global"),
    ).snippets,
  ).toHaveLength(3);
});
it("edits and renames one definition while preserving unrelated values and unknown metadata", () => {
  const value = {
    version: 1,
    custom: { keep: true },
    snippets: [
      { trigger: ";old", body: "old", keep: "extra" },
      { trigger: ";other", body: "other", future: [1, 2] },
    ],
  };
  const file: SnippetFile = {
    ...missing,
    status: "valid",
    source: JSON.stringify(value),
    configuration: readSnippetConfiguration(value),
  };
  const edited = JSON.parse(
    editSnippetSource(file, { ...draft, originalTrigger: ";old" }),
  );
  expect(edited.custom).toEqual({ keep: true });
  expect(edited.snippets[0]).toMatchObject({
    trigger: ";x",
    keep: "extra",
    expandOn: "both",
  });
  expect(edited.snippets[1]).toEqual(value.snippets[1]);
  expect(file.source).toBe(JSON.stringify(value));
});
it("rejects duplicate triggers, invalid bodies and invalid source rather than changing the original", () => {
  const value = {
    version: 1,
    snippets: [
      { trigger: ";x", body: "original" },
      { trigger: ";other", body: "other" },
    ],
  };
  const file: SnippetFile = {
    ...missing,
    status: "valid",
    source: JSON.stringify(value),
  };
  expect(() => editSnippetSource(file, draft)).toThrow("already exists");
  expect(() =>
    editSnippetSource(file, { ...draft, originalTrigger: ";other" }),
  ).toThrow("already exists");
  expect(() =>
    editSnippetSource(missing, { ...draft, body: "${1:unclosed" }),
  ).toThrow();
  expect(() =>
    editSnippetSource({ ...missing, status: "invalid", source: "bad" }, draft),
  ).toThrow("Repair");
  expect(file.source).toBe(JSON.stringify(value));
});
it("shows unknown bytes as unavailable source rather than inventing a default over them", () => {
  for (const status of ["unsupported", "unavailable"] as const)
    expect(snippetFileSource({ ...missing, status }, "global")).toBe("");
  expect(
    snippetFileSource({ ...missing, status: "invalid", source: "" }, "space"),
  ).toBe("");
});
