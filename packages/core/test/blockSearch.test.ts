import { expect, it } from "vitest";
import { builtinBlocks, searchBuiltinBlocks } from "../src/index";

it("returns every built-in in catalog order without history or a query", () => {
  expect(searchBuiltinBlocks("")).toEqual(builtinBlocks);
});

it.each([
  ["ta", "table"],
  ["h2", "heading2"],
  ["CODE", "codeblock"],
  ["cde", "codeblock"],
  ["gríd", "table"],
  ["[]", "task"],
  ["fn", "footnote"],
  ["today", "date"],
])("finds %s by prefix, alias or fuzzy match", (query, id) => {
  expect(searchBuiltinBlocks(query)[0]?.id).toBe(id);
});

it("uses decaying frequency within a match tier and never promotes fuzzy over a prefix", () => {
  const now = 100 * 86_400_000;
  const history = {
    table: { count: 1, lastUsed: now },
    tag: { count: 500, lastUsed: 0 },
    task: { count: 20, lastUsed: now },
    footnote: { count: 10_000, lastUsed: now },
  };
  expect(searchBuiltinBlocks("", history, now)[0]?.id).toBe("footnote");
  expect(searchBuiltinBlocks("ta", history, now)[0]?.id).toBe("task");
  expect(searchBuiltinBlocks("table", history, now)[0]?.id).toBe("table");
  expect(searchBuiltinBlocks("unmatchable")).toEqual([]);
  expect(
    searchBuiltinBlocks("", { table: { count: NaN, lastUsed: 1 } }),
  ).toEqual(builtinBlocks);
});
