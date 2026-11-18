import { createStore } from "zustand/vanilla";
import { createBrowserSpace, type BrowserSheet } from "@slate/storage/browser-space";
import { decodeText, type BrowserFiles } from "@slate/storage/browser-files";
import type { BrowserSpaceRecord } from "@slate/storage/browser-catalog";
import type { WikiLink, TextChange, planTemplateFile } from "@slate/core";
import { readWorkspacePreferences, type WorkspacePreferences } from "@slate/core";
import { createRecoveryJournal, type RecoveryEdit } from "./recoveryJournal";

interface Draft { content: string; baseContent: string | undefined }
export interface WorkspaceState {
  record: BrowserSpaceRecord;
  sheets: BrowserSheet[];
  selectedPath: string;
  owned: boolean;
  saveState: "Saved" | "Saving…" | "Unsaved" | "Read-only";
  error: string;
  notice: string;
  preferences: WorkspacePreferences;
  initialCursor?: { path: string; position: number } | undefined;
}

export function createWorkspaceStore(record: BrowserSpaceRecord, files: BrowserFiles) {
  const api = createStore<WorkspaceState>(() => ({ record, sheets: [], selectedPath: "", owned: record.id === "sample", saveState: "Saved", error: "", notice: "", preferences: readWorkspacePreferences() }));
  const space = createBrowserSpace(files, () => api.getState().owned);
  const bases = new Map<string, string>();
  const drafts = new Map<string, Draft>();
  const recovery = record.id === "sample" ? undefined : createRecoveryJournal(record.id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let onSaved: () => void = () => undefined;
  let linking: Promise<unknown> = Promise.resolve();
  let updatingPreferences: Promise<unknown> = Promise.resolve();
  const preferencesPath = ".slate/view.json";

  async function readPreferences() {
    const bytes = await files.read(preferencesPath);
    const raw = bytes === undefined ? undefined : decodeText(bytes);
    return { raw, value: readWorkspacePreferences(raw === undefined ? undefined : JSON.parse(raw)) };
  }

  function updatePreferences(change: (current: WorkspacePreferences) => WorkspacePreferences): Promise<void> {
    const next = updatingPreferences.then(async () => {
      const current = await readPreferences();
      const preferences = readWorkspacePreferences(change(current.value));
      const saved = await space.save(preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, current.raw);
      if (saved.conflict) throw new Error(`Workspace preferences changed outside Slate. Your copy is in ${saved.path}.`);
      api.setState({ preferences });
      onSaved();
    });
    updatingPreferences = next.catch(() => undefined);
    return next;
  }

  function journal(edit?: RecoveryEdit) {
    if (record.id === "sample") return;
    try {
      recovery?.save(drafts, edit);
    } catch {
      api.setState({ error: "Recovery storage is full. Keep this tab open until saving finishes." });
    }
  }

  function readRecovery() {
    return recovery?.read() ?? new Map<string, Draft>();
  }

  function overlayDrafts(sheets: BrowserSheet[]) {
    const overlaid = sheets.map((sheet) => drafts.has(sheet.path) ? { ...sheet, content: drafts.get(sheet.path)!.content } : sheet);
    for (const [path, draft] of drafts) if (!overlaid.some((sheet) => sheet.path === path)) overlaid.push({ path, content: draft.content });
    // Match file-list order before recovered drafts have reached disk, too.
    return overlaid.sort((a, b) => a.path === b.path ? 0 : a.path < b.path ? -1 : 1);
  }

  async function refresh() {
    const disk = await space.sheets();
    for (const sheet of disk) bases.set(sheet.path, sheet.content);
    const sheets = overlayDrafts(disk);
    const selected = api.getState().selectedPath;
    api.setState({ sheets, selectedPath: sheets.some((sheet) => sheet.path === selected) ? selected : sheets[0]?.path ?? "" });
  }

  async function flush(): Promise<void> {
    if (!api.getState().owned) return;
    await updatingPreferences;
    await space.flush();
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
    setOwned(owned: boolean) {
      if (owned && !api.getState().owned && record.id !== "sample") {
        // A reader's snapshot may predate the writer's final edits or completed save.
        // Read the current journal and update the buffer before enabling input.
        const recovered = readRecovery();
        drafts.clear();
        for (const [path, draft] of recovered) drafts.set(path, draft);
      }
      api.setState((state) => ({ owned, sheets: overlayDrafts(state.sheets), saveState: owned ? drafts.size ? "Unsaved" : "Saved" : "Read-only" }));
    },
    async load() {
      let preferredPath: string | null = null;
      try { preferredPath = localStorage.getItem(`slate.last-sheet.${record.id}`); } catch { /* View preferences are optional. */ }
      await refresh();
      try { api.setState({ preferences: (await readPreferences()).value }); }
      catch { api.setState({ notice: "Workspace preferences could not be read. Your notes are still available." }); }
      if (record.id !== "sample") {
        const recovered = readRecovery();
        for (const [path, draft] of recovered) drafts.set(path, draft);
        if (recovered.size) {
          await refresh();
          api.setState({ saveState: "Unsaved", notice: "Recovered an unsaved draft from your last visit." });
        }
      }
      if (preferredPath && api.getState().sheets.some((sheet) => sheet.path === preferredPath)) api.setState({ selectedPath: preferredPath });
    },
    edit(content: string, changes?: readonly TextChange[]) {
      const { selectedPath, owned } = api.getState();
      if (!owned || !selectedPath) return;
      const previous = drafts.get(selectedPath);
      const before = previous?.content ?? api.getState().sheets.find((sheet) => sheet.path === selectedPath)?.content ?? "";
      drafts.set(selectedPath, { content, baseContent: previous ? previous.baseContent : bases.get(selectedPath) });
      api.setState((state) => ({ sheets: state.sheets.map((sheet) => sheet.path === selectedPath ? { ...sheet, content } : sheet), saveState: "Unsaved" }));
      journal(changes ? { path: selectedPath, before: before.replace(/\r\n?/g, "\n"), changes } : undefined);
      clearTimeout(timer);
      timer = setTimeout(() => { void flush().catch(() => undefined); }, 250);
    },
    async select(path: string) { await flush(); api.setState({ selectedPath: path, initialCursor: undefined }); },
    clearInitialCursor() { api.setState({ initialCursor: undefined }); },
    async createFromTemplate(plan: ReturnType<typeof planTemplateFile>) {
      await flush();
      const sheet = await space.create(plan.path, plan.content);
      // Once written, select the actual collision-resolved path before fallible refresh work.
      bases.set(sheet.path, sheet.content);
      api.setState((state) => ({
        sheets: overlayDrafts([...state.sheets.filter((row) => row.path !== sheet.path), sheet]),
        selectedPath: sheet.path,
        initialCursor: { path: sheet.path, position: plan.cursor ?? 0 },
        saveState: "Saved", error: "",
      }));
      try { onSaved(); await refresh(); }
      catch { api.setState({ notice: "Your new sheet is saved. Refresh the workspace when available to update its lists." }); }
      return sheet;
    },
    async create(notebook = "Inbox") {
      await flush();
      const sheet = await space.create(`${notebook}/Untitled.md`, "");
      await refresh();
      api.setState({ selectedPath: sheet.path });
      onSaved();
    },
    openToday(date = new Date()): Promise<void> {
      const next = linking.then(async () => {
        await flush();
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const path = `Daily/${day}.md`;
        if (await space.read(path) === undefined) await space.create(path, `# ${day}\n\n`);
        await refresh();
        api.setState({ selectedPath: path });
        onSaved();
      });
      linking = next.catch(() => undefined);
      return next;
    },
    togglePinned(path: string) { return updatePreferences((current) => ({ ...current, pinned: current.pinned.includes(path) ? current.pinned.filter((entry) => entry !== path) : [...current.pinned, path] })); },
    setDensity(density: WorkspacePreferences["density"]) { return updatePreferences((current) => ({ ...current, density })); },
    toggleNotebook(path: string) { return updatePreferences((current) => ({ ...current, collapsedNotebooks: current.collapsedNotebooks.includes(path) ? current.collapsedNotebooks.filter((entry) => entry !== path) : [...current.collapsedNotebooks, path] })); },
    followWikiLink(link: Pick<WikiLink, "target" | "targetId" | "display">): Promise<void> {
      const next = linking.then(async () => {
        await flush();
        const [sheets, { findWikiSheet }] = await Promise.all([space.sheets(), import("./wikiSheet")]);
        const existing = findWikiSheet(sheets, link);
        if (existing) { await refresh(); api.setState({ selectedPath: existing.path }); return; }
        const title = (link.targetId ? link.display : link.target).trim().replace(/[\r\n]+/g, " ") || "Untitled";
        let filename = [...title].map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character).join("").replace(/[. ]+$/g, "").trim() || "Untitled";
        if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`;
        const metadata = `---\n${link.targetId ? `id: ${JSON.stringify(link.targetId)}\n` : ""}title: ${JSON.stringify(title)}\n---\n\n`;
        const sheet = await space.create(`Inbox/${filename}.md`, `${metadata}# ${title}\n\n`);
        await refresh();
        api.setState({ selectedPath: sheet.path });
        onSaved();
      });
      linking = next.catch(() => undefined);
      return next;
    },
    async move(path: string, to: string) {
      await flush();
      const content = bases.get(path);
      if (content === undefined) throw new Error("Sheet not found.");
      await space.move(path, to, content);
      api.setState({ selectedPath: to });
      await refresh();
      onSaved();
      if (api.getState().preferences.pinned.includes(path)) {
        try { await updatePreferences((current) => ({ ...current, pinned: current.pinned.map((entry) => entry === path ? to : entry) })); }
        catch { api.setState({ notice: "The sheet moved safely. Its pinned preference could not be updated." }); }
      }
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
