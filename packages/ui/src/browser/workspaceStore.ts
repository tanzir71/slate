import { createStore } from "zustand/vanilla";
import { createBrowserSpace, type BrowserSheet } from "@slate/storage/browser-space";
import type { BrowserFiles } from "@slate/storage/browser-files";
import type { BrowserSpaceRecord } from "@slate/storage/browser-catalog";

interface Draft { content: string; baseContent: string | undefined }
export interface WorkspaceState {
  record: BrowserSpaceRecord;
  sheets: BrowserSheet[];
  selectedPath: string;
  owned: boolean;
  saveState: "Saved" | "Saving…" | "Unsaved" | "Read-only";
  error: string;
  notice: string;
}

export function createWorkspaceStore(record: BrowserSpaceRecord, files: BrowserFiles) {
  const api = createStore<WorkspaceState>(() => ({ record, sheets: [], selectedPath: "", owned: record.id === "sample", saveState: "Saved", error: "", notice: "" }));
  const space = createBrowserSpace(files, () => api.getState().owned);
  const bases = new Map<string, string>();
  const drafts = new Map<string, Draft>();
  const journalKey = `slate.recovery.${record.id}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let onSaved: () => void = () => undefined;

  function journal() {
    if (record.id === "sample") return;
    try {
      if (drafts.size) localStorage.setItem(journalKey, JSON.stringify(Object.fromEntries(drafts)));
      else localStorage.removeItem(journalKey);
    } catch {
      api.setState({ error: "Recovery storage is full. Keep this tab open until saving finishes." });
    }
  }

  async function refresh() {
    const disk = await space.sheets();
    const sheets = disk.map((sheet) => {
      bases.set(sheet.path, sheet.content);
      return drafts.has(sheet.path) ? { ...sheet, content: drafts.get(sheet.path)!.content } : sheet;
    });
    for (const [path, draft] of drafts) if (!sheets.some((sheet) => sheet.path === path)) sheets.push({ path, content: draft.content });
    const selected = api.getState().selectedPath;
    api.setState({ sheets, selectedPath: sheets.some((sheet) => sheet.path === selected) ? selected : sheets[0]?.path ?? "" });
  }

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (saving) { await saving; if (drafts.size) return flush(); return; }
    if (!drafts.size) return;
    api.setState({ saveState: "Saving…" });
    saving = (async () => {
      for (const [path, draft] of [...drafts]) {
        const saved = await space.save(path, draft.content, draft.baseContent);
        const current = drafts.get(path);
        if (saved.conflict) {
          drafts.delete(path);
          if (current && current !== draft) drafts.set(saved.path, { content: current.content, baseContent: saved.content });
          api.setState((state) => ({
            selectedPath: state.selectedPath === path ? saved.path : state.selectedPath,
            notice: `An external edit was preserved. Your words are in ${saved.path}.`
          }));
        } else {
          if (current === draft) drafts.delete(path);
          else if (current) drafts.set(path, { ...current, baseContent: saved.content });
        }
        bases.set(saved.path, saved.content);
        journal();
      }
      await refresh();
      api.setState({ saveState: drafts.size ? "Unsaved" : "Saved", error: "" });
      onSaved();
    })().catch((error: unknown) => {
      api.setState({ saveState: "Unsaved", error: error instanceof Error ? error.message : "Saving failed. Your draft is retained." });
      throw error;
    }).finally(() => { saving = undefined; });
    await saving;
    if (drafts.size) await flush();
  }

  return {
    api, space, refresh, flush,
    setOnSaved(callback: () => void) { onSaved = callback; },
    notifySaved() { onSaved(); },
    setOwned(owned: boolean) { api.setState({ owned, saveState: owned ? drafts.size ? "Unsaved" : "Saved" : "Read-only" }); },
    async load() {
      let preferredPath: string | null = null;
      try { preferredPath = localStorage.getItem(`slate.last-sheet.${record.id}`); } catch { /* View preferences are optional. */ }
      await refresh();
      if (record.id !== "sample") {
        const raw = localStorage.getItem(journalKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null) {
            for (const [path, draft] of Object.entries(parsed)) {
              if (typeof draft === "object" && draft !== null && "content" in draft && typeof draft.content === "string" &&
                  (!("baseContent" in draft) || typeof draft.baseContent === "string")) {
                drafts.set(path, { content: draft.content, baseContent: "baseContent" in draft ? draft.baseContent as string : undefined });
              }
            }
            await refresh();
            if (drafts.size) api.setState({ saveState: "Unsaved", notice: "Recovered an unsaved draft from your last visit." });
          }
        }
      }
      if (preferredPath && api.getState().sheets.some((sheet) => sheet.path === preferredPath)) api.setState({ selectedPath: preferredPath });
    },
    edit(content: string) {
      const { selectedPath, owned } = api.getState();
      if (!owned || !selectedPath) return;
      const previous = drafts.get(selectedPath);
      drafts.set(selectedPath, { content, baseContent: previous ? previous.baseContent : bases.get(selectedPath) });
      api.setState((state) => ({ sheets: state.sheets.map((sheet) => sheet.path === selectedPath ? { ...sheet, content } : sheet), saveState: "Unsaved" }));
      journal();
      clearTimeout(timer);
      timer = setTimeout(() => { void flush().catch(() => undefined); }, 250);
    },
    async select(path: string) { await flush(); api.setState({ selectedPath: path }); },
    async create(notebook = "Inbox") {
      await flush();
      const sheet = await space.create(`${notebook}/Untitled.md`, "");
      await refresh();
      api.setState({ selectedPath: sheet.path });
      onSaved();
    },
    async move(path: string, to: string) {
      await flush();
      const content = bases.get(path);
      if (content === undefined) throw new Error("Sheet not found.");
      await space.move(path, to, content);
      api.setState({ selectedPath: to });
      await refresh();
      onSaved();
    },
    async trash(path: string) {
      await flush();
      const content = bases.get(path);
      if (content === undefined) throw new Error("Sheet not found.");
      await space.trash(path, content);
      await refresh();
      onSaved();
    },
    async importFiles(entries: Record<string, Uint8Array>) {
      await flush();
      await space.importFiles(entries);
      await refresh();
      onSaved();
    }
  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
