import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import {
  createWorkspaceStore,
  type WorkspaceStore,
} from "../src/browser/workspaceStore";
import { useSpaceKeymap } from "../src/browser/useSpaceKeymap";
import { commandShortcut } from "../src/commands";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const source = (key: string) =>
  encodeText(JSON.stringify({ version: 1, bindings: { "format.bold": key } }));
function store(id = "keymap-hook", bytes = source("Mod+j")) {
  const files = createMemoryFiles();
  const read = vi.spyOn(files, "read").mockResolvedValue(bytes);
  return {
    value: createWorkspaceStore(
      { id, name: "Writing", tier: "library" },
      files,
    ),
    read,
  };
}
function delayed<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
async function setup(initial: WorkspaceStore) {
  const host = document.body.appendChild(document.createElement("div")),
    root = createRoot(host);
  let latest!: ReturnType<typeof useSpaceKeymap>;
  function Probe({ value }: { value: WorkspaceStore }) {
    latest = useSpaceKeymap(value, "windows", "web");
    return null;
  }
  const render = async (value: WorkspaceStore) => {
    await act(async () => root.render(createElement(Probe, { value })));
  };
  await render(initial);
  return {
    render,
    get current() {
      return latest;
    },
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it("does not declare keyboard readiness until the first custom map has been read", async () => {
  const current = store(),
    pending = delayed<Uint8Array>();
  current.read.mockReturnValueOnce(pending.promise);
  const app = await setup(current.value);
  try {
    expect(app.current.ready).toBe(false);
    await act(async () => pending.resolve(source("Mod+j")));
    expect(app.current.ready).toBe(true);
    expect(commandShortcut("format.bold", app.current.keymap, "windows")).toBe(
      "Ctrl J",
    );
  } finally {
    await app.dispose();
  }
});
it("keeps a newly saved map when an older focus read finishes afterwards", async () => {
  const current = store(),
    app = await setup(current.value),
    pending = delayed<Uint8Array>();
  try {
    current.read.mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => app.current.accept(source("Mod+m")));
    await act(async () => pending.resolve(source("Mod+j")));
    expect(app.current.ready).toBe(true);
    expect(commandShortcut("format.bold", app.current.keymap, "windows")).toBe(
      "Ctrl M",
    );
  } finally {
    await app.dispose();
  }
});
it("rejects late data and acceptance callbacks from an earlier Space", async () => {
  const first = store("first"),
    second = store("second", source("Mod+m")),
    pending = delayed<Uint8Array>();
  first.read.mockReturnValueOnce(pending.promise);
  const app = await setup(first.value),
    oldAccept = app.current.accept;
  try {
    await app.render(second.value);
    await act(async () => {
      oldAccept(source("Mod+j"));
      pending.resolve(source("Mod+j"));
    });
    expect(app.current.ready).toBe(true);
    expect(commandShortcut("format.bold", app.current.keymap, "windows")).toBe(
      "Ctrl M",
    );
  } finally {
    await app.dispose();
  }
});
it("settles an inaccessible optional keymap with a visible default-map issue", async () => {
  const current = store();
  current.read.mockRejectedValueOnce(new Error("Access denied"));
  const app = await setup(current.value);
  try {
    expect(app.current.ready).toBe(true);
    expect(commandShortcut("format.bold", app.current.keymap, "windows")).toBe(
      "Ctrl B",
    );
    expect(app.current.keymap.issues[0]?.message).toContain(
      "could not be read",
    );
  } finally {
    await app.dispose();
  }
});
