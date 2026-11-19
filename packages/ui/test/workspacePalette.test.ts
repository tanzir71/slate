import { expect, it } from "vitest";
import { markdownHeadings, parseSheet, readCustomBlock } from "@slate/core";
import { paletteIdentity, workspacePalette } from "../src/browser/workspacePalette";

it("keeps duplicate titles as literal paths and uses cached heading byte positions", () => {
  const source = "\uFEFF# Same\r\n\r\n## বাংলা\r\n";
  const files = [{ path: "a/one.md", content: source }, { path: "b/two.md", content: source }];
  const documents = files.map(({ path, content }) => ({ ...parseSheet(content, path), headings: markdownHeadings(content) }));
  const catalog = workspacePalette({ commands: [], files, documents, blocks: [], templates: [], snippets: [] });
  const sheets = catalog.index.search("Same", { mode: "sheets" }).items;
  expect(sheets.map(({ detail }) => detail)).toEqual(["a/one.md", "b/two.md"]);
  expect(catalog.actions.get(paletteIdentity(sheets[1]!))).toEqual({ kind: "sheets", path: "b/two.md" });
  const headings = catalog.index.search("বাংলা", { mode: "headings" }).items;
  expect(headings).toHaveLength(2);
  expect(catalog.actions.get(paletteIdentity(headings[1]!))).toEqual({ kind: "headings", path: "b/two.md", source, position: source.indexOf("##") });
  expect(files[1]?.content).toBe(source);
});
it("offers unknown encodings and pending metadata by path without parsing source on the main thread", () => {
  const source = "# Must not parse";
  const files = [{ path: "bad.md", content: "", unsupportedEncoding: true }, { path: "pending.md", content: source }];
  const catalog = workspacePalette({ commands: [], files, documents: [], blocks: [], templates: [], snippets: [] });
  expect(catalog.index.search("", { mode: "sheets" }).items.map(({ id }) => id)).toEqual(["bad.md", "pending.md"]);
  expect(catalog.index.search("", { mode: "headings" }).items).toEqual([]);
});
it("keeps snippet scope identities separate and points block rows to the actual insertion catalog", () => {
  const catalog = workspacePalette({ commands: [], files: [], documents: [], blocks: [], templates: [], snippets: [
    { origin: "space", trigger: ";sig", name: "Signature", body: "My words", expandOn: "tab", enabled: true },
  ] });
  const snippet = catalog.index.search("sig", { mode: "snippets" }).items[0]!;
  expect(catalog.actions.get(paletteIdentity(snippet))).toMatchObject({ kind: "snippets", definition: { origin: "space", trigger: ";sig", body: "My words" } });
  const block = catalog.index.search("h2", { mode: "blocks" }).items[0]!;
  expect(catalog.actions.get(paletteIdentity(block))).toEqual({ kind: "blocks", id: "heading2" });
  expect(block.detail).toContain("after the current block");
});
it("captures the exact custom definition for its preview and later source check", () => {
  const source = "\uFEFF---\r\nname: My fragment\r\n---\r\nOriginal words.\r\n";
  const block = readCustomBlock(source, ".slate/blocks/fragment.md");
  const catalog = workspacePalette({ commands: [], files: [], documents: [], blocks: [block], templates: [], snippets: [] });
  const entry = catalog.index.search("fragment", { mode: "blocks" }).items[0]!;
  expect(entry.label).toBe("fragment");
  expect(catalog.actions.get(paletteIdentity(entry))).toEqual({ kind: "blocks", id: block.id, source });
});
