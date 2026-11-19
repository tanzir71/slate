import { expect, it, vi } from "vitest";
import { readMarkdownTemplate, searchBlockCatalog } from "@slate/core";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createBrowserSpace } from "@slate/storage/browser-space";
import { createTemplateLibrary } from "../src/blocks/templateLibrary";
import {
  blockMenuOptionId,
  snippetMenuEntry,
  templateMenuEntry,
} from "../src/blocks/menuCatalog";
const path = ".slate/templates/Team/Review.md",
  id = "template:" + path,
  source = "# Review\n{{cursor}}";
const bundled = [
  {
    id: "builtin:plain",
    origin: "built-in" as const,
    template: readMarkdownTemplate("> Plain", "Plain"),
  },
];
const setup = () => {
  const files = createMemoryFiles({ [path]: source });
  return {
    files,
    library: createTemplateLibrary(
      createBrowserSpace(files),
      () => true,
      bundled,
    ),
  };
};
it("shares fuzzy metadata ranking and keeps snippet scopes and template IDs distinct", () => {
  const template = templateMenuEntry({
    id: path,
    path,
    origin: "space",
    template: readMarkdownTemplate(source, "Review"),
  });
  const snippet = snippetMenuEntry({
    trigger: ";review",
    name: "Review",
    body: "Review ${1:notes}",
    origin: "space",
    enabled: true,
    expandOn: "tab",
  });
  expect(searchBlockCatalog([template, snippet], "TeamReview")).toEqual([
    template,
  ]);
  expect(searchBlockCatalog([template, snippet], ";rev")).toEqual([snippet]);
  expect(
    snippetMenuEntry({ ...snippet.definition, origin: "global" }).id,
  ).not.toBe(snippet.id);
  expect(
    snippetMenuEntry({ ...snippet.definition, description: "A checklist" })
      .description,
  ).toBe("A checklist");
  expect(templateMenuEntry(bundled[0]!).id).not.toBe(template.id);
});
it("caches unchanged files and performs no file reads for metadata search or bundled choices", async () => {
  const { files, library } = setup();
  await library.refresh();
  const first = library.getSnapshot();
  await library.refresh();
  expect(library.getSnapshot()).toBe(first);
  const read = vi.spyOn(files, "read");
  expect(searchBlockCatalog(first.items, "review")[0]?.id).toBe(id);
  expect(
    (await library.resolve("template:builtin:plain", "> Plain")).label,
  ).toBe("Plain");
  expect(read).not.toHaveBeenCalled();
});
it("keeps bad files reviewable, fails closed for directory errors and recovers", async () => {
  const { files, library } = setup();
  await files.write(".slate/templates/Bad.md", new Uint8Array([255]));
  await library.refresh();
  expect(library.getSnapshot().records[0]?.error).toBeTruthy();
  expect(library.getSnapshot().items).toHaveLength(2);
  vi.spyOn(files, "list").mockRejectedValueOnce(
    new Error("Cannot list templates"),
  );
  await library.refresh();
  expect(library.getSnapshot()).toMatchObject({
    error: "Cannot list templates",
    records: [],
  });
  expect(library.getSnapshot().items).toHaveLength(1);
  await library.refresh();
  expect(library.getSnapshot().items).toHaveLength(2);
});
it("rejects stale rendered previews, changed disk source and removed files while preserving real contents", async () => {
  const { files, library } = setup();
  await library.refresh();
  await files.write(path, encodeText("> New"));
  await expect(library.resolve(id, source)).rejects.toThrow("changed");
  expect(
    library.getSnapshot().items.find((entry) => entry.id === id)?.item.template
      .source,
  ).toBe("> New");
  const read = vi.spyOn(files, "read");
  await expect(library.resolve(id, source)).rejects.toThrow("changed");
  expect(read).not.toHaveBeenCalled();
  expect((await library.resolve(id, "> New")).item.template.source).toBe(
    "> New",
  );
  await files.remove(path);
  await expect(library.resolve(id, "> New")).rejects.toThrow("removed");
});
it("checks ownership on both sides of asynchronous reads", async () => {
  let owned = true;
  const files = createMemoryFiles({ [path]: source }),
    library = createTemplateLibrary(
      createBrowserSpace(files),
      () => owned,
      bundled,
    );
  await library.refresh();
  owned = false;
  const read = vi.spyOn(files, "read");
  await expect(library.resolve(id, source)).rejects.toThrow("read-only");
  expect(read).not.toHaveBeenCalled();
  owned = true;
  read.mockImplementationOnce(async () => {
    owned = false;
    return encodeText(source);
  });
  await expect(library.resolve(id, source)).rejects.toThrow("read-only");
});
it("refreshes invalid encodings and read failures without inserting a stale definition", async () => {
  const { files, library } = setup();
  await library.refresh();
  await files.write(path, new Uint8Array([255]));
  await expect(library.resolve(id, source)).rejects.toThrow();
  expect(library.getSnapshot().items).toHaveLength(1);
  await files.write(path, encodeText(source));
  await library.refresh();
  vi.spyOn(files, "read").mockRejectedValueOnce(new Error("File unavailable"));
  await expect(library.resolve(id, source)).rejects.toThrow("File unavailable");
});
it("ignores late refreshes and rejects choices after disposal", async () => {
  const { files, library } = setup();
  await library.refresh();
  let finish: (paths: string[]) => void = () => undefined;
  vi.spyOn(files, "list").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const older = library.refresh();
  await files.write(path, encodeText("> New"));
  await library.refresh();
  finish([]);
  await older;
  expect(library.getSnapshot().items).toHaveLength(2);
  library.dispose();
  await expect(library.resolve(id, "> New")).rejects.toThrow("closed");
});

it("uses stable ARIA IDs for spaces, literal escape-like text and malformed UTF-16", () => {
  expect(blockMenuOptionId("results", "table")).toBe("results-table");
  expect(blockMenuOptionId("results", "template:Team Review.md")).not.toMatch(
    /\s/,
  );
  expect(blockMenuOptionId("results", ":")).not.toBe(
    blockMenuOptionId("results", "_3a_"),
  );
  expect(() => blockMenuOptionId("results", "\uD800")).not.toThrow();
});
