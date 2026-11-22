import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readNoteImport, type NoteImportPlan } from "@slate/storage/note-import";
import SourceImportDialog from "../src/imports/SourceImportDialog";

vi.mock("@slate/storage/note-import", async importOriginal => ({ ...await importOriginal<typeof import("@slate/storage/note-import")>(), readNoteImport: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const modal = new Map(["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
const plan: NoteImportPlan = { source: "bear", label: "Imported from Bear", entries: { "One.md": new TextEncoder().encode("# One") }, notes: ["One.md"], warnings: [] };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(readNoteImport).mockResolvedValue(plan);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => {
  for (const [name, descriptor] of modal) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); }
});
async function setup() {
  const beforeRead = vi.fn(async () => {}), work = { root: "Imported", run: vi.fn(async () => ["Imported/One.md"]) };
  const onPrepare = vi.fn(() => work), onImported = vi.fn(async () => {}), onClose = vi.fn();
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  await act(async () => root.render(createElement(SourceImportDialog, { beforeRead, onPrepare, onImported, onClose })));
  const click = async (name: string) => {
    const button = [...host.querySelectorAll("button")].find(button => button.textContent === name); expect(button, name).toBeDefined();
    await act(async () => button!.click());
  };
  const choose = async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Choose export files"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["Words"], "export.md")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  };
  return { beforeRead, work, onPrepare, onImported, onClose, host, click, choose, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}
it("offers all five applications, flushes before reading, and requires review before any write", async () => {
  const app = await setup();
  try {
    expect([...app.host.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Bear", "Notion", "Ulysses", "Evernote", "Apple Notes"]);
    expect(document.activeElement).toBe(app.host.querySelector("select"));
    await app.choose();
    expect(app.beforeRead.mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(readNoteImport).mock.invocationCallOrder[0]!);
    expect(app.host.textContent).toContain("1 note"); expect(app.host.textContent).toContain("One.md");
    expect(app.onPrepare).not.toHaveBeenCalled(); expect(app.work.run).not.toHaveBeenCalled();
    await app.click("Import notes");
    expect(app.onPrepare).toHaveBeenCalledExactlyOnceWith(plan); expect(app.work.run).toHaveBeenCalledOnce();
    expect(app.onImported).toHaveBeenCalledWith({ root: "Imported", paths: ["Imported/One.md"], plan }); expect(app.onClose).toHaveBeenCalledOnce();
  } finally { await app.dispose(); }
});
it("can cancel the preview without preparing or changing any files", async () => {
  const app = await setup();
  try { await app.choose(); await app.click("Cancel"); expect(app.onClose).toHaveBeenCalledOnce(); expect(app.onPrepare).not.toHaveBeenCalled(); expect(app.work.run).not.toHaveBeenCalled(); }
  finally { await app.dispose(); }
});
it("retains a failed write operation for retry without creating a second import root", async () => {
  const app = await setup();
  try {
    app.work.run.mockRejectedValueOnce(Error("Partial files kept in Imported"));
    await app.choose(); await app.click("Import notes");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toContain("Partial files kept");
    expect(app.host.querySelector("select")?.disabled).toBe(true); expect(app.onClose).not.toHaveBeenCalled();
    await app.click("Retry import"); expect(app.onPrepare).toHaveBeenCalledOnce(); expect(app.work.run).toHaveBeenCalledTimes(2); expect(app.onImported).toHaveBeenCalledOnce();
  } finally { await app.dispose(); }
});
it("blocks duplicate commits and Escape while writes are outstanding", async () => {
  const app = await setup(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    app.work.run.mockImplementationOnce(async () => { await held; return ["Imported/One.md"]; });
    await app.choose(); await app.click("Import notes"); await app.click("Retry import");
    const cancel = new Event("cancel", { bubbles: true, cancelable: true });
    await act(async () => app.host.querySelector("dialog")!.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true); expect(app.onClose).not.toHaveBeenCalled(); expect(app.work.run).toHaveBeenCalledOnce();
    await act(async () => release()); expect(app.onImported).toHaveBeenCalledOnce();
  } finally { release(); await app.dispose(); }
});
it("shows read/flush errors without starting a write and permits another selection", async () => {
  const app = await setup();
  try {
    app.beforeRead.mockRejectedValueOnce(Error("Existing draft could not be saved"));
    await app.choose(); expect(vi.mocked(readNoteImport)).not.toHaveBeenCalled(); expect(app.host.querySelector('[role="alert"]')?.textContent).toContain("Existing draft");
    vi.mocked(readNoteImport).mockRejectedValueOnce(Error("Invalid ENEX")); await app.choose(); expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("Invalid ENEX");
    expect(app.onPrepare).not.toHaveBeenCalled(); await app.choose(); expect(app.host.textContent).toContain("One.md");
  } finally { await app.dispose(); }
});
it("does not publish a delayed read after the dialog is unmounted", async () => {
  const app = await setup(); let resolve!: (value: NoteImportPlan) => void;
  vi.mocked(readNoteImport).mockReturnValueOnce(new Promise(result => { resolve = result; }));
  await app.choose(); await app.dispose(); await act(async () => resolve(plan));
  expect(app.onPrepare).not.toHaveBeenCalled(); expect(app.onImported).not.toHaveBeenCalled(); expect(app.onClose).not.toHaveBeenCalled();
});
