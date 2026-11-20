import { createStore } from "zustand/vanilla";
import { createFileSpace, type FileSheet } from "@slate/storage/file-space";
import { decodeText, safeWorkspacePath, type WorkspaceFiles } from "@slate/storage/file-io";
import type { BrowserSpaceRecord } from "@slate/storage/browser-catalog";
import type { WikiLink, TextChange, planTemplateFile } from "@slate/core";
import { notebookTemplate, previousDailyNote, readWorkspacePreferences, starterKitRoot, withNotebookTemplate, type WorkspacePreferences } from "@slate/core";
import { createRecoveryJournal, type RecoveryEdit } from "./recoveryJournal";
import type { StarterKitInstallation } from "../templates/starterKits";
import type { EditorChangeOrigin } from "../commands";
import type { BatchTidySession } from "@slate/storage/tidy-batch";
import type { ReplaceBatchSession } from "@slate/storage/replace-batch";

export interface NoteSaveSnapshot {
  readonly path: string;
  readonly source: string;
  readonly origin: EditorChangeOrigin | "explicit-save" | "recovery";
}
interface Draft { content: string; baseContent: string | undefined; origin?: NoteSaveSnapshot["origin"] }
export interface WorkspaceState {
  record: BrowserSpaceRecord;
  sheets: FileSheet[];
  selectedPath: string;
  owned: boolean;
  saveState: "Saved" | "Saving…" | "Unsaved" | "Read-only";
  error: string;
  notice: string;
  preferences: WorkspacePreferences;
  hasTidyBatchUndo: boolean;
  hasReplaceBatchUndo: boolean;
  initialCursor?: { path: string; position: number } | undefined;
}

export function createWorkspaceStore(record: BrowserSpaceRecord, files: WorkspaceFiles) {
  const api = createStore<WorkspaceState>(() => ({ record, sheets: [], selectedPath: "", owned: record.id === "sample", saveState: "Saved", error: "", notice: "", preferences: readWorkspacePreferences(), hasTidyBatchUndo: false, hasReplaceBatchUndo: false }));
  const space = createFileSpace(files, () => api.getState().owned);
  const bases = new Map<string, string>();
  const drafts = new Map<string, Draft>();
  const recovery = record.id === "sample" ? undefined : createRecoveryJournal(record.id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let editGeneration = 0;
  let onSaved: () => void = () => undefined;
  const noteSaved = new Set<(snapshot: NoteSaveSnapshot) => void>();
  let linking: Promise<unknown> = Promise.resolve();
  let updatingPreferences: Promise<unknown> = Promise.resolve();
  const pendingKits = new Set<StarterKitInstallation>();
  const tidyBatches: BatchTidySession[] = [];
  const replacementBatches: ReplaceBatchSession[] = [];
  const preferencesPath = ".slate/view.json";

  async function readPreferences() {
    const bytes = await files.read(preferencesPath);
    const raw = bytes === undefined ? undefined : decodeText(bytes);
    return { raw, value: readWorkspacePreferences(raw === undefined ? undefined : JSON.parse(raw)) };
  }

  function updatePreferences(change: (current: WorkspacePreferences) => WorkspacePreferences, notify = true): Promise<void> {
    const next = updatingPreferences.then(async () => {
      const current = await readPreferences();
      const preferences = readWorkspacePreferences(change(current.value));
      const saved = await space.save(preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, current.raw);
      if (saved.conflict) throw new Error(`Workspace preferences changed outside Slate. Your copy is in ${saved.path}.`);
      api.setState({ preferences });
      if (notify) onSaved();
    });
    updatingPreferences = next.catch(() => undefined);
    return next;
  }

  function rememberCreated(sheet: FileSheet, cursor: number) {
    bases.set(sheet.path, sheet.content);
    api.setState((state) => ({
      sheets: overlayDrafts([...state.sheets.filter((row) => row.path !== sheet.path), sheet]),
      selectedPath: sheet.path, initialCursor: { path: sheet.path, position: cursor }, saveState: "Saved", error: "",
    }));
  }

  async function finishCreated(notice: string) {
    try { onSaved(); await refresh(); }
    catch { api.setState({ notice }); }
  }

  async function finishTidyBatch(batch: BatchTidySession) {
    if (batch.hasUndo() && !tidyBatches.includes(batch)) tidyBatches.push(batch);
    while (tidyBatches.length && !tidyBatches.at(-1)!.hasUndo()) tidyBatches.pop();
    api.setState({ hasTidyBatchUndo: tidyBatches.length > 0 });
    if (batch.rows().some((row) => ["applied", "undo-failed", "undone"].includes(row.status)))
      await finishCreated("Your batch changes are saved. Refresh the workspace when available to update its lists.");
    else {
      try { await refresh(); }
      catch { api.setState({ notice: "Your files are kept. Refresh the workspace when available to update its lists." }); }
    }
  }

  async function finishReplacementBatch(batch: ReplaceBatchSession) {
    if (batch.hasUndo() && !replacementBatches.includes(batch)) replacementBatches.push(batch);
    while (replacementBatches.length && !replacementBatches.at(-1)!.hasUndo()) replacementBatches.pop();
    api.setState({ hasReplaceBatchUndo: replacementBatches.length > 0 });
    if (batch.rows().some((row) => ["applied", "undo-failed", "undone"].includes(row.status)))
      await finishCreated("Your replacements are saved. Refresh the workspace when available to update its lists.");
    else {
      try { await refresh(); }
      catch { api.setState({ notice: "Your files are kept. Refresh the workspace when available to update its lists." }); }
    }
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

  function overlayDrafts(sheets: FileSheet[]) {
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
      const completed: NoteSaveSnapshot[] = [];
      for (const [path, draft] of [...drafts]) {
        const saved = await space.save(path, draft.content, draft.baseContent);
        const current = drafts.get(path);
        if (saved.conflict) {
          drafts.delete(path);
          if (current && current !== draft) drafts.set(saved.path, { ...current, baseContent: saved.content });
          api.setState((state) => ({
            selectedPath: state.selectedPath === path ? saved.path : state.selectedPath,
            notice: `An external edit was preserved. Your words are in ${saved.path}.`
          }));
        } else {
          completed.push({ path, source: saved.content, origin: draft.origin ?? "recovery" });
          if (current === draft) drafts.delete(path);
          else if (current) drafts.set(path, { ...current, baseContent: saved.content });
        }
        bases.set(saved.path, saved.content);
        journal();
      }
      await refresh();
      api.setState({ saveState: drafts.size ? "Unsaved" : "Saved", error: "" });
      for (const snapshot of completed) for (const observer of noteSaved) {
        // A completed disk write must stay Saved even when an optional observer fails.
        try { observer(snapshot); } catch { /* Other observers still receive the save. */ }
      }
      onSaved();
    })().catch((error: unknown) => {
      api.setState({ saveState: "Unsaved", error: error instanceof Error ? error.message : "Saving failed. Your draft is retained." });
      throw error;
    }).finally(() => { saving = undefined; });
    await saving;
    if (drafts.size) await flush();
  }

  function editSheet(path: string, content: string, changes?: readonly TextChange[], origin: EditorChangeOrigin = "input"): boolean {
    const state = api.getState(), sheet = state.sheets.find((candidate) => candidate.path === path);
    if (!state.owned || !sheet || sheet.unsupportedEncoding) return false;
    editGeneration++;
    const previous = drafts.get(path), before = previous?.content ?? sheet.content;
    drafts.set(path, { content, baseContent: previous ? previous.baseContent : bases.get(path), origin });
    api.setState((current) => ({ sheets: current.sheets.map((row) => row.path === path ? { ...row, content } : row), saveState: "Unsaved" }));
    journal(changes ? { path, before: before.replace(/\r\n?/g, "\n"), changes } : undefined);
    clearTimeout(timer);
    timer = setTimeout(() => { void flush().catch(() => undefined); }, 250);
    return true;
  }

  return {
    api, space, refresh, flush,
    editSheet,
    applyReplaceBatch(batch: ReplaceBatchSession, paths: readonly string[]): Promise<void> {
      const selected = new Set(paths);
      const next = linking.then(async () => {
        await flush();
        try {
          await batch.apply([...selected]);
          const failed = batch.rows().find((row) => selected.has(row.path) && (row.status === "failed" || row.status === "conflict"));
          if (failed) throw new Error(`${failed.path}: ${failed.error}`);
        } finally { await finishReplacementBatch(batch); }
      });
      linking = next.catch(() => undefined); return next;
    },
    undoReplaceBatch(): Promise<void> {
      const next = linking.then(async () => {
        const batch = replacementBatches.at(-1);
        if (!batch) return;
        await flush();
        try {
          await batch.undo();
          const failed = batch.rows().find((row) => row.status === "undo-failed");
          if (failed) throw new Error(`${failed.path}: ${failed.error}`);
        } finally { await finishReplacementBatch(batch); }
      });
      linking = next.catch(() => undefined); return next;
    },
    applyTidyBatch(batch: BatchTidySession, paths: readonly string[]): Promise<void> {
      const selected = new Set(paths);
      const next = linking.then(async () => {
        await flush();
        try {
          await batch.apply([...selected]);
          const failed = batch.rows().find((row) => selected.has(row.path) && (row.status === "failed" || row.status === "conflict"));
          if (failed) throw new Error(`${failed.path}: ${failed.error}`);
        } finally { await finishTidyBatch(batch); }
      });
      linking = next.catch(() => undefined);
      return next;
    },
    undoTidyBatch(): Promise<void> {
      const next = linking.then(async () => {
        const batch = tidyBatches.at(-1);
        if (!batch) return;
        await flush();
        try {
          await batch.undo();
          const failed = batch.rows().find((row) => row.status === "undo-failed");
          if (failed) throw new Error(`${failed.path}: ${failed.error}`);
        } finally { await finishTidyBatch(batch); }
      });
      linking = next.catch(() => undefined);
      return next;
    },
    subscribeNoteSaved(observer: (snapshot: NoteSaveSnapshot) => void) {
      noteSaved.add(observer);
      return () => { noteSaved.delete(observer); };
    },
    async save() {
      const { owned, selectedPath, sheets } = api.getState();
      const sheet = sheets.find((entry) => entry.path === selectedPath);
      if (!owned || !sheet || sheet.unsupportedEncoding) return;
      const previous = drafts.get(selectedPath);
      drafts.set(selectedPath, { content: sheet.content, baseContent: previous ? previous.baseContent : bases.get(selectedPath), origin: "explicit-save" });
      journal();
      await flush();
    },
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
    edit(content: string, changes?: readonly TextChange[], origin: EditorChangeOrigin = "input") {
      editSheet(api.getState().selectedPath, content, changes, origin);
    },
    async select(path: string) { await flush(); api.setState({ selectedPath: path, initialCursor: undefined }); },
    /** Read only the selected destination; a cached heading is never an authority for disk text. */
    async openSheet(path: string, target?: { source: string; position: number }, isCurrent?: () => boolean): Promise<FileSheet> {
      const safe = safeWorkspacePath(path);
      if (!/\.md$/i.test(safe)) throw new Error("Choose a Markdown sheet.");
      await flush();
      if (isCurrent?.() === false) throw new Error("This navigation changed. Choose the destination again.");
      const generation = editGeneration, selectedPath = api.getState().selectedPath;
      const bytes = await files.read(safe);
      if (bytes === undefined) throw new Error("This file no longer exists. Refresh your Space.");
      if (generation !== editGeneration || api.getState().selectedPath !== selectedPath || isCurrent?.() === false)
        throw new Error("The current sheet changed while opening. Your words are kept; choose the destination again.");
      if (drafts.has(safe))
        throw new Error("This sheet has a retained draft. Choose Use here to finish saving before reopening it.");
      let sheet: FileSheet;
      try { sheet = { path: safe, content: decodeText(bytes, true) }; }
      catch { sheet = { path: safe, content: "", unsupportedEncoding: true }; }
      const previous = api.getState().sheets.find((item) => item.path === safe);
      if (previous?.content === sheet.content && previous.unsupportedEncoding === sheet.unsupportedEncoding) sheet = previous;
      else api.setState((state) => ({ sheets: [...state.sheets.filter((item) => item.path !== safe), sheet].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }));
      if (!sheet.unsupportedEncoding) bases.set(safe, sheet.content);
      if (target) {
        if (sheet.unsupportedEncoding) throw new Error("This file needs UTF-8. Open the sheet to download its original bytes.");
        if (target.source !== sheet.content) throw new Error("This sheet changed. Search again before jumping to this result.");
        if (!Number.isSafeInteger(target.position) || target.position < 0 || target.position > sheet.content.length)
          throw new Error("This heading position is unavailable. Search again.");
      }
      api.setState({ selectedPath: safe, initialCursor: target ? { path: safe, position: target.position } : undefined });
      return sheet;
    },
    clearInitialCursor() { api.setState({ initialCursor: undefined }); },
    async readNotebookTemplate(notebook: string): Promise<string | undefined> {
      await updatingPreferences;
      const { value } = await readPreferences();
      api.setState({ preferences: value });
      return notebookTemplate(value, notebook);
    },
    setNotebookTemplate(notebook: string, reference: string | undefined) {
      return updatePreferences((current) => withNotebookTemplate(current, notebook, reference));
    },
    prepareStarterKit(id: string, name: string, date = new Date()): Promise<StarterKitInstallation> {
      const captured = new Date(date.getTime());
      const next = linking.then(async () => {
        if (!api.getState().owned) throw new Error("This Space is read-only. Choose Use here to edit.");
        await flush();
        const [{ starterKit, planStarterKit }, { captureTemplateContext }, paths, preferences] = await Promise.all([
          import("../templates/starterKits"), import("../templates/templateSession"), files.list(true), readPreferences(),
        ]);
        const reserved = [...Object.keys(preferences.value.notebookTemplates ?? {}), ...preferences.value.collapsedNotebooks,
          ...preferences.value.pinned, ...[...pendingKits].map((session) => session.plan.root)];
        const root = starterKitRoot(name, paths, reserved);
        const session: StarterKitInstallation = {
          plan: planStarterKit(starterKit(id), root, captureTemplateContext(record.name, root, "", captured)),
          saved: [], defaultsSaved: false, complete: false,
        };
        pendingKits.add(session);
        return session;
      });
      linking = next.catch(() => undefined);
      return next;
    },
    cancelStarterKit(session: StarterKitInstallation) { pendingKits.delete(session); },
    installStarterKit(session: StarterKitInstallation): Promise<void> {
      const next = linking.then(async () => {
        if (session.complete) return;
        if (!pendingKits.has(session)) throw new Error("Prepare this starter kit again before adding it.");
        await flush();
        for (const plan of session.plan.notes.slice(session.saved.length)) {
          const sheet = await space.create(plan.path, plan.content);
          session.saved.push(sheet);
          rememberCreated(sheet, plan.cursor ?? 0);
        }
        if (!session.defaultsSaved) {
          await updatePreferences((current) => {
            let next = current;
            for (const [notebook, reference] of Object.entries(session.plan.defaults))
              if (notebookTemplate(next, notebook) === undefined) next = withNotebookTemplate(next, notebook, reference);
            return next;
          }, false);
          session.defaultsSaved = true;
        }
        session.complete = true;
        pendingKits.delete(session);
        const first = session.saved[0]!;
        api.setState({ selectedPath: first.path, initialCursor: { path: first.path, position: 0 }, error: "" });
        await finishCreated("Your starter kit is saved. Refresh the workspace when available to update its lists.");
      });
      linking = next.catch(() => undefined);
      return next;
    },
    async createFromTemplate(plan: ReturnType<typeof planTemplateFile>) {
      await flush();
      const sheet = await space.create(plan.path, plan.content);
      // Once written, select the actual collision-resolved path before fallible refresh work.
      rememberCreated(sheet, plan.cursor ?? 0);
      await finishCreated("Your new sheet is saved. Refresh the workspace when available to update its lists.");
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
      const captured = new Date(date.getTime());
      const next = linking.then(async () => {
        await flush();
        const day = `${captured.getFullYear()}-${String(captured.getMonth() + 1).padStart(2, "0")}-${String(captured.getDate()).padStart(2, "0")}`;
        const path = `Daily/${day}.md`;
        let created: FileSheet | undefined;
        let cursor = 0;
        if (await files.read(path) === undefined) {
          const previous = previousDailyNote(await files.list(), day);
          const [{ planDailyNote }, content] = await Promise.all([
            import("../templates/dailyNote"),
            previous ? space.read(previous).catch((cause: unknown) => {
              throw new Error(`The previous daily note (${previous}) could not be read. Repair or restore it, then choose Today again.`, { cause });
            }) : Promise.resolve(undefined),
          ]);
          if (previous && content === undefined) throw new Error("The previous daily note changed. Try Today again before carrying over its tasks.");
          const plan = planDailyNote(record.name, captured, content ?? "");
          created = await space.createIfMissing(path, plan.content);
          cursor = plan.cursor ?? 0;
        }
        if (created) {
          rememberCreated(created, cursor);
          await finishCreated("Your daily note is saved. Refresh the workspace when available to update its lists.");
        } else {
          await refresh();
          const pending = api.getState().initialCursor;
          api.setState({ selectedPath: path, initialCursor: pending?.path === path ? pending : undefined });
        }
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
