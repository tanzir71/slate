import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
const record = {
  id: "notebook-template-test",
  name: "Work",
  tier: "library",
} as const;
it("persists one exact default beside the Space and reloads/removes it without changing notes or other preferences", async () => {
  const files = createMemoryFiles({
    "Work/old.md": "Keep.",
    ".slate/view.json":
      '{"version":1,"custom":{"keep":true},"notebookTemplates":{"Home":"builtin:daily-note"}}',
  });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  await store.setNotebookTemplate("Work", "builtin:meeting-notes");
  const reopened = createWorkspaceStore(record, files);
  reopened.setOwned(true);
  await reopened.load();
  expect(await reopened.readNotebookTemplate("Work")).toBe(
    "builtin:meeting-notes",
  );
  expect(await reopened.readNotebookTemplate("Work/Child")).toBeUndefined();
  expect(await reopened.readNotebookTemplate("Home")).toBe(
    "builtin:daily-note",
  );
  await reopened.setNotebookTemplate("Work", undefined);
  expect(await reopened.readNotebookTemplate("Work")).toBeUndefined();
  expect(reopened.api.getState().preferences.custom).toEqual({ keep: true });
  expect(await reopened.space.read("Work/old.md")).toBe("Keep.");
});
it("reads external default edits before the next creation and preserves concurrent preference updates", async () => {
  const files = createMemoryFiles({ ".slate/view.json": '{"version":1}' });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  await files.write(
    ".slate/view.json",
    encodeText(
      '{"version":1,"notebookTemplates":{"Work":".slate/templates/new.md"},"external":true}',
    ),
  );
  expect(await store.readNotebookTemplate("Work")).toBe(
    ".slate/templates/new.md",
  );
  await Promise.all([
    store.togglePinned("note.md"),
    store.setNotebookTemplate("Home", "builtin:readme"),
  ]);
  const value = JSON.parse(
    (await store.space.read(".slate/view.json"))!,
  ) as Record<string, unknown>;
  expect(value).toMatchObject({
    external: true,
    pinned: ["note.md"],
    notebookTemplates: {
      Work: ".slate/templates/new.md",
      Home: "builtin:readme",
    },
  });
});
it("keeps malformed configuration and refuses a reader's default changes", async () => {
  const files = createMemoryFiles({
    ".slate/view.json": "broken JSON",
    "old.md": "Kept",
  });
  const store = createWorkspaceStore(record, files);
  await store.load();
  await expect(store.readNotebookTemplate("Work")).rejects.toThrow();
  await expect(
    store.setNotebookTemplate("Work", "builtin:prd"),
  ).rejects.toThrow();
  expect(await store.space.read(".slate/view.json")).toBe("broken JSON");
  await files.write(".slate/view.json", encodeText('{"version":1}'));
  await expect(
    store.setNotebookTemplate("Work", "builtin:prd"),
  ).rejects.toThrow(/read-only/i);
  expect(await store.space.read(".slate/view.json")).toBe('{"version":1}');
});
it("preserves an external preference edit and keeps the proposed default in a conflict copy", async () => {
  const original = '{"version":1,"notebookTemplates":{"Work":"builtin:prd"}}';
  const external =
    '{"version":1,"notebookTemplates":{"Work":"builtin:readme"},"external":true}';
  const files = createMemoryFiles({ ".slate/view.json": original });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  const read = files.read.bind(files);
  let first = true;
  vi.spyOn(files, "read").mockImplementation(async (path) => {
    const bytes = await read(path);
    if (path === ".slate/view.json" && first) {
      first = false;
      await files.write(path, encodeText(external));
    }
    return bytes;
  });
  await expect(
    store.setNotebookTemplate("Work", "builtin:meeting-notes"),
  ).rejects.toThrow(/conflict/i);
  expect(await store.space.read(".slate/view.json")).toBe(external);
  const copy = (await files.list(true)).find((path) =>
    path.includes("conflicted copy"),
  )!;
  expect(JSON.parse((await store.space.read(copy))!)).toMatchObject({
    notebookTemplates: { Work: "builtin:meeting-notes" },
  });
  expect(store.api.getState().preferences.notebookTemplates).toEqual({
    Work: "builtin:prd",
  });
});
