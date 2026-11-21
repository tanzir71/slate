import type { Page } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

/** Browser IPC contract fixture. Physical append/root-pinning contracts live in Rust. */
export async function captureFixture(page: Page) {
  await nativeFixture(page);
  await page.addInitScript(() => {
    type Draft = { id: string; spaceId: string; spaceName: string; text: string; pending: boolean; revision: number };
    type Done = { id: string; spaceId: string; text: string; path: string; conflict: boolean };
    type State = { activeDraft: Draft | null; lastCompleted: Done | null };
    const internals = Reflect.get(window, "__TAURI_INTERNALS__") as { invoke(command: string, args?: Record<string, unknown>): Promise<unknown>; metadata: { currentWindow: { label: string }; currentWebview: { label: string } } };
    internals.metadata.currentWindow.label = "capture"; internals.metadata.currentWebview.label = "capture";
    const original = internals.invoke;
    const read = (): State => JSON.parse(localStorage.getItem("native-capture-state") ?? '{"activeDraft":null,"lastCompleted":null}') as State;
    const write = (state: State) => localStorage.setItem("native-capture-state", JSON.stringify(state));
    let release: (() => void) | undefined;
    Reflect.set(window, "__CAPTURE_FIXTURE__", { releaseSave: () => { release?.(); release = undefined; } });
    internals.invoke = async (command, args = {}) => {
      if (command === "capture_snapshot") return read();
      if (command === "capture_show_main") { localStorage.setItem("native-capture-shown-main", "true"); return null; }
      if (command === "stash_capture") {
        if (localStorage.getItem("native-capture-fail-stash")) throw Error("Draft storage unavailable");
        const state = read();
        if (state.lastCompleted?.id === args.id && state.lastCompleted.text === args.text) return null;
        if (state.activeDraft?.id !== args.id || Number(args.revision) < state.activeDraft.revision ||
            Number(args.revision) === state.activeDraft.revision && (state.activeDraft.text !== args.text || state.activeDraft.pending !== args.pending) ||
            state.activeDraft.pending && (state.activeDraft.text !== args.text || !args.pending)) throw Error("Capture recovery changed");
        state.activeDraft.text = String(args.text); state.activeDraft.pending = Boolean(args.pending); state.activeDraft.revision = Number(args.revision); write(state);
        localStorage.setItem("native-capture-stashes", String(Number(localStorage.getItem("native-capture-stashes")) + 1)); return null;
      }
      if (command === "save_capture") {
        const state = read();
        if (state.lastCompleted?.id === args.id && state.lastCompleted.text === args.text) return state.lastCompleted;
        const draft = state.activeDraft;
        if (!draft || draft.id !== args.id || Number(args.revision) < draft.revision ||
            Number(args.revision) === draft.revision && (draft.text !== args.text || !draft.pending) || draft.pending && draft.text !== args.text) throw Error("Capture recovery changed");
        draft.text = String(args.text); draft.pending = true; draft.revision = Number(args.revision); write(state);
        if (localStorage.getItem("native-capture-hold-save")) await new Promise<void>(yes => { release = yes; });
        if (localStorage.getItem("native-fail-save")) throw Error("Disk is read-only");
        if (localStorage.getItem("native-capture-disconnected")) throw Error("Original Space is disconnected");
        const receiptKey = "native-capture-receipt:" + draft.id;
        let completed = JSON.parse(localStorage.getItem(receiptKey) ?? "null") as Done | null;
        if (!completed) {
          const scope = draft.spaceId === "native-default" ? "space" : "folder:" + draft.spaceId;
          const key = "native-file:" + scope + ":Inbox/Capture.md";
          const bytes = JSON.parse(localStorage.getItem(key) ?? "[]") as number[];
          const before = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes));
          const eol = before.match(/\r\n|\r|\n/)?.[0] ?? "\n";
          const tail = before.match(/(?:\r\n|\r|\n)+$/)?.[0] ?? "";
          const breaks = (tail.match(/\r\n|\r|\n/g) ?? []).length;
          const separator = !before || before === "\ufeff" ? "" : eol.repeat(Math.max(0, 2 - breaks));
          const after = before + separator + draft.text.replace(/\r\n|\r|\n/g, eol) + eol;
          localStorage.setItem(key, JSON.stringify(Array.from(new TextEncoder().encode(after))));
          completed = { id: draft.id, spaceId: draft.spaceId, text: draft.text, path: "Inbox/Capture.md", conflict: false };
          localStorage.setItem(receiptKey, JSON.stringify(completed));
        }
        if (localStorage.getItem("native-capture-lose-reply")) {
          localStorage.removeItem("native-capture-lose-reply"); throw Error("Save reply unavailable");
        }
        state.lastCompleted = completed; state.activeDraft = null; write(state); return completed;
      }
      return original(command, args);
    };
  });
}
