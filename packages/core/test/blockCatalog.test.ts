import { expect, it } from "vitest";
import {
  builtinBlocks,
  readCustomBlock,
  searchBlockCatalog,
  searchBuiltinBlocks,
} from "../src/index";
it("ranks custom names and nested aliases with the same prefix/fuzzy/frecency rules as built-ins", () => {
  const custom = readCustomBlock(
    "> Quote",
    ".slate/blocks/Work/Client notes.md",
  );
  const catalog = [...builtinBlocks, custom];
  expect(searchBlockCatalog(catalog, "client")[0]).toBe(custom);
  expect(searchBlockCatalog(catalog, "work/client")[0]).toBe(custom);
  expect(searchBlockCatalog(catalog, "clnt")[0]).toBe(custom);
  expect(
    searchBlockCatalog(
      catalog,
      "",
      { [custom.id]: { count: 2, lastUsed: 100 } },
      100,
    )[0],
  ).toBe(custom);
  expect(searchBlockCatalog(builtinBlocks, "table")).toEqual(
    searchBuiltinBlocks("table"),
  );
  expect(catalog.at(-1)).toBe(custom);
});
