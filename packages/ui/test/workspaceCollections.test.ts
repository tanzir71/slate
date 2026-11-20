import { expect, it } from "vitest";
import { parseSheet, type SheetDocument } from "@slate/core";
import { filterWorkspaceDocuments, notebookCounts, workspaceTagSummary } from "../src/browser/workspaceCollections";

it("counts exact notebook ancestors with case, Unicode and sibling boundaries intact", () => {
  const paths = Object.freeze(["root.md", "Work/one.md", "Work/Projects/a.md", "Work/Projects2/b.md", "work/c.md", "বাংলা/গল্প/নোট.md", "__proto__/safe.md"]);
  const counts = notebookCounts(paths);
  expect([...counts]).toEqual([["Work", 3], ["Work/Projects", 1], ["Work/Projects2", 1], ["work", 1], ["বাংলা", 1], ["বাংলা/গল্প", 1], ["__proto__", 1]]);
  expect(counts.has("Work/Project")).toBe(false);
  expect(notebookCounts(["Work/one.md", "Work/one.md"]).get("Work")).toBe(2);
});

it("counts one note per tag ancestor while showing only actual tags", () => {
  const documents = [
    ["work", "work/project", "work/project/review", "work", "বাংলা/গল্প"],
    ["work/project", "workshop", "Work/project"],
    ["বাংলা", "workbench"],
  ].map(paths => ({ tags: paths.map(path => ({ ...parseSheet("#work", "tag.md").tags[0]!, path })) }));
  const before = JSON.stringify(documents), summary = workspaceTagSummary(documents);
  expect(summary.tags).toEqual(["Work/project", "work", "work/project", "work/project/review", "workbench", "workshop", "বাংলা", "বাংলা/গল্প"]);
  expect(summary.counts.get("work")).toBe(2); expect(summary.counts.get("work/project")).toBe(2);
  expect(summary.counts.get("workshop")).toBe(1); expect(summary.counts.get("workbench")).toBe(1);
  expect(summary.counts.get("Work")).toBe(1); expect(summary.tags).not.toContain("Work");
  expect(summary.counts.get("বাংলা")).toBe(2);
  expect(JSON.stringify(documents)).toBe(before);
  const changed = workspaceTagSummary([documents[2]!]);
  expect(changed.tags).toEqual(["workbench", "বাংলা"]); expect(changed.counts.has("work")).toBe(false);
});

const documents = [
  parseSheet("---\nstatus: Draft\nupdated: 2026-11-17T12:00:00Z\ngoal: { type: words, target: 100 }\n---\n# Alpha\n\nNeedle #work/project", "Inbox/Alpha.md"),
  parseSheet("# Beta\n\nOther words #work", "Work/Beta.md"),
  parseSheet("# Gamma\n\nNeedle #workshop", "Workshop/Gamma.md"),
];
const paths = (result: readonly SheetDocument[]) => result.map(sheet => sheet.path);
it("combines notebook, pin, metadata, tag and fallback-text filters without changing input order", () => {
  const before = JSON.stringify(documents), pinned = [documents[1]!.path, documents[2]!.path];
  expect(paths(filterWorkspaceDocuments(documents, "", [], "", undefined))).toEqual(documents.map(sheet => sheet.path));
  expect(paths(filterWorkspaceDocuments(documents, "#work", [], "", undefined))).toEqual(["Inbox/Alpha.md", "Work/Beta.md"]);
  expect(paths(filterWorkspaceDocuments(documents, "#work", [], "NEEDLE", undefined))).toEqual(["Inbox/Alpha.md"]);
  expect(paths(filterWorkspaceDocuments(documents, "Work", [], "beta", undefined))).toEqual(["Work/Beta.md"]);
  expect(paths(filterWorkspaceDocuments(documents, "@pinned", pinned, "needle", undefined))).toEqual(["Workshop/Gamma.md"]);
  for (const filter of ["@drafts", "@goals"]) expect(paths(filterWorkspaceDocuments(documents, filter, [], "", undefined))).toEqual(["Inbox/Alpha.md"]);
  expect(paths(filterWorkspaceDocuments(documents, "", [], " ", undefined))).toEqual(documents.map(sheet => sheet.path));
  expect(JSON.stringify(documents)).toBe(before);
});
it("distinguishes pending and empty index results and retains exact path membership", () => {
  expect(paths(filterWorkspaceDocuments(documents, "", [], "needle", undefined))).toEqual(["Inbox/Alpha.md", "Workshop/Gamma.md"]);
  expect(filterWorkspaceDocuments(documents, "", [], "needle", [])).toEqual([]);
  expect(paths(filterWorkspaceDocuments(documents, "", [], "needle", ["Work/Beta.md", "Work/Beta.md"]))).toEqual(["Work/Beta.md"]);
  expect(filterWorkspaceDocuments(documents, "", [], "needle", ["WORK/BETA.MD"])).toEqual([]);
  expect(paths(filterWorkspaceDocuments(documents, "", [], "needle", ["Workshop/Gamma.md", "Inbox/Alpha.md"]))).toEqual(["Inbox/Alpha.md", "Workshop/Gamma.md"]);
  expect(paths(filterWorkspaceDocuments(documents, "", [], "", []))).toEqual(documents.map(sheet => sheet.path));
  expect(filterWorkspaceDocuments(documents, "Work", [], "needle", ["Inbox/Alpha.md"])).toEqual([]);
});
it("uses set membership for a large indexed result without rereading note bodies", () => {
  const base = documents[0]!;
  const many = Array.from({ length: 10_000 }, (_, index) => ({ ...base, path: `Note ${index}.md`, get raw(): string { throw new Error("Indexed search must not rescan note bodies"); } }));
  const matches = new Proxy(many.map(sheet => sheet.path), { get(target, key, receiver) {
    if (key === "includes") throw new Error("Avoid a result-array scan per note");
    return Reflect.get(target, key, receiver);
  } });
  expect(filterWorkspaceDocuments(many, "", [], "needle", matches)).toHaveLength(10_000);
});
it("uses the supplied recent-filter clock consistently without persisting it", () => {
  expect(paths(filterWorkspaceDocuments(documents, "@recent", [], "", undefined, new Date("2026-11-18T12:00:00Z")))).toEqual(["Inbox/Alpha.md"]);
  expect(filterWorkspaceDocuments(documents, "@recent", [], "", undefined, new Date("2026-11-26T12:00:00Z"))).toEqual([]);
  expect(documents[0]!.frontmatter.updated).toBe("2026-11-17T12:00:00Z");
});
