import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import {
  planStarterKit,
  starterKit,
  starterKits,
} from "../src/templates/starterKits";
import { builtinTemplates } from "../src/templates/builtinTemplates";

const record = { id: "kit-test", name: "Writing", tier: "library" } as const;
const date = () => new Date(2026, 10, 19, 9, 30);
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each(starterKits)(
  "builds the $name kit from actual Markdown sources with safe explicit routes and no configuration or unresolved prompts",
  (kit) => {
    const sources = builtinTemplates.map((item) => item.template.source);
    const plan = planStarterKit(kit, "আমার কাজ", {
      space: "Writing",
      notebook: "আমার কাজ",
      clock: { date: "2026-11-19", time: "09:30" },
    });
    expect(plan.notes).toHaveLength(3);
    expect(Object.keys(plan.defaults)).toHaveLength(2);
    expect(plan.notes[0]!.path).toBe("আমার কাজ/Overview.md");
    for (const note of plan.notes.slice(1)) {
      expect(note.path).toMatch(/^আমার কাজ\/[^/]+\/[^/]+\.md$/);
      expect(note.content).toContain('date: "2026-11-19"');
      expect(note.content).not.toMatch(/template:|\{\{/);
      expect(note.cursor).toBeGreaterThanOrEqual(0);
    }
    for (const reference of Object.values(plan.defaults))
      expect(builtinTemplates.some((item) => item.id === reference)).toBe(true);
    expect(builtinTemplates.map((item) => item.template.source)).toEqual(
      sources,
    );
  },
);

it("creates a separate kit beside existing notes, keeps settings and saves defaults usable by New Sheet", async () => {
  const files = createMemoryFiles({
    "work/asset.png": "",
    "Work (1)/keep.md": "Keep",
    ".slate/view.json":
      '{"version":1,"custom":"Keep","pinned":["Work (2)/later.md"],"notebookTemplates":{"Other":"builtin:readme"}}',
  });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  const session = await store.prepareStarterKit("work", "Work", date());
  expect(session.plan.root).toBe("Work (3)");
  await Promise.all([
    store.installStarterKit(session),
    store.installStarterKit(session),
  ]);
  await store.installStarterKit(session);
  expect(session.complete).toBe(true);
  expect(session.saved).toHaveLength(3);
  expect(
    (await files.list()).filter((path) => path.startsWith("Work (3)/")),
  ).toHaveLength(3);
  expect(await store.space.read("Work (1)/keep.md")).toBe("Keep");
  expect(await store.readNotebookTemplate("Work (3)/Meetings")).toBe(
    "builtin:meeting-notes",
  );
  expect(await store.readNotebookTemplate("Work (3)/Projects")).toBe(
    "builtin:prd",
  );
  expect(store.api.getState().preferences).toMatchObject({
    custom: "Keep",
    pinned: ["Work (2)/later.md"],
    notebookTemplates: { Other: "builtin:readme" },
  });
  expect(store.api.getState()).toMatchObject({
    selectedPath: session.saved[0]!.path,
    initialCursor: { path: session.saved[0]!.path, position: 0 },
  });
  const again = await store.prepareStarterKit("work", "Work", date());
  expect(again.plan.root).toBe("Work (4)");
  store.cancelStarterKit(again);
});

it("reserves pending roots across concurrent preparations and releases cancelled empty sessions", async () => {
  const files = createMemoryFiles();
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  const sessions = await Promise.all([
    store.prepareStarterKit("work", "Work", date()),
    store.prepareStarterKit("work", "Work", date()),
  ]);
  expect(sessions.map((session) => session.plan.root)).toEqual([
    "Work",
    "Work (1)",
  ]);
  store.cancelStarterKit(sessions[0]!);
  const third = await store.prepareStarterKit("work", "Work", date());
  expect(third.plan.root).toBe("Work");
  await expect(store.installStarterKit(sessions[0]!)).rejects.toThrow(
    "Prepare this starter kit again",
  );
  expect(await files.list()).toEqual([]);
  store.cancelStarterKit(sessions[1]!);
  store.cancelStarterKit(third);
});

it("resumes after a partial write failure without duplicating saved files or replacing subsequent external edits", async () => {
  const files = createMemoryFiles();
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  const session = await store.prepareStarterKit("writing", "Writing", date());
  const write = files.write;
  vi.spyOn(files, "write")
    .mockImplementationOnce(write)
    .mockRejectedValueOnce(new Error("Permission revoked"));
  await expect(store.installStarterKit(session)).rejects.toThrow(
    "Permission revoked",
  );
  expect(session.saved).toHaveLength(1);
  expect(session.complete).toBe(false);
  await files.write(
    session.saved[0]!.path,
    encodeText("External overview words"),
  );
  await store.installStarterKit(session);
  expect(session.saved).toHaveLength(3);
  expect(await files.list()).toHaveLength(3);
  expect(await store.space.read(session.saved[0]!.path)).toBe(
    "External overview words",
  );
  expect(
    store.api
      .getState()
      .sheets.find((sheet) => sheet.path === session.saved[0]!.path)?.content,
  ).toBe("External overview words");
});

it("keeps interrupted reserved files and resumes into a numbered copy", async () => {
  const files = createMemoryFiles();
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  const session = await store.prepareStarterKit("personal", "Personal", date());
  const write = files.write;
  vi.spyOn(files, "write").mockImplementationOnce(async (path) => {
    await write(path, encodeText("Partial writing"));
    throw new Error("Interrupted");
  });
  await expect(store.installStarterKit(session)).rejects.toThrow("Interrupted");
  expect(session.saved).toHaveLength(0);
  await store.installStarterKit(session);
  expect(session.saved[0]!.path).toBe("Personal/Overview (1).md");
  expect(await store.space.read("Personal/Overview.md")).toBe(
    "Partial writing",
  );
  expect(session.complete).toBe(true);
});

it("retries only preferences after notes are saved and preserves a newly configured notebook default", async () => {
  const files = createMemoryFiles();
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  const session = await store.prepareStarterKit(
    "engineering",
    "Engineering",
    date(),
  );
  await files.write(".slate/view.json", encodeText("{invalid"));
  await expect(store.installStarterKit(session)).rejects.toThrow();
  expect(session.saved).toHaveLength(3);
  expect(session.defaultsSaved).toBe(false);
  expect(await store.space.read(".slate/view.json")).toBe("{invalid");
  await files.write(
    ".slate/view.json",
    encodeText(
      '{"version":1,"custom":"External","notebookTemplates":{"Engineering/Issues":"custom:mine"}}',
    ),
  );
  await store.installStarterKit(session);
  expect(await files.list()).toHaveLength(3);
  expect(await store.readNotebookTemplate("Engineering/Issues")).toBe(
    "custom:mine",
  );
  expect(await store.readNotebookTemplate("Engineering/Projects")).toBe(
    "builtin:readme",
  );
  expect(store.api.getState().preferences.custom).toBe("External");
});

it("keeps external preferences and a conflict copy, then retries the same completed notes", async () => {
  const files = createMemoryFiles();
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  const session = await store.prepareStarterKit("work", "Work", date());
  const read = files.read;
  let reads = 0;
  vi.spyOn(files, "read").mockImplementation(async (path) => {
    const bytes = await read(path);
    if (path === ".slate/view.json" && ++reads === 1)
      await files.write(
        path,
        encodeText('{"version":1,"custom":"External words"}'),
      );
    return bytes;
  });
  await expect(store.installStarterKit(session)).rejects.toThrow(
    "changed outside Slate",
  );
  expect(session.saved).toHaveLength(3);
  expect(await store.space.read(".slate/view.json")).toContain(
    "External words",
  );
  expect(
    (await files.list(true)).some((path) => path.includes("conflicted copy")),
  ).toBe(true);
  await store.installStarterKit(session);
  expect(await files.list()).toHaveLength(3);
  expect(store.api.getState().preferences.custom).toBe("External words");
});

it("stops before kit writes for invalid settings or roots, unknown kits and readers", async () => {
  const files = createMemoryFiles();
  const store = createWorkspaceStore(record, files);
  await expect(store.prepareStarterKit("work", "Work", date())).rejects.toThrow(
    "read-only",
  );
  store.setOwned(true);
  await expect(
    store.prepareStarterKit("missing", "Work", date()),
  ).rejects.toThrow("available starter kit");
  await expect(
    store.prepareStarterKit("work", "../outside", date()),
  ).rejects.toThrow();
  await files.write(".slate/view.json", encodeText("{invalid"));
  await expect(
    store.prepareStarterKit("work", "Work", date()),
  ).rejects.toThrow();
  expect(await files.list()).toEqual([]);
});

it("flushes the current draft and captures the invoking date before asynchronous preparation", async () => {
  const files = createMemoryFiles({ "old.md": "Before" });
  const store = createWorkspaceStore(record, files);
  store.setOwned(true);
  await store.load();
  store.edit("Latest draft");
  const captured = date();
  const preparing = store.prepareStarterKit("work", "Work", captured);
  captured.setDate(20);
  const session = await preparing;
  expect(await store.space.read("old.md")).toBe("Latest draft");
  expect(session.plan.notes[1]!.content).toContain('date: "2026-11-19"');
  store.setOwned(false);
  await expect(store.installStarterKit(session)).rejects.toThrow("read-only");
  expect(session.saved).toHaveLength(0);
  store.setOwned(true);
  await store.installStarterKit(session);
  expect(await files.list()).toHaveLength(4);
});

it("does not report creation failure after committed notes/defaults when notification or refresh fails", async () => {
  for (const failure of ["notification", "refresh"]) {
    const files = createMemoryFiles();
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    const session = await store.prepareStarterKit(
      "personal",
      "Personal",
      date(),
    );
    if (failure === "notification")
      store.setOnSaved(() => {
        throw new Error("Notification refused");
      });
    else
      vi.spyOn(files, "list").mockRejectedValue(
        new Error("Folder disconnected"),
      );
    await store.installStarterKit(session);
    expect(session.complete).toBe(true);
    expect(store.api.getState().notice).toContain("starter kit is saved");
    expect(await store.space.read(session.saved[0]!.path)).toContain(
      "# Personal",
    );
    expect(await store.readNotebookTemplate("Personal/Reviews")).toBe(
      "builtin:weekly-review",
    );
  }
});

it("rejects a direct unsafe plan route and unavailable catalog choice", () => {
  expect(() => starterKit("missing")).toThrow();
  expect(() => planStarterKit(starterKit("work"), ".slate", {})).toThrow();
});
