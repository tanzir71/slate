import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createBrowserSpace } from "@slate/storage/browser-space";
import type { NoteSaveSnapshot } from "../src/browser/workspaceStore";
import { useTidyReview } from "../src/tidy/useTidyReview";
import {
  runTidyRequest,
  type TidyWorkerReply,
  type TidyWorkerRequest,
} from "../src/tidy/tidyWorkerProtocol";

const dirty = "#   Draft\n";
let requests: TidyWorkerRequest[];
let holdFix: boolean;
let releaseFix: (() => void) | undefined;
let failFix: boolean;
class WorkerFixture {
  onmessage: ((event: MessageEvent<TidyWorkerReply>) => void) | null = null;
  onerror = null;
  terminate() {
    this.onmessage = null;
  }
  postMessage(request: TidyWorkerRequest) {
    requests.push(request);
    const reply = () =>
      this.onmessage?.(
        new MessageEvent("message", {
          data:
            failFix && request.kind === "fix"
              ? { id: request.id, kind: "error", message: "Worker failed" }
              : runTidyRequest(request),
        }),
      );
    if (holdFix && request.kind === "fix") releaseFix = reply;
    else queueMicrotask(reply);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  holdFix = false;
  failFix = false;
  releaseFix = undefined;
  vi.stubGlobal("Worker", WorkerFixture);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup(
  settings: string | null = '{"version":1,"onSave":true}',
  delaySettings = false,
) {
  const files = createMemoryFiles(
    settings === null ? {} : { ".slate/tidy.json": settings },
  );
  let releaseSettings: (() => void) | undefined;
  if (delaySettings) {
    const waiting = new Promise<void>((resolve) => {
      releaseSettings = resolve;
    });
    const read = files.read;
    files.read = async (path) => {
      if (path === ".slate/tidy.json") await waiting;
      return read(path);
    };
  }
  const space = createBrowserSpace(files);
  const listeners = new Set<(snapshot: NoteSaveSnapshot) => void>();
  const subscribeNoteSaved = (
    listener: (snapshot: NoteSaveSnapshot) => void,
  ) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const apply = vi.fn(() => true);
  let writable = true,
    source = dirty,
    path = "note.md";
  let result: ReturnType<typeof useTidyReview>;
  function Harness() {
    result = useTidyReview({
      space,
      source,
      path,
      subscribeNoteSaved,
      canWrite: () => writable,
      apply,
    });
    return null;
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  cleanups.push(async () => {
    await act(async () => root.unmount());
  });
  async function render() {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }
  await render();
  return {
    files,
    apply,
    current: () => result!,
    async finishSettings() {
      await act(async () => releaseSettings?.());
    },
    async save(
      origin: NoteSaveSnapshot["origin"] = "input",
      savedSource = source,
    ) {
      await act(async () => {
        for (const listener of listeners)
          listener({ path, source: savedSource, origin });
      });
    },
    async change(next: { source?: string; path?: string; writable?: boolean }) {
      source = next.source ?? source;
      path = next.path ?? path;
      writable = next.writable ?? writable;
      await render();
    },
  };
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}
const fixes = () => requests.filter((request) => request.kind === "fix");

it.each([true, false, null])(
  "waits for initial settings before interpreting a save (onSave=%j)",
  async (onSave) => {
    const f = await setup(
      onSave === null ? null : JSON.stringify({ version: 1, onSave }),
      true,
    );
    expect(f.current().file).toBeUndefined();
    await f.save();
    await tick();
    expect(fixes()).toHaveLength(0);
    await f.finishSettings();
    await tick();
    expect(f.apply).toHaveBeenCalledTimes(onSave ? 1 : 0);
  },
);

it("discards an older save that arrives after newer input is already visible", async () => {
  const f = await setup();
  await f.change({ source: "Newer words\n" });
  await f.save("input", dirty);
  await tick();
  expect(fixes()).toHaveLength(0);
  expect(f.apply).not.toHaveBeenCalled();
});

it("waits for current lint after a canonical save and applies only once", async () => {
  const f = await setup();
  await f.save();
  expect(fixes()).toHaveLength(0);
  await tick();
  expect(fixes()).toHaveLength(1);
  expect(f.apply).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ source: dirty, output: "# Draft\n" }),
  );
  for (const origin of ["tidy", "history", "recovery"] as const)
    await f.save(origin);
  await tick();
  expect(fixes()).toHaveLength(1);
});

it("keeps missing/off/invalid settings inert and does not revive old saves when enabled", async () => {
  for (const settings of [null, '{"version":1,"onSave":false}', "{broken"]) {
    const f = await setup(settings);
    await f.save();
    await tick();
    expect(f.apply).not.toHaveBeenCalled();
    if (settings !== "{broken") {
      await act(async () => {
        await f.current().changeConfiguration({ onSave: true });
      });
      await tick();
      expect(f.apply).not.toHaveBeenCalled();
      await f.save("explicit-save");
      await tick();
      expect(f.apply).toHaveBeenCalledTimes(1);
    }
  }
});

it("does not request a fix for clean saved input", async () => {
  const f = await setup();
  await f.change({ source: "# Draft\n" });
  await f.save();
  await tick();
  expect(f.current().report?.issues).toHaveLength(0);
  expect(fixes()).toHaveLength(0);
  expect(f.apply).not.toHaveBeenCalled();
});

it.each([{ source: "New words\n" }, { path: "other.md" }, { writable: false }])(
  "discards a queued saved snapshot after %j",
  async (next) => {
    const f = await setup();
    await f.save();
    await f.change(next);
    await tick();
    expect(fixes()).toHaveLength(0);
    expect(f.apply).not.toHaveBeenCalled();
  },
);

it.each([{ source: "New words\n" }, { path: "other.md" }, { writable: false }])(
  "rejects a delayed fix after %j",
  async (next) => {
    const f = await setup();
    await tick();
    holdFix = true;
    await f.save();
    expect(releaseFix).toBeDefined();
    await f.change(next);
    await act(async () => releaseFix!());
    expect(f.apply).not.toHaveBeenCalled();
  },
);

it("discards a delayed proposal after external settings change", async () => {
  const f = await setup();
  await tick();
  holdFix = true;
  await f.save();
  await f.files.write(
    ".slate/tidy.json",
    encodeText('{"version":1,"onSave":false}'),
  );
  await act(async () => {
    await f.current().refresh();
  });
  await act(async () => releaseFix!());
  expect(f.apply).not.toHaveBeenCalled();
});

it("reports worker failures without applying or automatically retrying", async () => {
  const f = await setup();
  await tick();
  failFix = true;
  await f.save();
  expect(f.current().error).toBe("Worker failed");
  expect(f.apply).not.toHaveBeenCalled();
  await tick();
  expect(fixes()).toHaveLength(1);
});
