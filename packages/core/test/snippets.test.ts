import { expect, it } from "vitest";
import {
  createSnippetIndex,
  matchSnippet,
  readSnippetConfiguration,
  resolveSnippets,
} from "../src/snippets";

const config = (snippets: unknown[]) =>
  readSnippetConfiguration({ version: 1, snippets, custom: "kept" });
it("validates definitions without mutating unknown metadata or imposing executable interpolation", () => {
  const source = {
    version: 1,
    custom: "keep",
    snippets: [
      { trigger: ";sig", body: "${1:Name}\n$0", extra: { keep: true } },
    ],
  };
  const before = JSON.stringify(source),
    result = readSnippetConfiguration(source);
  expect(result).toMatchObject({
    custom: "keep",
    snippets: [
      {
        trigger: ";sig",
        name: ";sig",
        enabled: true,
        expandOn: "tab",
        extra: { keep: true },
      },
    ],
  });
  expect(JSON.stringify(source)).toBe(before);
  expect(
    config([
      {
        trigger: "🙂",
        name: "Emoji",
        body: "",
        expandOn: "space",
        enabled: false,
      },
    ]).snippets[0]!.enabled,
  ).toBe(false);
});
it.each([
  null,
  [],
  { version: 2, snippets: [] },
  { version: 1 },
  { version: 1, snippets: [null] },
  { version: 1, snippets: [{ trigger: "a b", body: "" }] },
  { version: 1, snippets: [{ trigger: "a", body: 1 }] },
  { version: 1, snippets: [{ trigger: "a", body: "", name: "" }] },
  { version: 1, snippets: [{ trigger: "a", body: "", enabled: 1 }] },
  { version: 1, snippets: [{ trigger: "a", body: "", expandOn: "enter" }] },
  { version: 1, snippets: [{ trigger: "a", body: "${1:no closing" }] },
])("reports invalid configuration %j", (source) => {
  expect(() => readSnippetConfiguration(source)).toThrow();
});
it("rejects duplicate, oversized or control-containing triggers and oversized catalogs", () => {
  expect(() =>
    config([
      { trigger: ";x", body: "" },
      { trigger: ";x", body: "" },
    ]),
  ).toThrow("Duplicate");
  for (const trigger of ["", "x".repeat(65), "x\n", "x\u007f"])
    expect(() => config([{ trigger, body: "" }])).toThrow("1–64");
  expect(() =>
    config(
      Array.from({ length: 1001 }, (_, i) => ({ trigger: ";" + i, body: "" })),
    ),
  ).toThrow("1000");
});
it("lets Space definitions override or disable global definitions by exact trigger", () => {
  const global = config([
    { trigger: ";x", body: "global" },
    { trigger: ";y", body: "global y" },
    { trigger: ";z", body: "global z" },
  ]);
  const space = config([
    { trigger: ";x", body: "local" },
    { trigger: ";y", body: "", enabled: false },
  ]);
  const result = resolveSnippets(global, space);
  expect(
    result.map((entry) => [entry.trigger, entry.body, entry.origin]),
  ).toEqual([
    [";x", "local", "space"],
    [";z", "global z", "global"],
  ]);
  expect(global.snippets[0]!.body).toBe("global");
});
it("matches the longest eligible trigger with Unicode boundaries and configured activation keys", () => {
  const snippets = resolveSnippets(
    config([
      { trigger: "sig", body: "short" },
      { trigger: ";sig", body: "long", expandOn: "both" },
      { trigger: ";s", body: "space", expandOn: "space" },
      { trigger: "🙂", body: "emoji" },
    ]),
    config([]),
  );
  const index = createSnippetIndex(snippets);
  expect(index.maxLength).toBe(4);
  expect(matchSnippet(index, "Hello ;sig", "tab")?.body).toBe("long");
  expect(matchSnippet(index, ";sig", "space")?.body).toBe("long");
  expect(matchSnippet(index, ";s", "tab")).toBeUndefined();
  expect(matchSnippet(index, ";s", "space")?.body).toBe("space");
  for (const source of [
    "word;sig",
    "বাংলা;sig",
    "𐐀;sig",
    "a\u0301;sig",
    "\\;sig",
    "not-a-trigger",
  ])
    expect(matchSnippet(index, source, "tab")).toBeUndefined();
  expect(matchSnippet(index, "*;sig", "tab")?.trigger).toBe(";sig");
  expect(matchSnippet(index, " 🙂", "tab")?.body).toBe("emoji");
  expect(matchSnippet(createSnippetIndex([]), "", "tab")).toBeUndefined();
});
