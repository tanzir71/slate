import { afterEach, expect, it, vi } from "vitest";
import { planTemplateFile, readMarkdownTemplate } from "@slate/core";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { captureTemplateContext } from "../src/templates/templateSession";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
const record = { id: "template-test", name: "Work", tier: "library" } as const;
const template = readMarkdownTemplate(
  '---\ntemplate: { name: Note, destination: Meetings, filename: "{{title|slug}}" }\ntitle: "{{title}}"\n---\nFirst {{cursor}}{{selection}}',
  "Note",
);
function plan() {
  return planTemplateFile(template, {
    title: "Review",
    selection: "selected words",
    clock: { date: "2026-11-18", time: "09:30" },
  });
}

it("captures local time, Space, selection and a valid ULID once for a gallery session", () => {
  const date = new Date(2026, 10, 18, 9, 30, 42);
  const context = captureTemplateContext(
    "Work",
    "Inbox",
    "selected words",
    date,
  );
  expect(context).toMatchObject({
    space: "Work",
    notebook: "Inbox",
    selection: "selected words",
    clipboard: "",
    clock: {
      date: "2026-11-18",
      time: "09:30:42",
      offsetMinutes: -date.getTimezoneOffset(),
    },
  });
  expect(context.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  date.setDate(19);
  expect(context.clock?.date).toBe("2026-11-18");
});
it("flushes current words, preserves an existing destination and opens the actual new file at its marker", async () => {
  const files = createMemoryFiles({
    "old.md": "Before",
    "Meetings/review.md": "",
  });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  await store.select("old.md");
  store.edit("My latest words");
  const saved = await store.createFromTemplate(plan());
  expect(saved.path).toBe("Meetings/review (1).md");
  expect(await store.space.read("Meetings/review.md")).toBe("");
  expect(await store.space.read("old.md")).toBe("My latest words");
  expect(await store.space.read(saved.path)).toBe(plan().content);
  expect(saved.content).not.toContain("template:");
  expect(store.api.getState()).toMatchObject({
    selectedPath: saved.path,
    saveState: "Saved",
    initialCursor: { path: saved.path, position: plan().cursor },
  });
  store.clearInitialCursor();
  expect(store.api.getState().initialCursor).toBeUndefined();
  await store.select("old.md");
  expect(store.api.getState().initialCursor).toBeUndefined();
});
it("keeps the created file and cursor available when a subsequent directory refresh fails", async () => {
  const files = createMemoryFiles({ "old.md": "Keep." });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  const listing = vi
    .spyOn(files, "list")
    .mockRejectedValue(new Error("Folder disconnected"));
  const saved = await store.createFromTemplate(plan());
  expect(store.api.getState()).toMatchObject({
    selectedPath: saved.path,
    saveState: "Saved",
    notice: expect.stringContaining("saved"),
  });
  expect(
    store.api.getState().sheets.find((sheet) => sheet.path === saved.path)
      ?.content,
  ).toBe(plan().content);
  expect(await store.space.read(saved.path)).toBe(plan().content);
  listing.mockRestore();
  await store.refresh();
  expect(store.api.getState().selectedPath).toBe(saved.path);
});
it("retains the current selection and draft when saving the old note fails", async () => {
  const files = createMemoryFiles({ "old.md": "Before" });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  store.edit("Keep my draft");
  const write = vi
    .spyOn(files, "write")
    .mockRejectedValue(new Error("Permission revoked"));
  await expect(store.createFromTemplate(plan())).rejects.toThrow(
    "Permission revoked",
  );
  expect(store.api.getState()).toMatchObject({
    selectedPath: "old.md",
    saveState: "Unsaved",
  });
  expect(store.api.getState().sheets[0]?.content).toBe("Keep my draft");
  write.mockRestore();
  expect(await files.list()).toEqual(["old.md"]);
  await store.flush();
  expect(await store.space.read("old.md")).toBe("Keep my draft");
});
it("does not create a note or change selection when writer ownership is absent", async () => {
  const files = createMemoryFiles({ "old.md": "Keep." });
  const store = createWorkspaceStore(record, files);
  await store.load();
  await expect(store.createFromTemplate(plan())).rejects.toThrow(/read-only/i);
  expect(await files.list()).toEqual(["old.md"]);
  expect(store.api.getState().selectedPath).toBe("old.md");
});
it("does not report creation failure after committed bytes when a saved notification throws", async () => {
  const store = createWorkspaceStore(
    record,
    createMemoryFiles({ "old.md": "Keep." }),
  );
  store.setOwned(true);
  await store.load();
  store.setOnSaved(() => {
    throw new Error("Index notification unavailable");
  });
  const saved = await store.createFromTemplate(plan());
  expect(await store.space.read(saved.path)).toBe(plan().content);
  expect(store.api.getState()).toMatchObject({
    selectedPath: saved.path,
    saveState: "Saved",
    notice: expect.stringContaining("saved"),
  });
});
