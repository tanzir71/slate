import { expect, it, vi } from "vitest";
import {
  createRecoveryJournal,
  type RecoveryDraft,
} from "../src/browser/recoveryJournal";

function memoryStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return { values, storage };
}
const drafts = (
  content: string,
  baseContent: string | undefined = "disk words",
) => new Map<string, RecoveryDraft>([["A.md", { content, baseContent }]]);

it("recovers every incremental edit and original disk base while keeping per-key journal writes small", () => {
  const { storage } = memoryStorage();
  const journal = createRecoveryJournal("space", storage);
  const before = "word ".repeat(50000);
  journal.save(drafts(`a${before}`, before), {
    path: "A.md",
    before,
    changes: [{ from: 0, to: 0, text: "a" }],
  });
  journal.save(drafts(`ab${before}`, before), {
    path: "A.md",
    before: `a${before}`,
    changes: [{ from: 1, to: 1, text: "b" }],
  });
  expect(
    storage.setItem.mock.calls.filter(([key]) =>
      key.startsWith("slate.recovery-base."),
    ),
  ).toHaveLength(1);
  const writes = storage.setItem.mock.calls.filter(
    ([key]) => key === "slate.recovery-v2.space",
  );
  expect(writes.every(([, value]) => value.length < 500)).toBe(true);
  const recovered = createRecoveryJournal("space", storage).read();
  expect(recovered.get("A.md")).toEqual({
    content: `ab${before}`,
    baseContent: before,
  });
});

it("reads old journals unchanged and falls back to full snapshots for edits that do not describe the source", () => {
  const { values, storage } = memoryStorage();
  values.set(
    "slate.recovery.space",
    JSON.stringify(Object.fromEntries(drafts("legacy words"))),
  );
  const journal = createRecoveryJournal("space", storage);
  expect(journal.read().get("A.md")?.content).toBe("legacy words");
  journal.save(drafts("exact new words"), {
    path: "A.md",
    before: "legacy words",
    changes: [{ from: 999, to: 999, text: "wrong" }],
  });
  expect(
    createRecoveryJournal("space", storage).read().get("A.md")?.content,
  ).toBe("exact new words");
});

it("keeps exact full snapshots when valid edit coordinates disagree with any output span", () => {
  for (const content of [
    "Xrefix WORD suffix",
    "prefix W0RD suffix",
    "prefix WORD suffiX",
  ]) {
    const { storage } = memoryStorage();
    const journal = createRecoveryJournal("space", storage);
    journal.save(drafts(content), {
      path: "A.md",
      before: "prefix body suffix",
      changes: [{ from: 7, to: 11, text: "WORD" }],
    });
    expect(
      storage.setItem.mock.calls.filter(([key]) =>
        key.startsWith("slate.recovery-base."),
      ),
    ).toHaveLength(0);
    expect(
      createRecoveryJournal("space", storage).read().get("A.md")?.content,
    ).toBe(content);
  }
});

it("leaves the previous committed draft recoverable if a replacement journal write fails", () => {
  const { values, storage } = memoryStorage();
  const journal = createRecoveryJournal("space", storage);
  journal.save(drafts("first"), {
    path: "A.md",
    before: "",
    changes: [{ from: 0, to: 0, text: "first" }],
  });
  const previous = values.get("slate.recovery-v2.space");
  const original = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementation((key, value) => {
    if (key === "slate.recovery-v2.space") throw new Error("Quota");
    original(key, value);
  });
  expect(() =>
    journal.save(drafts("second"), {
      path: "A.md",
      before: "first",
      changes: [{ from: 0, to: 5, text: "second" }],
    }),
  ).toThrow("Quota");
  expect(values.get("slate.recovery-v2.space")).toBe(previous);
  expect(
    createRecoveryJournal("space", storage).read().get("A.md")?.content,
  ).toBe("first");
  storage.setItem.mockImplementation(original);
  journal.save(drafts("second"));
  expect(
    createRecoveryJournal("space", storage).read().get("A.md")?.content,
  ).toBe("second");
});

it("uses an atomic full snapshot if allocating a base fails, and cleans bases only after saving", () => {
  const { values, storage } = memoryStorage();
  const original = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementation((key, value) => {
    if (key.startsWith("slate.recovery-base.")) throw new Error("Quota");
    original(key, value);
  });
  const journal = createRecoveryJournal("space", storage);
  journal.save(drafts("kept"), {
    path: "A.md",
    before: "",
    changes: [{ from: 0, to: 0, text: "kept" }],
  });
  expect(
    createRecoveryJournal("space", storage).read().get("A.md")?.content,
  ).toBe("kept");
  storage.setItem.mockImplementation(original);
  journal.save(drafts("kept!"), {
    path: "A.md",
    before: "kept",
    changes: [{ from: 4, to: 4, text: "!" }],
  });
  values.set("slate.recovery.other", "unrelated");
  journal.save(new Map());
  expect([...values.entries()]).toEqual([
    ["slate.recovery.other", "unrelated"],
  ]);
});

it("compacts long edit chains without changing text and carries a newer saved disk base", () => {
  const { storage, values } = memoryStorage();
  const journal = createRecoveryJournal("space", storage);
  let content = "";
  for (let index = 0; index < 130; index++) {
    journal.save(drafts(`${content}x`), {
      path: "A.md",
      before: content,
      changes: [{ from: content.length, to: content.length, text: "x" }],
    });
    content += "x";
  }
  expect(
    [...values.keys()].filter((key) => key.startsWith("slate.recovery-base.")),
  ).toHaveLength(1);
  expect(
    createRecoveryJournal("space", storage).read().get("A.md")?.content,
  ).toBe(content);
  journal.save(drafts(content, "newer saved base"));
  expect(createRecoveryJournal("space", storage).read().get("A.md")).toEqual({
    content,
    baseContent: "newer saved base",
  });
});

it("refuses missing snapshots and malformed changes without modifying recovery bytes", () => {
  const { storage, values } = memoryStorage();
  const base = "slate.recovery-base.space.missing";
  values.set(
    "slate.recovery.space",
    JSON.stringify({ "A.md": { base, edits: [] } }),
  );
  const journal = createRecoveryJournal("space", storage);
  expect(() => journal.read()).toThrow("snapshot");
  values.set(
    base,
    JSON.stringify({ content: "words", baseContent: "original" }),
  );
  values.set(
    "slate.recovery.space",
    JSON.stringify({
      "A.md": { base, edits: [[{ from: -1, to: 0, text: "" }]] },
    }),
  );
  const before = [...values.entries()];
  expect(() => journal.read()).toThrow("Invalid recovery");
  expect([...values.entries()]).toEqual(before);
});

it("keeps the old snapshot during a failed compaction commit", () => {
  const { values, storage } = memoryStorage();
  const journal = createRecoveryJournal("space", storage);
  let content = "";
  for (let index = 0; index < 128; index++) {
    journal.save(drafts(`${content}x`), {
      path: "A.md",
      before: content,
      changes: [{ from: content.length, to: content.length, text: "x" }],
    });
    content += "x";
  }
  const committed = values.get("slate.recovery-v2.space");
  const original = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementation((key, value) => {
    if (key === "slate.recovery-v2.space") throw new Error("Commit failed");
    original(key, value);
  });
  expect(() =>
    journal.save(drafts(`${content}y`), {
      path: "A.md",
      before: content,
      changes: [{ from: content.length, to: content.length, text: "y" }],
    }),
  ).toThrow("Commit failed");
  expect(values.get("slate.recovery-v2.space")).toBe(committed);
  expect(
    createRecoveryJournal("space", storage).read().get("A.md")?.content,
  ).toBe(content);
});

it("protects new drafts from an older app clearing its key and preserves divergent older drafts during migration", () => {
  const { storage, values } = memoryStorage();
  const journal = createRecoveryJournal("space", storage);
  journal.save(drafts("New app words"), {
    path: "A.md",
    before: "",
    changes: [{ from: 0, to: 0, text: "New app words" }],
  });
  storage.removeItem("slate.recovery.space");
  expect(
    createRecoveryJournal("space", storage).read().get("A.md")?.content,
  ).toBe("New app words");
  values.set(
    "slate.recovery.space",
    JSON.stringify(Object.fromEntries(drafts("Older app words"))),
  );
  const migrated = createRecoveryJournal("space", storage);
  const recovered = migrated.read();
  expect([...recovered.values()].map((entry) => entry.content).sort()).toEqual([
    "New app words",
    "Older app words",
  ]);
  expect([...recovered.keys()]).toContain("A (recovered earlier app 1).md");
  migrated.save(recovered);
  expect(storage.getItem("slate.recovery.space")).toBeNull();
  expect(createRecoveryJournal("space", storage).read()).toEqual(recovered);
});

it("keeps the legacy journal if migration cannot commit the new version", () => {
  const { storage, values } = memoryStorage();
  const raw = JSON.stringify(Object.fromEntries(drafts("Older app words")));
  values.set("slate.recovery.space", raw);
  const journal = createRecoveryJournal("space", storage);
  const recovered = journal.read();
  storage.setItem.mockImplementation(() => {
    throw new Error("Quota");
  });
  expect(() => journal.save(recovered)).toThrow("Quota");
  expect(storage.getItem("slate.recovery.space")).toBe(raw);
  expect(createRecoveryJournal("space", storage).read()).toEqual(recovered);
});

it("retries a snapshot read if another writer compacts between reading the journal and its base", () => {
  const { storage, values } = memoryStorage();
  const writer = createRecoveryJournal("space", storage);
  writer.save(drafts("first"), {
    path: "A.md",
    before: "",
    changes: [{ from: 0, to: 0, text: "first" }],
  });
  const previous = storage.getItem("slate.recovery-v2.space")!;
  writer.save(drafts("second", "new disk base"), {
    path: "A.md",
    before: "first",
    changes: [{ from: 0, to: 5, text: "second" }],
  });
  const originalRead = storage.getItem;
  let stale = true;
  storage.getItem = (key) => {
    if (stale && key === "slate.recovery-v2.space") {
      stale = false;
      return previous;
    }
    return originalRead(key);
  };
  const before = [...values.entries()];
  expect(createRecoveryJournal("space", storage).read().get("A.md")).toEqual({
    content: "second",
    baseContent: "new disk base",
  });
  expect([...values.entries()]).toEqual(before);
});

it("leaves an unknown future journal version intact", () => {
  const { storage, values } = memoryStorage();
  values.set(
    "slate.recovery-v2.space",
    JSON.stringify({ version: 3, drafts: { keep: "future words" } }),
  );
  const before = [...values.entries()];
  expect(() => createRecoveryJournal("space", storage).read()).toThrow(
    "Unsupported recovery version",
  );
  expect([...values.entries()]).toEqual(before);
});

it("does not silently discard unrecognized recovery entries", () => {
  const { storage, values } = memoryStorage();
  values.set(
    "slate.recovery-v2.space",
    JSON.stringify({
      version: 2,
      drafts: { "A.md": { content: "keep these words", baseContent: 42 } },
    }),
  );
  const before = [...values.entries()];
  expect(() => createRecoveryJournal("space", storage).read()).toThrow(
    "Unrecognized recovery entry",
  );
  expect([...values.entries()]).toEqual(before);
});
