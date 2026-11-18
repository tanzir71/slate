import { expect, it } from "vitest";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import { createBrowserSpace } from "../src/browserSpace";
import { readSpaceTemplates, saveSpaceTemplate } from "../src/browserTemplates";

const source =
  '---\ntemplate: { name: "Project", category: Work }\ntitle: "{{title}}"\n---\n{{cursor}}Kept.';
it("reads only Space Markdown templates, including nested files and optional metadata", async () => {
  const files = createMemoryFiles({
    ".slate/templates/project.md": source,
    ".slate/templates/nested/Plain.MD": "# Plain\n",
    ".slate/templates/config.json": "{}",
    ".slate/trash/old.md": "# Old",
    ".slate/blocks/quote.md": "> ",
    "notes.md": "# Note",
  });
  const records = await readSpaceTemplates(createBrowserSpace(files));
  expect(records.map((record) => record.path)).toEqual([
    ".slate/templates/nested/Plain.MD",
    ".slate/templates/project.md",
  ]);
  expect(records.map((record) => record.template?.name)).toEqual([
    "Plain",
    "Project",
  ]);
  expect(records[1]?.source).toBe(source);
});
it("reports invalid/unsupported files individually and keeps their original bytes", async () => {
  const invalid = "---\ntemplate: [wrong]\n---\nBody";
  const files = createMemoryFiles({
    ".slate/templates/invalid.md": invalid,
    ".slate/templates/good.md": source,
  });
  const bytes = new Uint8Array([0xff, 0xfe, 0x00]);
  await files.write(".slate/templates/encoding.md", bytes);
  const records = await readSpaceTemplates(createBrowserSpace(files));
  expect(records).toHaveLength(3);
  expect(records.find((record) => record.path.endsWith("encoding.md"))).toEqual(
    expect.objectContaining({
      source: undefined,
      template: undefined,
      error: expect.any(String),
    }),
  );
  expect(records.find((record) => record.path.endsWith("invalid.md"))).toEqual(
    expect.objectContaining({
      source: invalid,
      template: undefined,
      error: expect.any(String),
    }),
  );
  expect(
    records.find((record) => record.path.endsWith("good.md"))?.template?.name,
  ).toBe("Project");
  expect(await files.read(".slate/templates/encoding.md")).toEqual(bytes);
  expect(await files.read(".slate/templates/invalid.md")).toEqual(
    encodeText(invalid),
  );
});
it("creates collision-preserving Markdown copies, including an existing empty file", async () => {
  const files = createMemoryFiles({
    ".slate/templates/template-project.md": "",
  });
  const space = createBrowserSpace(files);
  const first = await saveSpaceTemplate(space, source);
  const second = await saveSpaceTemplate(space, source);
  expect(first.path).toBe(".slate/templates/template-project (1).md");
  expect(second.path).toBe(".slate/templates/template-project (2).md");
  expect(await space.read(".slate/templates/template-project.md")).toBe("");
  expect(await space.read(first.path)).toBe(source);
});
it("serializes concurrent new copies and uses portable generated filenames", async () => {
  const space = createBrowserSpace(createMemoryFiles());
  const text = "---\ntemplate: { name: CON }\n---\nBody";
  const results = await Promise.all([
    saveSpaceTemplate(space, text),
    saveSpaceTemplate(space, text),
  ]);
  expect(results.map((record) => record.path)).toEqual([
    ".slate/templates/template-con.md",
    ".slate/templates/template-con (1).md",
  ]);
});
it("retains an externally edited template and saves the user's changes to a conflict copy", async () => {
  const path = ".slate/templates/project.md",
    files = createMemoryFiles({ [path]: source });
  const space = createBrowserSpace(files);
  const external = source + "\nExternal words",
    local = source + "\nLocal words";
  await files.write(path, encodeText(external));
  const result = await saveSpaceTemplate(space, local, {
    path,
    baseContent: source,
  });
  expect(result.conflict).toBe(true);
  expect(await space.read(path)).toBe(external);
  expect(await space.read(result.path)).toBe(local);
});
it("allows a malformed template to be repaired against its exact old source", async () => {
  const path = ".slate/templates/broken.md",
    files = createMemoryFiles({ [path]: "---\ntemplate: [" });
  const space = createBrowserSpace(files);
  const [broken] = await readSpaceTemplates(space);
  expect(broken?.error).toBeTruthy();
  const result = await saveSpaceTemplate(space, source, {
    path,
    baseContent: broken!.source,
  });
  expect(result.path).toBe(path);
  expect(result.conflict).toBe(false);
  expect((await readSpaceTemplates(space))[0]?.template?.name).toBe("Project");
});
it.each([
  "note.md",
  ".slate/keymap.json",
  ".slate/templates/../../note.md",
  ".slate/templates/file.txt",
])("refuses to edit an unrelated path: %s", async (path) => {
  const files = createMemoryFiles({ "note.md": "Keep." }),
    space = createBrowserSpace(files);
  await expect(saveSpaceTemplate(space, source, { path })).rejects.toThrow();
  expect(await files.list(true)).toEqual(["note.md"]);
  expect(await space.read("note.md")).toBe("Keep.");
});
it("validates new metadata and writer ownership before saving any copy", async () => {
  const files = createMemoryFiles(),
    reader = createBrowserSpace(files, () => false);
  await expect(saveSpaceTemplate(reader, source)).rejects.toThrow(/read-only/i);
  await expect(
    saveSpaceTemplate(
      createBrowserSpace(files),
      "---\ntemplate: [wrong]\n---\n",
    ),
  ).rejects.toThrow();
  expect(await files.list(true)).toEqual([]);
});
