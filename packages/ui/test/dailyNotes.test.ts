import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const record = { id: "daily-test", name: "Writing", tier: "library" } as const;
const today = () => new Date(2026, 10, 18, 0, 15);
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("renders today's built-in once and carries unfinished tasks from the latest earlier calendar note", async () => {
  const previous = "# Yesterday\n\n- [ ] **Ship** the review\n- [x] Finished\n";
  const files = createMemoryFiles({
    "Daily/2026-11-13.md": "- [ ] Older task",
    "Daily/2026-11-17.md": previous,
    "Daily/2026-11-19.md": "- [ ] Future task",
    "Daily/2026-11-99.md": "- [ ] Invalid date",
    "Inbox/2026-11-17.md": "- [ ] Another notebook",
  });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  await Promise.all([store.openToday(today()), store.openToday(today())]);
  const source = (await store.space.read("Daily/2026-11-18.md"))!;
  expect(source).toContain('title: "2026-11-18"');
  expect(source).toContain("# Wednesday, November 18");
  expect(source).toContain("## Tasks\n- [ ] **Ship** the review\n");
  expect(source).not.toMatch(
    /Finished|Older task|Future task|Invalid date|Another notebook|template:|\{\{/,
  );
  expect(await store.space.read("Daily/2026-11-17.md")).toBe(previous);
  expect(
    (await files.list()).filter((path) => path.startsWith("Daily/2026-11-18")),
  ).toEqual(["Daily/2026-11-18.md"]);
  expect(store.api.getState()).toMatchObject({
    selectedPath: "Daily/2026-11-18.md",
    saveState: "Saved",
    initialCursor: {
      path: "Daily/2026-11-18.md",
      position: source.indexOf("- \n") + 2,
    },
  });
});

it("reads the previous daily file after flushing its latest draft", async () => {
  const files = createMemoryFiles({ "Daily/2026-11-17.md": "- [ ] Before" });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  store.edit("- [x] Before\n- [ ] Latest words");
  await store.openToday(today());
  expect(await store.space.read("Daily/2026-11-17.md")).toBe(
    "- [x] Before\n- [ ] Latest words",
  );
  const source = (await store.space.read("Daily/2026-11-18.md"))!;
  expect(source).toContain("- [ ] Latest words");
  expect(source).not.toContain("Before");
});

it("opens today's existing empty or undecodable file without modifying any bytes", async () => {
  for (const bytes of [encodeText(""), new Uint8Array([0xff, 0xfe, 0xfd])]) {
    const files = createMemoryFiles({ "Daily/2026-11-17.md": "- [ ] Pending" });
    await files.write("Daily/2026-11-18.md", bytes);
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    await store.openToday(today());
    expect(await files.read("Daily/2026-11-18.md")).toEqual(bytes);
    expect(await files.list()).toHaveLength(2);
    expect(store.api.getState().selectedPath).toBe("Daily/2026-11-18.md");
    expect(store.api.getState().initialCursor).toBeUndefined();
  }
});

it("stops creation when the latest earlier note cannot be read and succeeds after it is repaired", async () => {
  const files = createMemoryFiles({
    "Daily/2026-11-13.md": "- [ ] Older task",
  });
  await files.write("Daily/2026-11-17.md", new Uint8Array([0xff, 0xfe, 0xfd]));
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  await expect(store.openToday(today())).rejects.toThrow("Daily/2026-11-17.md");
  expect(await files.read("Daily/2026-11-18.md")).toBeUndefined();
  await files.write("Daily/2026-11-17.md", encodeText("- [ ] Repaired"));
  await store.openToday(today());
  expect(await store.space.read("Daily/2026-11-18.md")).toContain(
    "- [ ] Repaired",
  );
  expect(await store.space.read("Daily/2026-11-18.md")).not.toContain(
    "Older task",
  );
});

it("does not silently skip a previous file that disappears during creation", async () => {
  const files = createMemoryFiles({ "Daily/2026-11-17.md": "- [ ] Task" });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  const read = files.read;
  vi.spyOn(files, "read").mockImplementation((path) =>
    path === "Daily/2026-11-17.md" ? Promise.resolve(undefined) : read(path),
  );
  await expect(store.openToday(today())).rejects.toThrow(
    "previous daily note changed",
  );
  expect(await files.read("Daily/2026-11-18.md")).toBeUndefined();
});

it("preserves a canonical day file that appears during preparation, including an empty file", async () => {
  const files = createMemoryFiles({ "Daily/2026-11-17.md": "- [ ] Task" });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  const read = files.read;
  vi.spyOn(files, "read").mockImplementation(async (path) => {
    const bytes = await read(path);
    if (path === "Daily/2026-11-17.md")
      await files.write("Daily/2026-11-18.md", encodeText(""));
    return bytes;
  });
  await store.openToday(today());
  expect(await store.space.read("Daily/2026-11-18.md")).toBe("");
  expect(
    (await files.list()).filter((path) => path.includes("2026-11-18")),
  ).toEqual(["Daily/2026-11-18.md"]);
  expect(store.api.getState().initialCursor).toBeUndefined();
});

it("captures the invoking local date, leaves template expressions in tasks literal and ignores New Sheet defaults", async () => {
  const files = createMemoryFiles({
    "Daily/2026-11-17.md":
      "- [ ] Keep {{date}} {{cursor}} {{prompt:Name}} literal",
    ".slate/view.json":
      '{"version":1,"notebookTemplates":{"Daily":"missing-template"}}',
  });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  const date = today();
  const opening = store.openToday(date);
  date.setDate(19);
  await opening;
  expect(await store.space.read("Daily/2026-11-18.md")).toContain(
    "- [ ] Keep {{date}} {{cursor}} {{prompt:Name}} literal",
  );
  expect(await files.read("Daily/2026-11-19.md")).toBeUndefined();
});

it("retains the committed daily note and caret when subsequent refresh or notification fails", async () => {
  for (const failure of ["list", "notification"]) {
    const files = createMemoryFiles();
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    if (failure === "notification")
      store.setOnSaved(() => {
        throw new Error("Notification failed");
      });
    else
      vi.spyOn(store.space, "createIfMissing").mockImplementationOnce(
        async (path, content) => {
          await files.write(path, encodeText(content));
          vi.spyOn(files, "list").mockRejectedValueOnce(
            new Error("Folder disconnected"),
          );
          return { path, content };
        },
      );
    await store.openToday(today());
    const state = store.api.getState();
    expect(state.selectedPath).toBe("Daily/2026-11-18.md");
    expect(state.initialCursor?.path).toBe(state.selectedPath);
    expect(state.notice).toContain("daily note is saved");
    expect(
      state.sheets.find((sheet) => sheet.path === state.selectedPath)?.content,
    ).toBe(await store.space.read(state.selectedPath));
  }
});

it("refuses daily creation by a reader and preserves a draft after a failed flush", async () => {
  const files = createMemoryFiles({ "old.md": "Before" });
  const store = createWorkspaceStore(record, files);
  await store.load();
  await expect(store.openToday(today())).rejects.toThrow("read-only");
  store.setOwned(true);
  store.edit("Keep this draft");
  const write = vi
    .spyOn(files, "write")
    .mockRejectedValue(new Error("Permission revoked"));
  await expect(store.openToday(today())).rejects.toThrow("Permission revoked");
  expect(
    store.api.getState().sheets.find((sheet) => sheet.path === "old.md")
      ?.content,
  ).toBe("Keep this draft");
  expect(await files.read("Daily/2026-11-18.md")).toBeUndefined();
  write.mockRestore();
  await store.flush();
  expect(await store.space.read("old.md")).toBe("Keep this draft");
});
