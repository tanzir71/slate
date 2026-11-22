import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createMemoryFiles,
  decodeText,
  encodeText,
} from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { keymapPath } from "../src/browser/keymapFile";
import KeymapEditor from "../src/browser/KeymapEditor";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const originalModal = new Map(
  ["showModal", "close"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
  ]),
);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  for (const [name, descriptor] of originalModal) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
async function setup(source?: string, owned = true) {
  const files = createMemoryFiles(
    source === undefined ? {} : { [keymapPath]: source },
  );
  const store = createWorkspaceStore(
    { id: "keymap-ui", name: "Writing", tier: "library" },
    files,
  );
  store.setOwned(owned);
  const host = document.body.appendChild(document.createElement("div")),
    root = createRoot(host),
    onSaved = vi.fn(),
    onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(KeymapEditor, {
        store,
        profile: { os: "windows", surface: "web" },
        onSaved,
        onClose,
      }),
    ),
  );
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find(
      (element) => element.textContent === text,
    )!;
  const click = async (text: string) => {
    expect(button(text)).toBeDefined();
    await act(async () => button(text).click());
  };
  const fill = async (label: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;
    expect(input).toBeDefined();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  return {
    files,
    store,
    host,
    onSaved,
    onClose,
    button,
    click,
    fill,
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it("blocks a conflicting proposal, saves a corrected shortcut, and retains extension data", async () => {
  const app = await setup('{"version":1,"bindings":{},"note":"keep"}');
  try {
    await app.fill("Shortcut for Bold", "Mod+i");
    expect(app.button("Save shortcuts").disabled).toBe(true);
    expect(
      app.host.querySelector('[aria-label="Shortcut conflicts"]')?.textContent,
    ).toContain("conflicts");
    await app.fill("Shortcut for Bold", "Mod+j");
    expect(app.button("Save shortcuts").disabled).toBe(false);
    await app.click("Save shortcuts");
    expect(app.onSaved).toHaveBeenCalledOnce();
    expect(JSON.parse(decodeText((await app.files.read(keymapPath))!))).toEqual(
      { version: 1, bindings: { "format.bold": "Mod+j" }, note: "keep" },
    );
  } finally {
    await app.dispose();
  }
});
it("leaves external bytes active and keeps the proposal visible after a conflict", async () => {
  const app = await setup();
  try {
    await app.fill("Shortcut for Bold", "Mod+j");
    const external = '{"version":1,"bindings":{"format.bold":"Alt+b"}}';
    await app.files.write(keymapPath, encodeText(external));
    await app.click("Save shortcuts");
    expect(app.onSaved).not.toHaveBeenCalled();
    expect(app.host.querySelector('[role="alert"]')?.textContent).toContain(
      "proposal is preserved",
    );
    expect(await app.files.read(keymapPath)).toEqual(encodeText(external));
    expect(
      (await app.files.list(true)).some((path) =>
        path.includes("conflicted copy"),
      ),
    ).toBe(true);
  } finally {
    await app.dispose();
  }
});
it("keeps a read-only Space unchanged while allowing Cancel", async () => {
  const app = await setup(undefined, false);
  try {
    expect(app.button("Save shortcuts").disabled).toBe(true);
    expect(app.host.querySelector("fieldset")?.disabled).toBe(true);
    await app.click("Cancel");
    expect(app.onClose).toHaveBeenCalledOnce();
    expect(await app.files.list(true)).toEqual([]);
  } finally {
    await app.dispose();
  }
});

it("keeps raw JSON repair open after the text becomes valid", async () => {
  const app = await setup("{bad");
  try {
    const textarea = app.host.querySelector("textarea")!;
    expect(textarea).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, '{"version":1,"bindings":{}}');
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(app.host.querySelector("textarea")).toBe(textarea);
    expect(app.button("Save shortcuts").disabled).toBe(false);
    await app.click("Save shortcuts");
    expect(app.onSaved).toHaveBeenCalledOnce();
  } finally {
    await app.dispose();
  }
});
