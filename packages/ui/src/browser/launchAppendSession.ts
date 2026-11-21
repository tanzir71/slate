import { appendLaunchText } from "@slate/core";
import type { WorkspaceStore } from "./workspaceStore";
import type { EditorDocumentPool } from "./editorDocumentPool";

type AppendRuntime = Pick<typeof import("@slate/editor"), "createDocumentSession" | "appendDocumentText">;

/** One confirmed request owns one history entry, including retries after a failed save. */
export function createLaunchAppendSession(store: WorkspaceStore, pool: EditorDocumentPool, path: string, text: string,
  load: () => Promise<AppendRuntime> = () => import("@slate/editor")) {
  let applied = false, completed = false, after: string | undefined, pending: Promise<void> | undefined;
  const actor = {};
  const writable = () => { if (!store.api.getState().owned) throw new Error("This Space is read-only. Choose Use here to edit."); };
  async function execute() {
    if (completed) return;
    writable();
    if (!applied) {
      const runtime = await load();
      writable();
      const sheet = await store.openSheet(path);
      if (sheet.unsupportedEncoding) throw new Error("This sheet uses an unsupported text encoding. Its original bytes were kept.");
      const session = pool.get(path, runtime.createDocumentSession);
      if (!session) throw new Error("This sheet is unavailable. Your files were kept.");
      const before = session.snapshot().source;
      after = appendLaunchText(before, text);
      try { applied = runtime.appendDocumentText(session, before, text, actor); }
      finally { if (session.snapshot().source === after && after !== before) applied = true; }
      if (!applied) throw new Error("The sheet changed or is read-only. Review it before appending.");
    }
    // A view may fail after the document was retained. Retry saving that same
    // proposal; never append it again or adopt a different authoritative source.
    if (store.api.getState().sheets.find(sheet => sheet.path === path)?.content !== after)
      throw new Error("The sheet changed. The appended words are retained in its editor; review them before saving.");
    await store.flush();
    completed = true;
    try { store.notifySaved(); }
    catch { store.api.setState({ notice: "Your words are saved. Refresh the workspace when available to update its lists." }); }
  }
  return {
    hasApplied: () => applied,
    apply(): Promise<void> {
      if (!pending) pending = execute().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
