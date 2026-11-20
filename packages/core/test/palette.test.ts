import { describe, expect, it, vi } from "vitest";
import { createPaletteIndex, parsePaletteQuery, type PaletteEntry } from "../src/palette";

const entries: PaletteEntry[] = [
  { id: "tidy.document", kind: "commands", label: "Tidy document", detail: "Edit" },
  { id: "tidy.batch", kind: "commands", label: "Batch Tidy", aliases: ["Tidy notebook"] },
  { id: "docs/tidy.md", kind: "sheets", label: "Tidy rules", detail: "Work / docs" },
  { id: "draft", kind: "tags", label: "#draft", aliases: ["draft"] },
  { id: "plan.md:42", kind: "headings", label: "Goals", detail: "Launch plan" },
  { id: "table", kind: "blocks", label: "Table", aliases: ["grid"] },
  { id: "space/signature", kind: "snippets", label: "Signature", aliases: ["sig"] },
];

describe("palette query modes", () => {
  it.each([
    ["tidy", "all", "tidy"], ["> tidy", "commands", "tidy"], [" #draft", "tags", "draft"],
    ["@ Goals", "headings", "Goals"], ["/grid", "blocks", "grid"], ["; sig", "snippets", "sig"],
    ["", "all", ""], ["   ", "all", ""], ["#", "tags", ""],
  ] as const)("parses %s without changing its literal search text", (input, mode, text) => {
    expect(parsePaletteQuery(input)).toEqual({ mode, text });
  });
  it("defaults quick open to sheets and lets an explicit prefix switch modes", () => {
    expect(parsePaletteQuery("Work/Plan", "sheets")).toEqual({ mode: "sheets", text: "Work/Plan" });
    expect(parsePaletteQuery(">save", "sheets")).toEqual({ mode: "commands", text: "save" });
  });
});

describe("indexed palette search", () => {
  const index = createPaletteIndex(entries);
  it("finds commands and files together, while explicit modes filter every result", () => {
    expect(index.search("tidy").items.map((item) => item.id)).toEqual(["tidy.document", "docs/tidy.md", "tidy.batch"]);
    for (const [query, id] of [["#draft", "draft"], ["@Goals", "plan.md:42"], ["/grid", "table"], [";sig", "space/signature"]]) {
      expect(index.search(query!).items.map((item) => item.id)).toEqual([id]);
    }
    expect(index.search("tidy", { mode: "sheets" }).items.map((item) => item.id)).toEqual(["docs/tidy.md"]);
  });
  it("ranks exact, prefix and word matches ahead of substring and subsequence matches", () => {
    const choices = createPaletteIndex([
      { id: "fuzzy", kind: "sheets", label: "Tropical island diary" },
      { id: "substring", kind: "sheets", label: "Untidy" },
      { id: "word", kind: "sheets", label: "A tidy note" },
      { id: "later-word", kind: "sheets", label: "Untidy then tidy" },
      { id: "prefix", kind: "sheets", label: "Tidy rules" },
      { id: "exact", kind: "sheets", label: "Tidy" },
    ]);
    expect(choices.search("tidy").items.map((item) => item.id)).toEqual(["exact", "prefix", "word", "later-word", "substring", "fuzzy"]);
  });
  it.each([" ", "/", "-", "_"])("keeps a later word boundary %s ahead of an earlier unbounded substring", (separator) => {
    const choices = createPaletteIndex([
      { id: "substring", kind: "sheets", label: "Untidy" },
      { id: "word", kind: "sheets", label: `Untidy${separator}tidy` },
    ]);
    expect(choices.search("tidy").items.map((entry) => entry.id)).toEqual(["word", "substring"]);
  });
  it("checks a missing contiguous query once before the existing subsequence match", () => {
    const choices = createPaletteIndex([{ id: "row", kind: "sheets", label: "Sigma" }]);
    const original = { includes: String.prototype.includes, startsWith: String.prototype.startsWith, indexOf: String.prototype.indexOf };
    let scans = 0;
    const includes = vi.spyOn(String.prototype, "includes").mockImplementation(function (this: string, needle: string, position?: number) {
      if (String(this) === "sigma" && (needle === "sma" || needle.slice(1) === "sma")) scans++;
      return original.includes.call(this, needle, position);
    });
    const startsWith = vi.spyOn(String.prototype, "startsWith").mockImplementation(function (this: string, needle: string, position?: number) {
      if (String(this) === "sigma" && needle === "sma") scans++;
      return original.startsWith.call(this, needle, position);
    });
    const indexOf = vi.spyOn(String.prototype, "indexOf").mockImplementation(function (this: string, needle: string, position?: number) {
      if (String(this) === "sigma" && needle === "sma") scans++;
      return original.indexOf.call(this, needle, position);
    });
    let result;
    try { result = choices.search("sma"); } finally { includes.mockRestore(); startsWith.mockRestore(); indexOf.mockRestore(); }
    expect(result?.items.map((entry) => entry.id)).toEqual(["row"]);
    expect(scans).toBeLessThanOrEqual(1);
  });
  it("searches aliases and paths, preserving identical titles in separate notebooks", () => {
    const choices = createPaletteIndex([
      { id: "Work/Plan.md", kind: "sheets", label: "Plan", detail: "Work" },
      { id: "Home/Plan.md", kind: "sheets", label: "Plan", detail: "Home" },
    ]);
    expect(choices.search("Plan").items).toHaveLength(2);
    expect(choices.search("Home/Plan.md").items.map((item) => item.id)).toEqual(["Home/Plan.md"]);
    expect(index.search("/grid").items[0]?.id).toBe("table");
  });
  it("folds Latin accents while preserving meaningful marks in other scripts", () => {
    const choices = createPaletteIndex([
      { id: "accent", kind: "sheets", label: "Café" },
      { id: "vowel", kind: "sheets", label: "কলাম" },
      { id: "plain", kind: "sheets", label: "কলম" },
    ]);
    expect(choices.search("CAFE").items[0]?.id).toBe("accent");
    expect(choices.search("কলম").items[0]?.id).toBe("plain");
  });
  it("retains Unicode code points and existing order in subsequence matching", () => {
    const choices = createPaletteIndex([
      { id: "fuzzy", kind: "sheets", label: "x🙂ya" },
      { id: "exact", kind: "sheets", label: "🙂a" },
      { id: "split-surrogate", kind: "sheets", label: "x\uD83Dya\uDE42" },
    ]);
    expect(choices.search("🙂a").items.map((entry) => entry.id)).toEqual(["exact", "fuzzy"]);
  });
  it("reads a query's code points once across all candidate fields", () => {
    const choices = createPaletteIndex([{ id: "row", kind: "sheets", label: "Sigma" }]);
    const original = String.prototype[Symbol.iterator];
    let reads = 0;
    const iterator = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (this: string) {
      if (String(this) === "sma") reads++;
      return original.call(this);
    });
    let result;
    try { result = choices.search("sma"); } finally { iterator.mockRestore(); }
    expect(result?.items.map((entry) => entry.id)).toEqual(["row"]);
    expect(reads).toBeLessThanOrEqual(1);
  });
  it("captures immutable metadata until a new index is built", () => {
    const source = [{ id: "one", kind: "sheets" as const, label: "Original", aliases: ["first"] }];
    const captured = createPaletteIndex(source);
    source[0]!.label = "Changed"; source[0]!.aliases.push("later"); source.push({ id: "two", kind: "sheets", label: "New", aliases: [] });
    expect(captured.search("Original").items[0]?.label).toBe("Original");
    expect(captured.search("later").total).toBe(0);
    expect(captured.search("New").total).toBe(0);
    expect(createPaletteIndex(source).search("New").items[0]?.id).toBe("two");
  });
  it("keeps the best late result and total count while bounding a 10k-sheet result list", () => {
    const choices = createPaletteIndex(Array.from({ length: 10_000 }, (_, value) => ({
      id: `Folder/Note ${value}.md`, kind: "sheets", label: `Note ${value}`,
    })));
    expect(choices.search("Note").items).toHaveLength(30);
    expect(choices.search("Note").total).toBe(10_000);
    expect(choices.search("Note 9999", { limit: 1 }).items[0]?.id).toBe("Folder/Note 9999.md");
    expect(choices.search("Note", { limit: 0 })).toMatchObject({ items: [], total: 10_000 });
  });
  it.each(["0", "5", "9"])("rejects impossible repeated-%s fields before scanning a real 10k-sheet and heading corpus", digit => {
    const choices = createPaletteIndex(Array.from({ length: 10_000 }, (_, value) => {
      const title = `Note ${String(value).padStart(5, "0")}`;
      return [{ id: `Folder/${title}.md`, kind: "sheets" as const, label: title },
        { id: `Folder/${title}.md:heading`, kind: "headings" as const, label: title }];
    }).flat());
    const title = `Note 0${digit.repeat(4)}`, original = String.prototype.indexOf;
    let scans = 0;
    const scan = vi.spyOn(String.prototype, "indexOf").mockImplementation(function (this: string, needle: string, position?: number) {
      if (/^(?:folder\/)?note \d{5}/.test(String(this))) scans++;
      return original.call(this, needle, position);
    });
    let result;
    try { result = choices.search(title); } finally { scan.mockRestore(); }
    expect(result?.total).toBe(2);
    expect(result?.items.map(entry => entry.id)).toEqual([`Folder/${title}.md`, `Folder/${title}.md:heading`]);
    expect(scans).toBeLessThan(100);
  });
  it.each([
    ["ete9999", "accent-alias"], ["৯৯৯৯", "bengali"], ["🙂9🙂9🙂9🙂9", "emoji"],
    ["a:b9+9", "punctuation"], ["aaaaa", "saturated"], ["nine 9999", "secondary"],
    ["nine 99999", "secondary"], ["5555", "signed-bit"],
  ] as const)("preserves literal matches for repeated, Unicode and secondary query %s", (query, id) => {
    const choices = createPaletteIndex([
      { id: "accent-alias", kind: "sheets", label: "Angstrom", aliases: ["Été9999"] },
      { id: "bengali", kind: "sheets", label: "৯৯৯৯" },
      { id: "emoji", kind: "sheets", label: "a🙂9🙂9🙂9🙂9" },
      { id: "punctuation", kind: "sheets", label: "alpha:beta9+9+9+9" },
      { id: "saturated", kind: "sheets", label: "aaaaaaaa" },
      { id: "secondary", kind: "sheets", label: "Nine 999", detail: "nine 9999", aliases: ["nine 99999"] },
      { id: "signed-bit", kind: "sheets", label: "x5555" },
    ]);
    expect(choices.search(query)).toMatchObject({ total: 1, items: [{ id }] });
    expect(choices.search(query, { limit: 0 })).toMatchObject({ total: 1, items: [] });
    expect(choices.search(query, { accept: () => false })).toMatchObject({ total: 0, items: [] });
  });
  it("keeps repeated-character rejection conservative beyond the cached count bound", () => {
    const choices = createPaletteIndex([{ id: "row", kind: "sheets", label: "aaaaaaaa" }]);
    expect(choices.search("aaaaaaaa").total).toBe(1);
    expect(choices.search("aaaaaaaaa").total).toBe(0);
  });
  it("keeps character-cache buffer allocations constant across a 10k-sheet index", () => {
    const entries = Array.from({ length: 10_000 }, (_, value) => ({
      id: `Folder/Note ${value}.md`, kind: "sheets" as const, label: `Note ${value}`,
    }));
    let allocations = 0;
    vi.stubGlobal("Uint32Array", new Proxy(Uint32Array, {
      construct(target, argumentsList: unknown[]) { allocations++; return Reflect.construct(target, argumentsList) as Uint32Array; },
    }));
    let choices;
    try { choices = createPaletteIndex(entries); } finally { vi.unstubAllGlobals(); }
    expect(choices?.search("Note 9999").items[0]?.id).toBe("Folder/Note 9999.md");
    expect(allocations).toBeLessThanOrEqual(2);
  });
  it("returns no false action for an unmatched query or an invalid result limit", () => {
    expect(index.search("zzzzzzz")).toMatchObject({ items: [], total: 0 });
    for (const limit of [-1, 0.5, NaN, Infinity, 101]) expect(() => index.search("", { limit })).toThrow();
  });
  it("filters unavailable actions before counting and bounding ranked results", () => {
    const entries = Array.from({ length: 60 }, (_, value) => ({ id: String(value), kind: "commands" as const, label: `Table ${value}` }));
    const choices = createPaletteIndex(entries);
    const result = choices.search("Table", { limit: 2, accept: (entry) => Number(entry.id) >= 58 });
    expect(result.total).toBe(2); expect(result.items.map((entry) => entry.id)).toEqual(["58", "59"]);
    expect(choices.search("", { accept: () => false })).toEqual({ mode: "all", items: [], total: 0 });
  });
  it("scores each distinct normalized field once while preserving literal metadata", () => {
    const entry: PaletteEntry = { id: "Folder/Sigma.md", kind: "sheets", label: "Sigma", detail: "folder/sigma.md", aliases: ["SIGMA", "FOLDER/SIGMA.MD"] };
    const choices = createPaletteIndex([entry]);
    const original = String.prototype.indexOf;
    let pathScans = 0, labelScans = 0;
    const scan = vi.spyOn(String.prototype, "indexOf").mockImplementation(function (this: string, needle: string, position?: number) {
      if (needle === "s") {
        if (String(this) === "folder/sigma.md") pathScans++;
        if (String(this) === "sigma") labelScans++;
      }
      return original.call(this, needle, position);
    });
    let result;
    try { result = choices.search("sma"); } finally { scan.mockRestore(); }
    expect(result).toEqual({ mode: "all", total: 1, items: [entry] });
    expect(pathScans).toBe(1); expect(labelScans).toBe(1);
  });
  it("keeps empty-query order, full counts and context filtering for every mode and limit", () => {
    const ordered: PaletteEntry[] = [
      { id: "c", kind: "commands", label: "Zulu" },
      { id: "a", kind: "sheets", label: "Café" },
      { id: "b", kind: "sheets", label: "CAFE" },
      { id: "z", kind: "sheets", label: "Zulu" },
      { id: "t", kind: "tags", label: "#keep" },
      { id: "h", kind: "headings", label: "Goals" },
      { id: "x", kind: "blocks", label: "Table" },
      { id: "s", kind: "snippets", label: "Signature" },
    ];
    const choices = createPaletteIndex([...ordered].reverse());
    for (const mode of ["all", "commands", "sheets", "tags", "headings", "blocks", "snippets"] as const) {
      for (const limit of [0, 1, 8, 30, 100]) {
        const expected = ordered.filter((entry) => mode === "all" || entry.kind === mode);
        expect(choices.search("", { mode, limit })).toEqual({ mode, total: expected.length, items: expected.slice(0, limit) });
        const visible = expected.filter((entry) => entry.id !== "a");
        expect(choices.search("", { mode, limit, accept: (entry) => entry.id !== "a" })).toEqual({ mode, total: visible.length, items: visible.slice(0, limit) });
      }
    }
  });
});
