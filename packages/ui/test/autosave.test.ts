import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosaveController, type SheetAutosaveWriter } from "../src/autosave";

describe("autosave controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces sheet writes and stores the latest edit only", async () => {
    vi.useFakeTimers();
    const writes: Array<{ path: string; content: string; baseContent: string | undefined }> = [];
    const writer: SheetAutosaveWriter = {
      writeSheet: async (path, content, options) => {
        writes.push({ path, content, baseContent: options.baseContent });
        return { status: "written", path };
      }
    };
    const autosave = createAutosaveController({ writer, delayMs: 250 });

    autosave.schedule({ path: "Drafts/note.md", content: "first", baseContent: "original" });
    autosave.schedule({ path: "Drafts/note.md", content: "second", baseContent: "original" });
    await vi.advanceTimersByTimeAsync(249);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([{ path: "Drafts/note.md", content: "second", baseContent: "original" }]);
  });

  it("flushes pending edits immediately when changing sheets", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const writer: SheetAutosaveWriter = {
      writeSheet: async (_path, content) => {
        writes.push(content);
        return { status: "written", path: "note.md" };
      }
    };
    const autosave = createAutosaveController({ writer, delayMs: 500 });

    autosave.schedule({ path: "note.md", content: "pending", baseContent: "base" });
    await autosave.flush();

    expect(writes).toEqual(["pending"]);
  });

  it("uses the last successful write as the next conflict base", async () => {
    vi.useFakeTimers();
    const bases: Array<string | undefined> = [];
    const writer: SheetAutosaveWriter = {
      writeSheet: async (_path, content, options) => {
        bases.push(options.baseContent);
        return { status: "written", path: "note.md", savedContent: content };
      }
    };
    const autosave = createAutosaveController({ writer, delayMs: 10 });

    autosave.schedule({ path: "note.md", content: "one", baseContent: "zero" });
    await vi.advanceTimersByTimeAsync(10);
    autosave.schedule({ path: "note.md", content: "two", baseContent: "zero" });
    await vi.advanceTimersByTimeAsync(10);

    expect(bases).toEqual(["zero", "one"]);
  });

  it("queues flushes behind in-flight writes before choosing the next conflict base", async () => {
    const releases: Array<() => void> = [];
    const writes: Array<{ content: string; baseContent: string | undefined }> = [];
    const writer: SheetAutosaveWriter = {
      writeSheet: async (_path, content, options) => {
        writes.push({ content, baseContent: options.baseContent });
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return { status: "written", path: "note.md", savedContent: content };
      }
    };
    const autosave = createAutosaveController({ writer, delayMs: 10 });

    autosave.schedule({ path: "note.md", content: "one", baseContent: "zero" });
    const firstFlush = autosave.flush();
    await Promise.resolve();

    autosave.schedule({ path: "note.md", content: "two", baseContent: "zero" });
    const secondFlush = autosave.flush();
    await Promise.resolve();

    expect(writes).toEqual([{ content: "one", baseContent: "zero" }]);

    releases.shift()?.();
    await firstFlush;
    await Promise.resolve();
    expect(writes).toEqual([
      { content: "one", baseContent: "zero" },
      { content: "two", baseContent: "one" }
    ]);

    releases.shift()?.();
    await secondFlush;
  });
});
