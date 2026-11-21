import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useStore } from "zustand";
import { CalendarDays, ChevronDown, Hash, Inbox, Plus, Search, Download, BookOpen, Info, Pin, HardDrive, Keyboard, Filter, Gauge, FileText, Settings } from "lucide-react";
import { commandAvailable, matchCommand, resolveCommandKeymap, type PaletteEntry, type WikiCompletionTarget, type ScopedSnippet } from "@slate/core";
import { useTemplateLibrary } from "../blocks/useTemplateLibrary";
import { useBlockLibrary } from "../blocks/useBlockLibrary";
import { useSnippetLibrary } from "../snippets/useSnippetLibrary";
import type { SnippetTarget } from "../snippets/snippetTypes";
import type { SnippetInvocation, PreparedSnippet } from "../snippets/snippetSession";
import { safeBrowserPath, type BrowserDirectoryHandle } from "@slate/storage/browser-files";
import { addBrowserImportEntry, collectBrowserDrop, type BrowserImportFile } from "@slate/storage/browser-import";
import type { WorkspaceStore } from "./workspaceStore";
import type { BrowserAppProps } from "./BrowserApp";
import { LaunchActions, type LaunchTemplateRequest } from "./LaunchActions";
import { AppearanceControl, type useAppearance } from "../appearance";
import { BrandMark } from "../BrandMark";
import { commandShortcut, createCursorStore, keyboardInput, readKeymap, shortcutOS, workspaceCommands, type EditorCreationTarget, type MarkdownEditorHandle, type EditorCursor } from "../commands";
import type { WorkspaceRuntime } from "./workspaceRuntime";
import { CommandDialog } from "./CommandDialog";
import { PaletteDialog } from "./PaletteDialog";
import { paletteIdentity, workspacePalette, type WorkspacePalette } from "./workspacePalette";
import { WorkspaceTitleBar } from "./WorkspaceTitleBar";
import { WorkspaceStatusBar } from "./WorkspaceStatusBar";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { NotebookTree } from "./NotebookTree";
import { SheetList } from "./SheetList";
import { filterWorkspaceDocuments, workspaceTagSummary } from "./workspaceCollections";
import { useSheetSummaries } from "./useSheetSummaries";
import { sheetStructureReady } from "./sheetStructureReady";
import { EditorSettingsDialog } from "../EditorSettingsDialog";
import { useEditorPreferences } from "../editorPreferences";
import { useTidyReview } from "../tidy/useTidyReview";
import { createFreshIndex } from "./freshIndex";
import { createWorkspaceNavigation } from "./workspaceNavigation";
import { createEditorDocumentPool } from "./editorDocumentPool";
import { createWorkspaceEditorLayout, type EditorPaneId } from "./workspaceEditorLayout";
import { EditorTabs } from "./EditorTabs";
import { createWorkspaceViewModes, nextWorkspaceViewMode, type WorkspaceViewMode } from "./workspaceViewModes";
import { createWorkspaceWritingModes } from "./workspaceWritingModes";
import { WorkspaceWritingControls } from "./WorkspaceWritingControls";
import { WorkspaceZenHud } from "./WorkspaceZenHud";
import "./workspaceWriting.css";

const Editor = lazy(() => import("./WorkspaceDocumentEditor"));
const Inspector = lazy(() => import("./WorkspaceInspector"));
const TemplateGallery = lazy(() => import("../templates/TemplateGallery"));
const NotebookTemplateDialog = lazy(() => import("../templates/NotebookTemplateDialog"));
const StarterKitDialog = lazy(() => import("../templates/StarterKitDialog"));
const SnippetPicker = lazy(() => import("../snippets/SnippetPicker"));
const SnippetPrompt = lazy(() => import("../snippets/SnippetPrompt"));
const BlockSettings = lazy(() => import("../blocks/BlockSettings"));
const SnippetSettings = lazy(() => import("../snippets/SnippetSettings"));
const TidyPanel = lazy(() => import("../tidy/TidyPanel"));
const BatchTidyDialog = lazy(() => import("../tidy/BatchTidyDialog"));
const WorkspaceSearchDialog = lazy(() => import("../search/WorkspaceSearchDialog"));
interface TemplateRequest {
  notebook: string; selection: string; returnFocus: HTMLElement | undefined;
  initialTemplateId?: string; initialDestination?: string;
  initialTitle?: string | undefined; initialBodyText?: string | undefined;
}
interface FolderObserver {
  observe(handle: BrowserDirectoryHandle, options: { recursive: boolean }): Promise<void>;
  disconnect(): void;
}
interface ObserverWindow extends Window { FileSystemObserver?: new(callback: () => void) => FolderObserver }
interface PaletteRequest {
  mode: "all" | "sheets";
  catalog: WorkspacePalette;
  target: EditorCreationTarget | undefined;
  returnFocus: HTMLElement | undefined;
  editor: boolean;
  selection: boolean;
  tableColumns: number;
}
const subscribeEmpty = () => () => undefined;
const getEmpty = () => undefined;
const emptyBlocks = [] as const, emptyTemplates = [] as const, emptySnippets = [] as const;
const editorViewCommands: ReadonlySet<string> = new Set(["view.mode", "view.focus", "view.typewriter", "view.zen"]);
const priorityCommands: ReadonlySet<string> = new Set([...editorViewCommands, "view.inspector", "view.split", "view.newTab", "view.closeTab", "view.reopenTab", "view.nextTab", "view.previousTab"]);
interface WorkspaceProps {
  runtime?: WorkspaceRuntime;
  appearance: ReturnType<typeof useAppearance>;
  store: WorkspaceStore;
  createIndex: BrowserAppProps["createIndex"];
  onKeepSample: () => Promise<void>;
  onTakeover: () => Promise<void>;
  onSwitchSpace: () => Promise<void>;
  onAbout: () => void;
  onInstall: (() => void) | undefined;
}

export default function BrowserWorkspace({ store, createIndex, onKeepSample, onTakeover, onSwitchSpace, onAbout, onInstall, appearance, runtime }: WorkspaceProps) {
  const state = useStore(store.api);
  const writingModes = useMemo(createWorkspaceWritingModes, [store]);
  const writing = useSyncExternalStore(writingModes.subscribe, writingModes.getSnapshot);
  useEffect(() => () => writingModes.dispose(), [writingModes]);
  const viewModes = useMemo(() => createWorkspaceViewModes(store), [store]);
  useSyncExternalStore(viewModes.subscribe, viewModes.getSnapshot);
  useEffect(() => viewModes.connect(), [viewModes]);
  const editors = useMemo(() => ({ pool: createEditorDocumentPool(store), layout: createWorkspaceEditorLayout(store), lease: 0 }), [store]);
  const editorLayout = useSyncExternalStore(editors.layout.subscribe, editors.layout.getSnapshot);
  useLayoutEffect(() => {
    const lease = ++editors.lease, stopLayout = editors.layout.connect(), stopPool = editors.pool.connect();
    return () => {
      stopLayout(); stopPool();
      // StrictMode reconnects this resource before the microtask; a real Space exit disposes it.
      queueMicrotask(() => { if (editors.lease === lease) { editors.layout.dispose(); editors.pool.dispose(); } });
    };
  }, [editors]);
  const navigation = useMemo(() => createWorkspaceNavigation(store), [store]);
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  useEffect(() => navigation.connect(), [navigation]);
  const snippets = useSnippetLibrary(store, runtime?.openGlobalSnippets);
  const blocks = useBlockLibrary(store);
  const templates = useTemplateLibrary(store);
  const paletteBlocks = useSyncExternalStore(blocks.library?.subscribe ?? subscribeEmpty, blocks.library?.getSnapshot ?? getEmpty);
  const paletteTemplates = useSyncExternalStore(templates.library?.subscribe ?? subscribeEmpty, templates.library?.getSnapshot ?? getEmpty);
  const refreshLibraries = useRef({ templates: templates.library, blocks: blocks.library, snippets: snippets.library });
  const refreshTidy = useRef<(() => Promise<void>) | undefined>(undefined);
  useLayoutEffect(() => {
    refreshLibraries.current = { templates: templates.library, blocks: blocks.library, snippets: snippets.library };
  }, [templates.library, blocks.library, snippets.library]);
  const [blockSettings, setBlockSettings] = useState<{ returnFocus: HTMLElement | undefined }>();
  const [snippetPicker, setSnippetPicker] = useState<SnippetInvocation>();
  const [snippetPrompt, setSnippetPrompt] = useState<PreparedSnippet>();
  const [snippetSettings, setSnippetSettings] = useState<{ returnFocus: HTMLElement | undefined }>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const inspectorKey = `slate.inspector.${state.record.id}`;
  const [inspector, setInspector] = useState(() => {
    try { return localStorage.getItem(inspectorKey) === "true"; } catch { return false; }
  });
  const [palette, setPalette] = useState<PaletteRequest>();
  const [workspaceSearch, setWorkspaceSearch] = useState<{ returnFocus: HTMLElement | undefined; restoreFocus: (() => void) | undefined; query?: string }>();
  const [shortcuts, setShortcuts] = useState(false);
  const [editorSettings, setEditorSettings] = useState(false);
  const [templateRequest, setTemplateRequest] = useState<TemplateRequest>();
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [notebookTemplateRequest, setNotebookTemplateRequest] = useState<{ notebook: string; returnFocus: HTMLElement | undefined }>();
  const [starterKitRequest, setStarterKitRequest] = useState<{ returnFocus: HTMLElement | undefined }>();
  const editorPreferences = useEditorPreferences();
  const [pane, setPane] = useState<"navigation" | "sheets" | "editor">(() => state.selectedPath ? "editor" : "sheets");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sheetsVisible, setSheetsVisible] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Set(state.preferences.collapsedNotebooks));
  const [actionBusy, setActionBusy] = useState(false);
  const [actionPaths, setActionPaths] = useState<string[]>([]);
  const [tidyBatch, setTidyBatch] = useState<{ paths: string[]; returnFocus: HTMLElement | undefined }>();
  const cursor = useMemo(createCursorStore, []);
  const os = shortcutOS();
  const surface = runtime?.surface ?? "web";
  const registry = useMemo(() => workspaceCommands(surface), [surface]);
  const [keymap, setKeymap] = useState(() => readKeymap(undefined, os, surface));
  const [action, setAction] = useState<"rename" | "move" | "trash" | "notebook" | undefined>();
  const [actionValue, setActionValue] = useState("");
  const [extraNotebooks, setExtraNotebooks] = useState<string[]>([]);
  const [usage, setUsage] = useState("");
  const [matches, setMatches] = useState<string[] | undefined>();
  const [indexWarning, setIndexWarning] = useState("");
  const [indexVersion, setIndexVersion] = useState(0);
  const currentQuery = useRef(query);
  useLayoutEffect(() => { currentQuery.current = query; }, [query]);
  const [editorReady, setEditorReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const editorSettingsInvoker = useRef<HTMLElement | undefined>(undefined);
  const aboutButton = useRef<HTMLButtonElement>(null);
  const index = useRef<ReturnType<typeof createFreshIndex> | undefined>(undefined);
  const queryGeneration = useRef(0);
  const editorHandle = useRef<MarkdownEditorHandle | undefined>(undefined);
  const paneHandles = useRef<Partial<Record<EditorPaneId, MarkdownEditorHandle>>>({});
  const paneCursors = useRef<Partial<Record<EditorPaneId, EditorCursor>>>({});
  const pendingNavigation = useRef<{ path: string; source: string; position?: number } | undefined>(undefined);
  const selected = useMemo(() => state.sheets.find((sheet) => sheet.path === state.selectedPath), [state.sheets, state.selectedPath]);
  const paneSheets = useMemo(() => ({
    primary: state.sheets.find(sheet => sheet.path === editorLayout.primary),
    secondary: editorLayout.secondary === undefined ? undefined : state.sheets.find(sheet => sheet.path === editorLayout.secondary),
  }), [state.sheets, editorLayout.primary, editorLayout.secondary]);
  const tidy = useTidyReview({
    subscribeNoteSaved: store.subscribeNoteSaved,
    space: store.space,
    source: editorReady && selected && !selected.unsupportedEncoding ? selected.content : undefined,
    path: selected && !selected.unsupportedEncoding ? selected.path : undefined,
    canWrite: () => store.api.getState().owned && viewModes.mode(store.api.getState().selectedPath) !== "read",
    apply(result) {
      const current = store.api.getState();
      const sheet = current.sheets.find((item) => item.path === current.selectedPath);
      if (!current.owned || current.selectedPath !== selected?.path || sheet?.content !== result.source || editorHandle.current?.source() !== result.source) return false;
      return editorHandle.current.applyTidy(result);
    },
  });
  const tidyLines = useMemo(() => tidy.report ? [...new Set(tidy.report.issues.map((issue) => issue.line))] : [], [tidy.report]);
  const viewMode = tidy.open ? "source" : viewModes.mode(state.selectedPath);
  const viewDisabled = !selected || !!selected.unsupportedEncoding || tidy.busy || tidy.saving;
  const tidyLayout = useRef({ sheets: true, inspector: false });
  useLayoutEffect(() => { refreshTidy.current = tidy.refresh; }, [tidy.refresh]);
  function openTidy() {
    if (!selected || selected.unsupportedEncoding) return;
    writingModes.zen(false);
    if (!tidy.open) tidyLayout.current = { sheets: sheetsVisible, inspector };
    setSheetsVisible(false);
    setInspector(false);
    setPane("editor");
    tidy.setOpen(true);
  }
  function closeTidy() {
    tidy.setOpen(false);
    setSheetsVisible(tidyLayout.current.sheets);
    setInspector(tidyLayout.current.inspector);
    editorHandle.current?.focus();
  }
  function changeViewMode(mode: WorkspaceViewMode) {
    if (viewDisabled) return;
    if (tidy.open) closeTidy();
    viewModes.set(state.selectedPath, mode);
  }
  function focusWriting() { requestAnimationFrame(() => editorHandle.current?.focus(true)); }
  function exitZen() { writingModes.zen(false); focusWriting(); }
  function toggleZen() {
    if (writingModes.getSnapshot().zen) { exitZen(); return; }
    if (viewDisabled) return;
    if (tidy.open) closeTidy();
    writingModes.zen(true); focusWriting();
  }
  function toggleWritingFocus() { if (!viewDisabled) { writingModes.toggleFocus(); focusWriting(); } }
  function toggleTypewriter() { if (!viewDisabled) { writingModes.toggleTypewriter(); focusWriting(); } }
  const documents = useSheetSummaries(state.sheets);
  const fileIdentities = useMemo(() => JSON.stringify(state.sheets.map(({ path, unsupportedEncoding }) => ({ path, ...(unsupportedEncoding ? { unsupportedEncoding: true } : {}) }))), [state.sheets]);
  const paletteFiles = useMemo(() => JSON.parse(fileIdentities) as { path: string; unsupportedEncoding?: boolean }[], [fileIdentities]);
  const paletteCatalog = useMemo(() => workspacePalette({ commands: registry, files: paletteFiles, documents,
    blocks: paletteBlocks?.blocks ?? emptyBlocks, templates: paletteTemplates?.items ?? emptyTemplates, snippets: snippets.snapshot?.snippets ?? emptySnippets,
  }), [registry, paletteFiles, documents, paletteBlocks?.blocks, paletteTemplates?.items, snippets.snapshot?.snippets]);
  const summariesPending = useMemo(() => !sheetStructureReady(paletteFiles, documents), [paletteFiles, documents]);
  const document = paletteCatalog.documents.get(state.selectedPath);
  const canInsertBlock = useCallback(() => store.api.getState().owned, [store]);
  const completionIdentities = useMemo(() => JSON.stringify(documents.map(({ id, path, title }) => ({ id, path, title }))), [documents]);
  const completionSheets = useMemo(() => JSON.parse(completionIdentities) as WikiCompletionTarget[], [completionIdentities]);
  const sheetPaths = useMemo(() => paletteFiles.map(sheet => sheet.path), [paletteFiles]);
  const notebooks = useMemo(() => [...new Set([...sheetPaths.map(notebookFor).filter(Boolean), ...extraNotebooks])].sort(), [sheetPaths, extraNotebooks]);
  const tagSummary = useMemo(() => workspaceTagSummary(documents), [documents]);
  const tagIdentities = useMemo(() => JSON.stringify(tagSummary.tags), [tagSummary.tags]);
  const tags = useMemo(() => JSON.parse(tagIdentities) as string[], [tagIdentities]);
  const recentTime = filter === "@recent" ? Date.now() : undefined;
  const visible = useMemo(() => filterWorkspaceDocuments(documents, filter, state.preferences.pinned, query, matches,
    recentTime === undefined ? undefined : new Date(recentTime)), [documents, filter, state.preferences.pinned, query, matches, recentTime]);
  const pinnedCount = useMemo(() => {
    const pinned = new Set(state.preferences.pinned);
    return pinned.size ? documents.filter(sheet => pinned.has(sheet.path)).length : 0;
  }, [documents, state.preferences.pinned]);
  const inboxCount = useMemo(() => documents.filter(sheet => sheet.path.startsWith("Inbox/")).length, [documents]);
  const readOnlyPaths = useMemo(() => new Set(paletteFiles.filter(sheet => sheet.unsupportedEncoding).map(sheet => sheet.path)), [paletteFiles]);
  const listTitle = ({ "@pinned": "Pinned", "@drafts": "Drafts in progress", "@goals": "Goal in progress", "@recent": "Edited recently" } as Record<string, string>)[filter] ?? (filter.startsWith("#") ? filter : filter.split("/").at(-1) || "All sheets");

  function selectFilter(value: string) { setFilter(value); setPane("sheets"); setSheetsVisible(true); }
  function toggleNavigation() {
    if (window.matchMedia("(max-width: 899px)").matches) setPane((current) => current === "navigation" ? state.selectedPath ? "editor" : "sheets" : "navigation");
    else setSidebarVisible((value) => !value);
  }
  function toggleSheets() {
    if (window.matchMedia("(max-width: 699px)").matches) setPane((current) => current === "sheets" && state.selectedPath ? "editor" : "sheets");
    else setSheetsVisible((value) => !value);
  }
  function openWorkspaceSearch() {
    openSearchWithQuery("");
  }
  function openSearchWithQuery(query: string) {
    const active = window.document.activeElement;
    const returnFocus = active instanceof HTMLElement ? active : undefined, editor = editorHandle.current;
    // Native dialog close may return DOM focus before the editor's selection.
    const restoreFocus = editor && editor.hasFocus() && returnFocus?.classList.contains("cm-content")
      ? () => { if (editorHandle.current === editor) editor.focus(); }
      : undefined;
    setWorkspaceSearch({ returnFocus, restoreFocus, query });
  }
  async function openLinkedTemplate(request: LaunchTemplateRequest) {
    const library = templates.library;
    if (!library) throw new Error("Templates are loading. Try again when they are ready.");
    await library.refresh();
    const reference = request.template.startsWith("template:") ? request.template.slice(9) : request.template;
    const chosen = library.getSnapshot().items.find(entry => entry.item.id === reference || entry.item.id === "builtin:" + reference);
    if (!chosen) throw new Error("This template is unavailable in this Space. Choose another template from the gallery.");
    const active = window.document.activeElement;
    setTemplateRequest({ notebook: request.notebook ?? "Inbox", selection: "", returnFocus: active instanceof HTMLElement ? active : undefined,
      initialTemplateId: chosen.item.id, ...(request.notebook === undefined ? {} : { initialDestination: request.notebook }),
      initialTitle: request.title, initialBodyText: request.text });
  }
  async function chooseSearchResult(path: string, target?: { source: string; position: number }) {
    const sheet = await store.openSheet(path, target);
    pendingNavigation.current = sheet.unsupportedEncoding ? undefined : { path: sheet.path, source: sheet.content, ...(target ? { position: target.position } : {}) };
    setPane("editor"); setWorkspaceSearch(undefined);
  }

  const run = useCallback((work: () => Promise<unknown>) => {
    void work().catch((error: unknown) => store.api.setState({ error: error instanceof Error ? error.message : "The operation failed. Your files were kept." }));
  }, [store]);
  const receivePaneEditor = useCallback((pane: EditorPaneId, handle: MarkdownEditorHandle | undefined) => {
    if (handle) paneHandles.current[pane] = handle; else delete paneHandles.current[pane];
    if (editors.layout.getSnapshot().active === pane) editorHandle.current = handle;
  }, [editors]);
  const receivePrimary = useCallback((handle: MarkdownEditorHandle | undefined) => receivePaneEditor("primary", handle), [receivePaneEditor]);
  const receiveSecondary = useCallback((handle: MarkdownEditorHandle | undefined) => receivePaneEditor("secondary", handle), [receivePaneEditor]);
  const receivePaneCursor = useCallback((pane: EditorPaneId, next: EditorCursor) => {
    paneCursors.current[pane] = next;
    if (editors.layout.getSnapshot().active === pane) cursor.update(next);
  }, [editors, cursor]);
  const cursorPrimary = useCallback((next: EditorCursor) => receivePaneCursor("primary", next), [receivePaneCursor]);
  const cursorSecondary = useCallback((next: EditorCursor) => receivePaneCursor("secondary", next), [receivePaneCursor]);
  const documentError = useCallback((error: unknown) => store.api.setState({ error: error instanceof Error ? error.message : "These words are retained. Keep the editor open to recover them." }), [store]);
  useLayoutEffect(() => {
    editorHandle.current = paneHandles.current[editorLayout.active];
    const next = paneCursors.current[editorLayout.active]; if (next) cursor.update(next);
  }, [editorLayout, cursor]);
  const focusCreatedSheet = useCallback(() => {
    if (templateRequest || starterKitRequest || palette || workspaceSearch || launchDialogOpen) return;
    const current = store.api.getState(), handle = editorHandle.current;
    const navigation = pendingNavigation.current;
    if (navigation && current.selectedPath === navigation.path && handle?.documentKey() === `${current.record.id}/${navigation.path}` && handle.source() === navigation.source) {
      if (navigation.position === undefined) handle.focus();
      else if (!handle.goToSourceOffset(navigation.source, navigation.position)) return;
      pendingNavigation.current = undefined; store.clearInitialCursor();
    } else if (!navigation && current.initialCursor?.path === current.selectedPath && handle?.documentKey() === `${current.record.id}/${current.selectedPath}`) {
      const source = current.sheets.find((sheet) => sheet.path === current.selectedPath)?.content;
      if (source !== undefined && handle.goToSourceOffset(source, current.initialCursor.position)) store.clearInitialCursor();
    }
  }, [store, templateRequest, starterKitRequest, palette, workspaceSearch, launchDialogOpen]);
  const editorBecameReady = useCallback(() => { setEditorReady(true); focusCreatedSheet(); }, [focusCreatedSheet]);
  function activatePane(id: EditorPaneId) {
    if (editors.layout.getSnapshot().active !== id) pendingNavigation.current = undefined;
    if (!editors.layout.focus(id)) return;
    editorHandle.current = paneHandles.current[id]; const next = paneCursors.current[id]; if (next) cursor.update(next);
  }
  function focusSelected(position?: number) {
    const current = store.api.getState(), sheet = current.sheets.find((item) => item.path === current.selectedPath);
    pendingNavigation.current = sheet && !sheet.unsupportedEncoding ? { path: sheet.path, source: sheet.content, ...(position === undefined ? {} : { position }) } : undefined;
    setPane("editor"); requestAnimationFrame(focusCreatedSheet);
  }
  function toggleSplit() {
    const current = editors.layout.getSnapshot();
    if (current.secondary === undefined) { if (editors.layout.split()) focusSelected(); return; }
    const path = current[current.active] ?? "", source = store.api.getState().sheets.find((sheet) => sheet.path === path)?.content;
    const position = paneCursors.current[current.active]; let offset: number | undefined;
    if (source !== undefined && position) {
      let line = 1, from = 0; const endings = /\r\n|\r|\n/g; let match: RegExpExecArray | null;
      while (line < position.line && (match = endings.exec(source))) { from = match.index + match[0].length; line++; }
      offset = Math.min(source.length, from + position.column - 1);
    }
    if (editors.layout.collapse()) focusSelected(offset);
  }
  useEffect(() => {
    if (!templateRequest && !starterKitRequest && !palette && !workspaceSearch && !launchDialogOpen && (state.initialCursor || pendingNavigation.current)) {
      // Native dialog cleanup restores its invoker; focus the new editor after it closes.
      const frame = requestAnimationFrame(focusCreatedSheet);
      return () => cancelAnimationFrame(frame);
    }
  }, [templateRequest, starterKitRequest, palette, workspaceSearch, launchDialogOpen, state.initialCursor, focusCreatedSheet]);
  const navigateWiki = useCallback((link: Parameters<WorkspaceStore["followWikiLink"]>[0]) => run(() => store.followWikiLink(link)), [store, run]);

  function shortcut(id: string) { return commandShortcut(id, keymap, os); }
  function captureTemplateRequest(notebook: string) {
    const active = window.document.activeElement;
    return { notebook, selection: editorHandle.current?.selectedText() ?? "", returnFocus: active instanceof HTMLElement ? active : undefined };
  }
  function openNotebookTemplate(notebook: string) {
    if (state.owned) setNotebookTemplateRequest(captureTemplateRequest(notebook));
  }
  function requestNewSheet() {
    if (!state.owned) return;
    const notebook = filter && !/^[#@]/.test(filter) ? filter : "Inbox";
    const request = captureTemplateRequest(notebook);
    run(async () => {
      const reference = await store.readNotebookTemplate(notebook);
      if (!store.api.getState().owned) throw new Error("This Space is read-only. Choose Use here to edit.");
      if (reference !== undefined) setTemplateRequest({ ...request, initialTemplateId: reference, initialDestination: notebook });
      else await store.create(notebook);
    });
  }

  const applySnippet = useCallback((invocation: SnippetInvocation, definition: ScopedSnippet) => {
    if (!snippets.session || !store.api.getState().owned) return false;
    try {
      const prepared = snippets.session.prepareSnippet(invocation, definition);
      if (prepared.needsInput) setSnippetPrompt(prepared);
      else if (!prepared.target.insert(prepared.rendered)) store.api.setState({ notice: "The sheet changed or is read-only. Choose the snippet again." });
    } catch (cause) { store.api.setState({ error: cause instanceof Error ? cause.message : String(cause) }); }
    return true;
  }, [store, snippets.session]);
  const expandSnippet = useCallback((definition: ScopedSnippet, target: SnippetTarget, context?: SnippetInvocation["context"]) => {
    if (!snippets.session || !store.api.getState().owned) return false;
    const current = store.api.getState();
    return applySnippet(context ? { target, context } : snippets.session.createSnippetInvocation(target, current.record.name, current.selectedPath), definition);
  }, [store, snippets.session, applySnippet]);
  const openBlockSettings = useCallback((returnFocus?: HTMLElement) => {
    const active = window.document.activeElement;
    if (blocks.library) { setBlockSettings({ returnFocus: returnFocus ?? (active instanceof HTMLElement ? active : undefined) }); run(blocks.library.refresh); }
  }, [blocks.library, run]);
  function openEditorSettings() {
    const active = window.document.activeElement;
    editorSettingsInvoker.current = active instanceof HTMLElement ? active : undefined;
    setEditorSettings(true);
  }
  function openSnippetSettings(returnFocus?: HTMLElement) {
    const active = window.document.activeElement;
    if (snippets.library) { setSnippetSettings({ returnFocus: returnFocus ?? (active instanceof HTMLElement ? active : undefined) }); run(snippets.library.refresh); }
  }
  function openSnippetPicker() {
    if (!store.api.getState().owned) return;
    const target = editorHandle.current?.snippetTarget();
    if (!target) { store.api.setState({ notice: "Place the cursor outside code to insert a snippet." }); return; }
    if (!snippets.session || !snippets.library) { store.api.setState({ notice: "Snippets are loading. Try again in a moment." }); return; }
    const current = store.api.getState();
    setSnippetPicker(snippets.session.createSnippetInvocation(target, current.record.name, current.selectedPath));
    run(snippets.library.refresh);
  }

  function openBatchTidy(paths: readonly string[]) {
    const active = window.document.activeElement;
    setTidyBatch({ paths: [...paths], returnFocus: active instanceof HTMLElement ? active : undefined });
  }

  function openPalette(mode: "all" | "sheets") {
    const current = store.api.getState(), handle = editorHandle.current;
    const active = window.document.activeElement;
    const request: PaletteRequest = { mode, catalog: paletteCatalog, target: handle?.creationTarget(),
      returnFocus: active instanceof HTMLElement ? active : undefined,
      editor: current.owned && !!selected && !selected.unsupportedEncoding && viewModes.mode(current.selectedPath) !== "read",
      selection: handle?.hasSelection() ?? false, tableColumns: handle?.tableColumns() ?? 0,
    };
    flushSync(() => setPalette(request));
  }
  function paletteAvailable(entry: PaletteEntry): boolean {
    const action = palette?.catalog.actions.get(paletteIdentity(entry));
    if (!action || !palette) return false;
    const owned = store.api.getState().owned;
    if (action.kind === "blocks" || action.kind === "snippets")
      return owned && (palette.target?.matches() ?? false) && (action.kind !== "snippets" || !!snippets.library && !!snippets.session);
    if (action.kind !== "commands") return true;
    if (editorViewCommands.has(action.command.id)) return !viewDisabled || action.command.id === "view.zen" && writing.zen;
    if (/^(format|table)\./.test(action.command.id) && !palette.target?.matches()) return false;
    if (["sheet.new", "sheet.fromTemplate", "sheet.save", "sheet.pin", "view.density", "tidy.undoBatch", "search.undoReplace", "snippet.picker"].includes(action.command.id) && !owned) return false;
    if (action.command.id === "search.undoReplace" && !store.api.getState().hasReplaceBatchUndo) return false;
    return commandAvailable(action.command, { editor: palette.editor && owned, selection: palette.selection, tableColumns: palette.tableColumns });
  }
  function afterPalette(work: () => void) {
    requestAnimationFrame(() => run(async () => { work(); }));
  }
  async function choosePalette(entry: PaletteEntry, split = false) {
    const request = palette, action = request?.catalog.actions.get(paletteIdentity(entry));
    if (!request || !action || !paletteAvailable(entry)) throw new Error("This action is unavailable. Close the palette and choose it again.");
    if (action.kind === "sheets" || action.kind === "headings") {
      if (split && editors.layout.getSnapshot().secondary === undefined) editors.layout.split();
      const sheet = await store.openSheet(action.path, action.kind === "headings" ? { source: action.source, position: action.position } : undefined);
      pendingNavigation.current = sheet.unsupportedEncoding ? undefined : { path: sheet.path, source: sheet.content, ...(action.kind === "headings" ? { position: action.position } : {}) };
      setPane("editor");
    } else if (action.kind === "tags") selectFilter(`#${action.tag}`);
    else if (action.kind === "commands") {
      afterPalette(() => {
        if (/^(format|table)\./.test(action.command.id) && !request.target?.matches()) throw new Error("The sheet changed. Choose the command again.");
        dispatchCommand(action.command.id);
      });
    } else if (action.kind === "blocks") {
      afterPalette(() => { if (!request.target?.block(action.id, action.source)) throw new Error("The sheet or block changed or is read-only. Choose the block again."); });
    } else {
      const target = request.target?.snippet(), library = snippets.library, session = snippets.session;
      if (!target || !library || !session) throw new Error("Place the cursor outside code to insert a snippet.");
      const definition = await library.resolve(action.definition);
      if (!request.target?.matches()) throw new Error("The sheet changed. Choose the snippet again.");
      const current = store.api.getState();
      const invocation = session.createSnippetInvocation(target, current.record.name, current.selectedPath);
      afterPalette(() => {
        if (!request.target?.matches() || !applySnippet(invocation, definition)) throw new Error("The sheet changed or is read-only. Choose the snippet again.");
      });
    }
  }
  function palettePreview(entry: PaletteEntry) {
    const action = palette?.catalog.actions.get(paletteIdentity(entry));
    const text = action?.kind === "sheets" || action?.kind === "headings" ? palette?.catalog.documents.get(action.path)?.raw
      : action?.kind === "snippets" ? action.definition.body : action?.kind === "blocks" ? action.source : undefined;
    return text === undefined ? <p>{entry.detail ?? "Choose this result to continue."}</p> : <pre>{text.slice(0, 3000)}{text.length > 3000 ? "\n…" : ""}</pre>;
  }

  function navigateHistory(direction: -1 | 1) {
    run(async () => {
      const sheet = await navigation.go(direction);
      if (!sheet || sheet.unsupportedEncoding) return;
      pendingNavigation.current = { path: sheet.path, source: sheet.content };
      setPane("editor"); focusCreatedSheet();
    });
  }

  function dispatchCommand(id: string) {
    const state = store.api.getState();
    if (id.startsWith("table.")) { if (state.owned) editorHandle.current?.runTable(id); return; }
    if (id.startsWith("format.")) { if (state.owned) editorHandle.current?.runFormat(id); return; }
    const actions: Record<string, () => void> = {
      "app.palette": () => { if (palette) setPalette(undefined); else openPalette("all"); },
      "app.quickOpen": () => openPalette("sheets"),
      "tidy.document": openTidy,
      "tidy.batch": () => openBatchTidy(store.api.getState().sheets.map((sheet) => sheet.path)),
      "tidy.undoBatch": () => run(store.undoTidyBatch),
      "sheet.new": requestNewSheet,
      "sheet.fromTemplate": () => {
        if (!state.owned) return;
        setTemplateRequest(captureTemplateRequest(filter && !/^[#@]/.test(filter) ? filter : notebookFor(state.selectedPath) || "Inbox"));
      },
      "sheet.search": openWorkspaceSearch,
      "search.undoReplace": () => run(store.undoReplaceBatch),
      "sheet.today": () => run(async () => { await store.openToday(); setFilter("Daily"); setPane("editor"); }),
      "sheet.pin": () => { if (state.selectedPath && state.owned) run(() => store.togglePinned(state.selectedPath)); },
      "view.sidebar": toggleNavigation,
      "view.mode": () => changeViewMode(nextWorkspaceViewMode(viewMode)),
      "view.focus": toggleWritingFocus,
      "view.typewriter": toggleTypewriter,
      "view.zen": toggleZen,
      "view.sheets": toggleSheets,
      "view.density": () => { if (state.owned) run(() => store.setDensity(state.preferences.density === "compact" ? "comfortable" : "compact")); },
      "sheet.save": () => run(store.save),
      "space.export": () => run(exportZip),
      "space.switch": () => run(onSwitchSpace),
      "navigation.back": () => navigateHistory(-1),
      "navigation.forward": () => navigateHistory(1),
      "view.inspector": () => setInspector((open) => !open),
      "view.split": toggleSplit,
      "view.newTab": () => openPalette("sheets"),
      "view.closeTab": () => { if (editors.layout.close(store.api.getState().selectedPath)) focusSelected(); },
      "view.reopenTab": () => { if (editors.layout.reopen()) focusSelected(); },
      "view.nextTab": () => { if (editors.layout.cycle(1)) focusSelected(); },
      "view.previousTab": () => { if (editors.layout.cycle(-1)) focusSelected(); },
      "app.shortcuts": () => setShortcuts(true),
      "app.editorSettings": openEditorSettings,
      "snippet.picker": openSnippetPicker,
      "block.settings": () => openBlockSettings(),
      "snippet.settings": () => openSnippetSettings(),
      "app.about": onAbout,
      "appearance.light": () => appearance.change("light"),
      "appearance.dark": () => appearance.change("dark"),
      "appearance.system": () => appearance.change("system")
    };
    actions[id]?.();
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = readKeymap(await store.space.files.read(".slate/keymap.json"), os, surface);
        if (active) setKeymap(next);
      } catch {
        if (active) setKeymap({ ...resolveCommandKeymap({ os, surface }, undefined, registry), issues: [{ commandId: "", message: "The Space keymap could not be read. Default shortcuts remain active." }] });
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [store, os, surface, registry]);

  useEffect(() => {
    try { localStorage.setItem(inspectorKey, String(inspector)); } catch { /* View preferences are optional. */ }
  }, [inspectorKey, inspector]);

  useEffect(() => {
    const record = state.record;
    let active = true;
    if (record.id !== "sample" && createIndex && editorReady) {
      const cache = createFreshIndex(createIndex(record.id));
      index.current = cache;
      let indexed = store.api.getState().sheets;
      let buildGeneration = 0;
      const invalidate = () => { cache.invalidate(); queryGeneration.current++; setMatches(undefined); };
      const rebuild = () => {
        const generation = ++buildGeneration;
        invalidate();
        return cache.rebuild(store.api.getState().sheets).then(() => {
          if (active && generation === buildGeneration) {
            setIndexWarning("");
            if (currentQuery.current) setIndexVersion((version) => version + 1);
          }
        }).catch(() => {
          if (active && generation === buildGeneration) setIndexWarning("Search cache unavailable. Searching files directly.");
        });
      };
      void rebuild();
      const unsubscribe = store.api.subscribe((next) => {
        if (next.sheets !== indexed) {
          if (next.saveState === "Saved" || next.saveState === "Read-only") { indexed = next.sheets; void rebuild(); }
          else invalidate();
        }
      });
      return () => { active = false; unsubscribe(); cache.close(); index.current = undefined; };
    }
    return undefined;
  }, [store, createIndex, state.record, editorReady]);

  useEffect(() => {
    const generation = ++queryGeneration.current;
    setMatches(undefined);
    if (query && index.current) {
      void index.current.search(query).then((paths) => { if (generation === queryGeneration.current) setMatches(paths); }).catch(() => undefined);
    }
  }, [query, state.saveState, indexVersion]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active && (runtime || window.document.visibilityState === "visible")) {
        run(store.refresh);
        if (!["Unsaved", "Saving…"].includes(store.api.getState().saveState)) {
          for (const library of Object.values(refreshLibraries.current)) if (library) run(library.refresh);
          if (refreshTidy.current) run(refreshTidy.current);
        }
      }
    };
    let observer: FolderObserver | undefined;
    const Observer = (window as ObserverWindow).FileSystemObserver;
    const handle = store.api.getState().record.handle;
    if (Observer && handle) {
      try {
        observer = new Observer(refresh);
        const subscribing = observer;
        void subscribing.observe(handle, { recursive: true }).then(() => { if (!active) subscribing.disconnect(); }).catch(() => subscribing.disconnect());
      } catch { /* The visible polling fallback remains available. */ }
    }
    let interval = runtime ? undefined : setInterval(refresh, 5000);
    let stopNative: (() => void) | undefined;
    if (runtime) {
      const failed = () => {
        if (!active) return;
        store.api.setState({ notice: "File watching is unavailable. Slate is checking for external changes periodically." });
        interval ??= setInterval(refresh, 400);
      };
      void runtime.observe(refresh, failed).then((stop) => {
        if (active) stopNative = stop; else stop();
      }).catch(failed);
    }
    const save = () => run(store.flush);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (store.api.getState().saveState === "Unsaved" || store.api.getState().saveState === "Saving…") {
        event.preventDefault();
        event.returnValue = "";
        save();
      }
    };
    window.addEventListener("focus", refresh);
    window.document.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", beforeUnload);
    if (!runtime) void navigator.storage?.estimate?.().then((estimate) => setUsage(`${((estimate.usage ?? 0) / 1024 / 1024).toFixed(1)} MB`)).catch(() => undefined);
    return () => {
      active = false;
      observer?.disconnect();
      stopNative?.();
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.document.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [store, run, runtime]);

  useEffect(() => {
    function route() {
      const match = location.hash.match(/^#\/space\/([^/]+)\/sheet\/(.+)$/);
      try {
        if (match && decodeURIComponent(match[1]!) === state.record.id) {
          const path = decodeURIComponent(match[2]!);
          if (store.api.getState().sheets.some((sheet) => sheet.path === path)) run(() => store.select(path));
        }
      } catch { store.api.setState({ notice: "This sheet link could not be read." }); }
    }
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, [store, state.record.id]);

  useEffect(() => {
    if (state.selectedPath) {
      setPane("editor");
      history.replaceState(null, "", `#/space/${encodeURIComponent(state.record.id)}/sheet/${encodeURIComponent(state.selectedPath)}`);
      try { localStorage.setItem(`slate.last-sheet.${state.record.id}`, state.selectedPath); } catch { /* View preferences are optional. */ }
    }
  }, [state.record.id, state.selectedPath]);

  useEffect(() => {
    const modalOpen = palette || workspaceSearch || shortcuts || action || editorSettings || templateRequest || notebookTemplateRequest || starterKitRequest || snippetPicker || snippetPrompt || snippetSettings || blockSettings;
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (!window.document.querySelector("dialog[open]")) {
          if (writing.zen && !modalOpen) { event.preventDefault(); exitZen(); return; }
          setPalette(undefined); setShortcuts(false); if (!actionBusy) setAction(undefined);
        }
        return;
      }
      if (palette || workspaceSearch || shortcuts || action || editorSettings || templateRequest || notebookTemplateRequest || starterKitRequest || snippetPicker || snippetPrompt || snippetSettings || blockSettings) return;
      const editor = editorHandle.current;
      const id = matchCommand(keymap.bindings.filter((binding) => binding.command.group !== "Format"), keyboardInput(event), { editor: editor?.hasFocus() ?? false, selection: editor?.hasSelection() ?? false, get tableColumns() { return editor?.tableColumns() ?? 0; } });
      if (id) { if (window.document.querySelector("dialog[open]") || editorViewCommands.has(id) && !canUseViewCommand(event, id)) return; event.preventDefault(); dispatchCommand(id); }
    };
    const priorityBindings = keymap.bindings.filter((binding) => binding.command.id.startsWith("navigation.") || priorityCommands.has(binding.command.id));
    const dispatchPriority = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const id = matchCommand(priorityBindings, keyboardInput(event), { editor: false, selection: false });
      if (id && editorViewCommands.has(id) && !canUseViewCommand(event, id)) return;
      if (!id || palette || workspaceSearch || shortcuts || action || editorSettings || templateRequest || notebookTemplateRequest || starterKitRequest || snippetPicker || snippetPrompt || snippetSettings || blockSettings || window.document.querySelector("dialog[open]")) return;
      // Workspace navigation and view commands take priority over editor keymaps.
      event.preventDefault(); event.stopPropagation(); dispatchCommand(id);
    };
    function canUseViewCommand(event: KeyboardEvent, id: string) {
      return (!viewDisabled || id === "view.zen" && writing.zen) && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]:not(.cm-content)'));
    }
    window.addEventListener("keydown", dispatchPriority, true);
    window.addEventListener("keydown", listener);
    return () => { window.removeEventListener("keydown", dispatchPriority, true); window.removeEventListener("keydown", listener); };
  });

  async function importPicked(files: FileList | File[] | BrowserImportFile[]) {
    const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
    for (const item of Array.from(files as ArrayLike<File | BrowserImportFile>)) {
      const file = "file" in item ? item.file : item;
      if (/\.zip$/i.test(file.name)) {
        const { readBrowserArchive } = await import("@slate/storage/browser-archive");
        for (const [path, bytes] of Object.entries(await readBrowserArchive(new Uint8Array(await file.arrayBuffer())))) addBrowserImportEntry(entries, path, bytes);
      } else {
        const path = safeBrowserPath("file" in item ? item.path : file.webkitRelativePath || file.name);
        addBrowserImportEntry(entries, path, new Uint8Array(await file.arrayBuffer()));
      }
    }
    await store.importFiles(entries);
    store.api.setState({ notice: "Imported your files. Existing files were kept." });
  }

  async function exportZip() {
    await store.flush();
    const { exportBrowserArchive } = await import("@slate/storage/browser-archive");
    const bytes = await exportBrowserArchive(store.space.files);
    download(`${state.record.name}.zip`, new Blob([new Uint8Array(bytes)], { type: "application/zip" }));
  }

  async function downloadOriginal(path: string) {
    const bytes = await store.space.files.read(path);
    if (bytes === undefined) throw new Error("File no longer exists. Refresh your Space.");
    download(path.split("/").pop()!, new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
  }

  async function performAction() {
    const path = state.selectedPath;
    if (action === "trash" || action === "move") {
      const paths = actionPaths.length ? actionPaths : [path];
      for (const source of paths) {
        if (action === "trash") await store.trash(source);
        else await store.move(source, safeBrowserPath(`${actionValue}/${source.split("/").pop()!}`));
        setActionPaths((current) => current.filter((entry) => entry !== source));
      }
    }
    else if (action === "rename") {
      const filename = actionValue.replace(/\.md$/i, "").trim();
      if (!filename || /[/\\]/.test(filename)) throw new Error("Choose a filename without slashes.");
      await store.move(path, `${notebookFor(path) ? `${notebookFor(path)}/` : ""}${filename}.md`);
    } else if (action === "notebook") {
      const name = safeBrowserPath(actionValue.trim());
      setExtraNotebooks((current) => [...current, name]);
      setFilter(name);
      await store.create(name);
    }
    setAction(undefined);
  }

  function inspectorEditor() {
    const current = store.api.getState(), handle = editorHandle.current;
    return current.selectedPath === state.selectedPath && handle?.documentKey() === `${current.record.id}/${current.selectedPath}` ? handle : undefined;
  }
  function captureInspectorMove(source: string) {
    const handle = inspectorEditor(), path = state.selectedPath, target = handle?.sectionTarget(source);
    return target ? { move(index: number, before: number) {
      return store.api.getState().selectedPath === path && editorHandle.current === handle && target.move(index, before);
    } } : undefined;
  }
  const pinned = state.preferences.pinned.includes(state.selectedPath);

  return <main className="browserWorkspace" data-editor-ready={editorReady} data-zen={writing.zen} data-zen-hud={writing.hud ? "visible" : "idle"} data-writing-focus={writing.focus}
    onPointerMove={writingModes.activity} onFocusCapture={writingModes.activity} onKeyDownCapture={writingModes.activity}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => { if (event.dataTransfer.files.length || event.dataTransfer.items.length) {
      event.preventDefault();
      const dropped = collectBrowserDrop(event.dataTransfer);
      run(async () => importPicked(await dropped));
    } }}>
    {workspaceSearch && <Suspense fallback={<WorkspaceDialog title="Search everywhere" returnFocus={workspaceSearch.returnFocus} restoreFocus={workspaceSearch.restoreFocus} onClose={() => setWorkspaceSearch(undefined)}><p role="status">Opening search…</p></WorkspaceDialog>}><WorkspaceSearchDialog store={store} returnFocus={workspaceSearch.returnFocus} restoreFocus={workspaceSearch.restoreFocus} initialQuery={workspaceSearch.query} onChoose={chooseSearchResult} onClose={() => setWorkspaceSearch(undefined)} /></Suspense>}
    <WorkspaceTitleBar viewMode={viewMode} viewDisabled={viewDisabled} onViewMode={changeViewMode} windowControls={false} space={state.record.name} path={selected?.path ?? ""} inspector={inspector} canWrite={state.owned} shortcut={shortcut}
      writingControls={<WorkspaceWritingControls value={writing} disabled={viewDisabled} onFocus={writingModes.focus} onTypewriter={toggleTypewriter} onZen={toggleZen} />}
      onSwitchSpace={() => run(onSwitchSpace)} onNotebook={selectFilter} onNavigation={toggleNavigation} onSheets={toggleSheets} onSearch={openWorkspaceSearch} onNew={() => dispatchCommand("sheet.new")} onExport={() => dispatchCommand("space.export")} onInspector={() => dispatchCommand("view.inspector")}
      controls={<><button title={`Editor settings (${shortcut("app.editorSettings")})`} aria-label="Editor settings" onClick={(event) => { event.currentTarget.focus(); openEditorSettings(); }}><Settings size={16} /></button><AppearanceControl preference={appearance.preference} onChange={appearance.change} />{onInstall && <button title="Install Slate" aria-label="Install Slate" onClick={onInstall}><Download size={16} /></button>}<button title={`Keyboard shortcuts (${shortcut("app.shortcuts")})`} aria-label="Keyboard shortcuts" onClick={(event) => { event.currentTarget.focus(); setShortcuts(true); }}><Keyboard size={16} /></button><button ref={aboutButton} title="About Slate" aria-label="About Slate" onClick={(event) => { event.currentTarget.focus(); onAbout(); }}><Info size={16} /></button></>}
      menuControls={<AppearanceControl preference={appearance.preference} onChange={appearance.change} />}
      actions={[
        { label: "Command palette", run: () => dispatchCommand("app.palette") },
        { label: "Quick open", run: () => dispatchCommand("app.quickOpen") },
        { label: "Search everywhere", run: () => dispatchCommand("sheet.search") },
        { label: "Undo replacements", disabled: !state.owned || !state.hasReplaceBatchUndo, run: () => dispatchCommand("search.undoReplace") },
        { label: "Go back", disabled: navigationState.busy || !navigationState.canBack, run: () => dispatchCommand("navigation.back") },
        { label: "Go forward", disabled: navigationState.busy || !navigationState.canForward, run: () => dispatchCommand("navigation.forward") },
        { label: "New from template", disabled: !state.owned, run: () => dispatchCommand("sheet.fromTemplate") },
        { label: "Starter kits", disabled: !state.owned, run: () => setStarterKitRequest(captureTemplateRequest("Inbox")) },
        { label: "Insert snippet", disabled: !state.owned || !selected || selected.unsupportedEncoding || !snippets.library, run: openSnippetPicker },
        { label: "Manage custom blocks", disabled: !blocks.library, run: () => openBlockSettings() },
        { label: "Manage snippets", disabled: !snippets.library, run: () => openSnippetSettings() },
        { label: "Batch Tidy", run: () => dispatchCommand("tidy.batch") },
        { label: "Undo batch Tidy", disabled: !state.owned || !state.hasTidyBatchUndo, run: () => dispatchCommand("tidy.undoBatch") },
        { label: "Notebook default template", disabled: !state.owned, run: () => openNotebookTemplate(filter && !/^[#@]/.test(filter) ? filter : "Inbox") },
        { label: pinned ? "Unpin sheet" : "Pin sheet", disabled: !selected || !state.owned, run: () => dispatchCommand("sheet.pin") },
        { label: "Rename sheet", disabled: !selected || selected.unsupportedEncoding || !state.owned, run: () => { setAction("rename"); setActionValue(selected?.path.split("/").pop()?.replace(/\.md$/i, "") ?? ""); } },
        { label: "Move sheet", disabled: !selected || selected.unsupportedEncoding || !state.owned, run: () => { setActionPaths([state.selectedPath]); setAction("move"); setActionValue(notebookFor(state.selectedPath)); } },
        { label: "Delete sheet", disabled: !selected || selected.unsupportedEncoding || !state.owned, run: () => { setActionPaths([state.selectedPath]); setAction("trash"); } },
        { label: "Import files", disabled: !state.owned, run: () => input.current?.click() },
        { label: "Import folder", disabled: !state.owned, run: () => folderInput.current?.click() },
        { label: "Export .zip", run: () => dispatchCommand("space.export") },
        { label: "Keyboard shortcuts", run: () => dispatchCommand("app.shortcuts") },
        { label: "Editor settings", run: () => dispatchCommand("app.editorSettings") },
        { label: "About Slate", run: () => dispatchCommand("app.about") }
      ]} />
    {!!keymap.issues.length && <div className="notice" role="status">Default shortcuts are active. .slate/keymap.json: {keymap.issues.map((issue) => `${issue.commandId ? `${issue.commandId}: ` : ""}${issue.message}`).join(" ")}</div>}
    {state.record.id === "sample" && <div className="notice">Sample — nothing is saved <button onClick={() => run(onKeepSample)}>Keep these sheets</button></div>}
    {!state.owned && <div className="notice" role="status">Slate is open in another tab <button onClick={() => run(onTakeover)}>Use here</button></div>}
    {state.error && <div className="errorNotice" role="alert">{state.error}<button onClick={() => run(store.flush)}>Retry saving</button></div>}
    {state.notice && <div className="notice" role="status">{state.notice}<button aria-label="Dismiss notice" onClick={() => store.api.setState({ notice: "" })}>×</button></div>}
    <div className={`browserPanes ${tidy.open ? "withTidy" : ""} ${inspector ? "withInspector" : ""} ${sidebarVisible ? "" : "withoutSidebar"} ${sheetsVisible ? "" : "withoutSheets"}`} data-pane={pane}>
      <aside className="browserSidebar" aria-label="Workspace navigation">
        <div className="spaceHeading"><button className="spaceSwitcher" title="Switch Space" onClick={() => run(onSwitchSpace)}><span className="spaceAvatar"><BrandMark size={17} /></span><strong>{state.record.name}</strong><ChevronDown size={13} /></button><button title={`Search everywhere (${shortcut("sheet.search")})`} aria-label="Search workspace" onClick={openWorkspaceSearch}><Search size={16} /></button></div>
        <button className={!filter ? "navItem selected" : "navItem"} onClick={() => selectFilter("")}><BookOpen size={16} />All sheets<span>{state.sheets.length}</span></button>
        <button className={filter === "Inbox" ? "navItem selected" : "navItem"} onClick={() => selectFilter("Inbox")}><Inbox size={16} />Inbox<span>{inboxCount}</span></button>
        <button className={filter === "Daily" ? "navItem selected" : "navItem"} title={`Today (${shortcut("sheet.today")})`} onClick={() => dispatchCommand("sheet.today")} disabled={!state.owned}><CalendarDays size={16} />Today</button>
        <button className={filter === "@pinned" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@pinned")}><Pin size={16} />Pinned<span>{pinnedCount}</span></button>
        <div className="sectionTitle">Notebooks<button title="New notebook" aria-label="New notebook" disabled={!state.owned} onClick={(event) => { event.currentTarget.focus(); setAction("notebook"); setActionValue(""); }}><Plus size={14} /></button></div>
        <NotebookTree onTemplate={state.owned ? openNotebookTemplate : undefined} paths={notebooks} sheetPaths={sheetPaths} selected={filter} collapsed={collapsed} onSelect={selectFilter} onToggle={(path) => { if (state.owned) run(async () => { await store.toggleNotebook(path); setCollapsed(new Set(store.api.getState().preferences.collapsedNotebooks)); }); else setCollapsed((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }); }} onMove={(path, notebook) => run(() => store.move(path, `${notebook}/${path.split("/").pop()!}`))} />
        <div className="sectionTitle">Smart filters</div>
        <button className={filter === "@drafts" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@drafts")}><FileText size={16} />Drafts in progress</button>
        <button className={filter === "@goals" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@goals")}><Gauge size={16} />Goal in progress</button>
        <button className={filter === "@recent" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@recent")}><Filter size={16} />Edited recently</button>
        <div className="sectionTitle">Tags</div>
        {tags.length ? tags.map((tag) => <button key={tag} className={filter === `#${tag}` ? "navItem selected" : "navItem"} onClick={() => selectFilter(`#${tag}`)}><Hash size={15} /><span className="navLabel">{tag}</span><small>{tagSummary.counts.get(tag) ?? 0}</small></button>) : <p className="quiet">Add #tags in your writing.</p>}
        <div className="storageFooter"><HardDrive size={14} /><span>{runtime ? "On this device" : state.record.id === "sample" ? "Sample" : state.record.tier === "folder" ? `Folder: ${state.record.name}` : `Browser library · ${usage}`}<small>{indexWarning}</small></span></div>
      </aside>
      <aside className="browserSheetList" aria-label="Sheets">
        <div className="listHeading"><strong>{listTitle}</strong><small>{visible.length}</small><label className="densityControl"><span className="visuallyHidden">Sheet density</span><select aria-label="Sheet density" value={state.preferences.density} disabled={!state.owned} onChange={(event) => run(() => store.setDensity(event.target.value as "comfortable" | "compact"))}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button title={`New sheet (${shortcut("sheet.new")})`} aria-label="New Sheet" disabled={!state.owned} onClick={() => dispatchCommand("sheet.new")}><Plus size={17} /></button></div>
        <label className="browserSearch"><Search size={15} /><input aria-label="Search sheets" placeholder={filter ? `Filter ${listTitle}…` : "Search sheets…"} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <SheetList sheets={visible} selectedPath={state.selectedPath} preferences={state.preferences} owned={state.owned} pending={summariesPending} readOnlyPaths={readOnlyPaths} onOpen={(path) => run(async () => { await store.select(path); setPane("editor"); })} onBulk={(kind, paths) => { setActionPaths(paths); setAction(kind); setActionValue(notebookFor(paths[0] ?? "")); }} onTidy={openBatchTidy} />
        {!visible.length && <div className="browserEmpty"><strong>{query ? "No sheets match" : "A little room to think"}</strong><p>{query ? "Try another search." : "Create your first sheet or import your notes."}</p></div>}
        <div className="listFoot">{visible.length} sheets</div>
      </aside>
      <section className="browserEditor" aria-label="Editor">
        <EditorTabs layout={editorLayout} dirty={store.hasDraft} label={(path) => paletteCatalog.documents.get(path)?.title ?? path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path} onNew={() => openPalette("sheets")} onSplit={toggleSplit}
          onOpen={(path, focusEditor) => { if (editors.layout.open(path)) { if (focusEditor) focusSelected(); else { pendingNavigation.current = undefined; setPane("editor"); } } }} onClose={(path) => { if (editors.layout.close(path)) focusSelected(); }} />
        <div className="workspaceEditorGrid" id="workspace-editor-panel" role="tabpanel" aria-label="Open sheet editor" data-split={editorLayout.secondary !== undefined}>
          {(["primary", "secondary"] as const).map((id) => {
            const path = editorLayout[id]; if (path === undefined) return null;
            const sheet = paneSheets[id], summary = paletteCatalog.documents.get(path), active = editorLayout.active === id;
            const documentKey = `${state.record.id}/${path}`;
            return <section key={id} className="workspaceEditorPane" aria-label={id === "primary" ? "Primary editor" : "Secondary editor"} data-active={active}
              onPointerDownCapture={() => activatePane(id)} onFocusCapture={() => activatePane(id)}>
              <div className="documentToolbar"><h1>{summary?.title || "Your next idea starts here"}</h1></div>
              {sheet?.unsupportedEncoding ? <div className="browserEmpty editorEmpty"><h1>This file needs UTF-8.</h1><p>Slate kept the original bytes. Download the file to convert a copy to UTF-8, then import that copy to edit.</p><button className="primaryButton" onClick={() => run(() => downloadOriginal(path))}>Download original</button></div>
                : sheet ? <Suspense fallback={<p role="status">Opening editor…</p>}><Editor key={documentKey} pool={editors.pool} store={store} path={path} title={summary?.title ?? "Untitled"}
                  documentKey={documentKey} viewKey={id === "primary" ? documentKey : documentKey + "/split"} onDocumentError={documentError}
                  sourceMode={active && tidy.open || viewModes.mode(path) === "source"} tidyLines={active ? tidyLines : []} initialCursor={active && state.initialCursor?.path === path ? state.initialCursor.position : undefined}
                  writingFocus={active ? writing.focus : "none"} typewriter={active && writing.typewriter} zen={writing.zen}
                  smartTables={editorPreferences.preferences.smartTables} fences={editorPreferences.preferences.fences} frontmatter={editorPreferences.preferences.frontmatter}
                  smartLists={editorPreferences.preferences.smartLists} selectionPairs={editorPreferences.preferences.selectionPairs} readOnly={!state.owned || viewModes.mode(path) === "read"}
                  onCursorChange={id === "primary" ? cursorPrimary : cursorSecondary} keymap={keymap} completionSheets={completionSheets} completionTags={tags}
                  wikiCompletion={editorPreferences.preferences.wikiCompletion} tagCompletion={editorPreferences.preferences.tagCompletion} dateCompletion={editorPreferences.preferences.dateCompletion}
                  templateMenuLibrary={templates.library} snippetMenuLibrary={snippets.library} canInsertBlock={canInsertBlock} customBlockLibrary={blocks.library}
                  onManageBlocks={openBlockSettings} snippetIndex={snippets.snapshot?.index} onSnippet={expandSnippet} onHandle={id === "primary" ? receivePrimary : receiveSecondary}
                  onReady={editorBecameReady} pasteRichText={editorPreferences.preferences.pasteRichText} pasteLinks={editorPreferences.preferences.pasteLinks}
                  pasteImages={editorPreferences.preferences.pasteImages} pasteTables={editorPreferences.preferences.pasteTables} onNavigateWikiLink={navigateWiki} /></Suspense>
                : <div className="browserEmpty editorEmpty"><h1>A fresh page awaits.</h1><p>Your words, in plain Markdown. Always yours.</p><button className="primaryButton" disabled={!state.owned} onClick={() => dispatchCommand("sheet.new")}>New Sheet</button></div>}
            </section>;
          })}
        </div>
      </section>
      {tidy.open && <Suspense fallback={<aside className="tidyPanel" aria-label="Tidy review"><p role="status">Opening Tidy…</p></aside>}><TidyPanel review={tidy} readOnly={!state.owned || viewModes.mode(state.selectedPath) === "read"} onClose={closeTidy} onJump={(line) => { setPane("editor"); editorHandle.current?.goToLine(line); }} /></Suspense>}
      {inspector && <Suspense fallback={<aside className="browserInspector" aria-label="Inspector"><p role="status">Opening Inspector…</p></aside>}>
        <Inspector key={`${state.record.id}/${state.selectedPath}`} document={selected?.unsupportedEncoding ? undefined : document} documents={documents} store={store} pool={editors.pool} sheets={state.sheets}
          {...(runtime?.fileActions ? { fileActions: runtime.fileActions } : {})}
          path={state.selectedPath} cursor={cursor} readOnly={!state.owned || !!selected?.unsupportedEncoding || viewModes.mode(state.selectedPath) === "read"} closeShortcut={shortcut("view.inspector")}
          onClose={() => setInspector(false)} onJump={(source, offset) => { const handle = inspectorEditor(); if (!handle?.goToSourceOffset(source, offset)) return false; setPane("editor"); return true; }}
          onOpen={(path) => { setPane("editor"); run(() => store.select(path)); }} captureMove={captureInspectorMove} />
      </Suspense>}
    </div>
    <input ref={input} type="file" aria-label="Import files" multiple accept=".md,.zip" className="visuallyHidden" onChange={(event) => { const files = event.currentTarget.files; if (files) run(() => importPicked(files)); event.currentTarget.value = ""; }} />
    <input ref={folderInput} type="file" aria-label="Import folder" multiple className="visuallyHidden" {...{ webkitdirectory: "" }} onChange={(event) => { const files = event.currentTarget.files; if (files) run(() => importPicked(files)); event.currentTarget.value = ""; }} />
    <WorkspaceStatusBar tidy={{ count: tidy.report?.issues.length, pending: tidy.pending, error: !!tidy.error, open: tidy.open, available: !!selected && !selected.unsupportedEncoding, onOpen: openTidy }} saveState={state.saveState} path={selected?.path ?? ""} content={selected?.content ?? ""} unsupported={!!selected?.unsupportedEncoding} stats={selected?.unsupportedEncoding ? undefined : document?.stats} goal={document?.goal} cursor={cursor} onSave={() => run(store.save)} onGoal={() => setInspector(true)} onJump={(line) => { setPane("editor"); editorHandle.current?.goToLine(line); }} />
    {writing.zen && <WorkspaceZenHud title={document?.title || selected?.path.split("/").at(-1)?.replace(/\.md$/i, "") || "Writing session"}
      goal={document?.goal} writable={state.owned && !!selected && !selected.unsupportedEncoding} writing={writing} focusShortcut={shortcut("view.focus")}
      onGoal={() => { writingModes.zen(false); setInspector(true); }} onExit={exitZen} onFocus={toggleWritingFocus} />}
    {!runtime && <LaunchActions key={state.record.id} store={store} pool={editors.pool} onSearch={openSearchWithQuery} onTemplate={openLinkedTemplate} templatesReady={!!templates.library} onSwitchSpace={onSwitchSpace} onTakeover={onTakeover} onDialogChange={setLaunchDialogOpen} onNavigate={() => focusSelected()} />}
    {tidyBatch && <Suspense fallback={<WorkspaceDialog title="Batch Tidy" returnFocus={tidyBatch.returnFocus} onClose={() => setTidyBatch(undefined)}><p role="status">Opening batch review…</p></WorkspaceDialog>}><BatchTidyDialog store={store} paths={tidyBatch.paths} returnFocus={tidyBatch.returnFocus} onClose={() => setTidyBatch(undefined)} /></Suspense>}
    {editorSettings && <EditorSettingsDialog preferences={editorPreferences.preferences} onChange={editorPreferences.change} onClose={() => setEditorSettings(false)} onBlocks={blocks.library ? () => { setEditorSettings(false); openBlockSettings(editorSettingsInvoker.current); } : undefined} onSnippets={snippets.library ? () => { setEditorSettings(false); openSnippetSettings(); } : undefined} />}
    {snippetPicker && snippets.library && <Suspense fallback={<WorkspaceDialog title="Insert snippet" returnFocus={snippetPicker.target.element} onClose={() => setSnippetPicker(undefined)}><p role="status">Opening snippets…</p></WorkspaceDialog>}><SnippetPicker library={snippets.library} invocation={snippetPicker} spaceName={state.record.name} onClose={() => setSnippetPicker(undefined)} onChoose={(definition) => { applySnippet(snippetPicker, definition); setSnippetPicker(undefined); }} onManage={() => { openSnippetSettings(snippetPicker.target.element); setSnippetPicker(undefined); }} /></Suspense>}
    {snippetPrompt && <Suspense fallback={<WorkspaceDialog title="Insert snippet" returnFocus={snippetPrompt.target.element} onClose={() => setSnippetPrompt(undefined)}><p role="status">Opening snippet fields…</p></WorkspaceDialog>}><SnippetPrompt request={snippetPrompt} onClose={() => setSnippetPrompt(undefined)} /></Suspense>}
    {blockSettings && blocks.library && <Suspense fallback={<WorkspaceDialog title="Custom blocks" returnFocus={blockSettings.returnFocus} onClose={() => setBlockSettings(undefined)}><p role="status">Opening custom blocks…</p></WorkspaceDialog>}><BlockSettings library={blocks.library} store={store} returnFocus={blockSettings.returnFocus} onTakeover={onTakeover} onClose={() => setBlockSettings(undefined)} /></Suspense>}
    {snippetSettings && snippets.library && <Suspense fallback={<WorkspaceDialog title="Snippets" returnFocus={snippetSettings.returnFocus} onClose={() => setSnippetSettings(undefined)}><p role="status">Opening snippets…</p></WorkspaceDialog>}><SnippetSettings library={snippets.library} store={store} returnFocus={snippetSettings.returnFocus} onTakeover={onTakeover} onClose={() => setSnippetSettings(undefined)} /></Suspense>}
    {shortcuts && <CommandDialog surface={surface} registry={registry} kind="shortcuts" keymap={keymap} os={os} editor={!!selected && !selected.unsupportedEncoding && state.owned} selection={editorHandle.current?.hasSelection() ?? false} tableColumns={editorHandle.current?.tableColumns() ?? 0} onClose={() => setShortcuts(false)} onCommand={dispatchCommand} />}
    {palette && <PaletteDialog entries={palette.catalog.entries} index={palette.catalog.index} initialMode={palette.mode} returnFocus={palette.returnFocus} os={os} allowSplit={!!selected && !selected.unsupportedEncoding}
      shortcut={(entry) => entry.kind === "commands" ? shortcut(entry.id) : ""} available={paletteAvailable} visible={(entry) => entry.kind !== "commands" || paletteAvailable(entry)} preview={palettePreview} onChoose={choosePalette} onClose={() => setPalette(undefined)} />}
    {templateRequest && <Suspense fallback={<WorkspaceDialog title="New from template" returnFocus={templateRequest.returnFocus} onClose={() => { setTemplateRequest(undefined); if (templates.library) run(templates.library.refresh); }}><p role="status">Opening templates…</p></WorkspaceDialog>}><TemplateGallery store={store} notebook={templateRequest.notebook} selection={templateRequest.selection} returnFocus={templateRequest.returnFocus} initialTemplateId={templateRequest.initialTemplateId} initialDestination={templateRequest.initialDestination} initialTitle={templateRequest.initialTitle} initialBodyText={templateRequest.initialBodyText} onClose={() => { setTemplateRequest(undefined); if (templates.library) run(templates.library.refresh); }} onStarterKits={() => { setStarterKitRequest({ returnFocus: templateRequest.returnFocus }); setTemplateRequest(undefined); }} /></Suspense>}
    {starterKitRequest && <Suspense fallback={<WorkspaceDialog title="Starter kits" returnFocus={starterKitRequest.returnFocus} onClose={() => setStarterKitRequest(undefined)}><p role="status">Opening starter kits…</p></WorkspaceDialog>}><StarterKitDialog store={store} returnFocus={starterKitRequest.returnFocus} onTakeover={onTakeover} onClose={(root) => { setStarterKitRequest(undefined); if (root) { setFilter(root); setPane("editor"); } }} /></Suspense>}
    {notebookTemplateRequest && <Suspense fallback={<WorkspaceDialog title="Notebook default template" returnFocus={notebookTemplateRequest.returnFocus} onClose={() => setNotebookTemplateRequest(undefined)}><p role="status">Opening notebook preferences…</p></WorkspaceDialog>}><NotebookTemplateDialog store={store} notebook={notebookTemplateRequest.notebook} returnFocus={notebookTemplateRequest.returnFocus} onClose={() => setNotebookTemplateRequest(undefined)} /></Suspense>}
    {action && <WorkspaceDialog title={action === "trash" ? "Move this sheet to trash?" : action === "notebook" ? "New notebook" : action === "rename" ? "Rename sheet" : "Move sheet"} busy={actionBusy} onClose={() => setAction(undefined)}><form onSubmit={(event) => { event.preventDefault(); store.api.setState({ error: "" }); setActionBusy(true); run(async () => { try { await performAction(); } finally { setActionBusy(false); } }); }}>
      {actionPaths.length > 1 && (action === "move" || action === "trash") && <p>{actionPaths.length} selected sheets</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {action === "trash" ? <p>A copy stays in .slate/trash and is included in your Space export.</p> : <label>{action === "rename" ? "File name" : "Notebook path"}<input autoFocus value={actionValue} disabled={actionBusy} onChange={(event) => setActionValue(event.target.value)} required /></label>}
      <div className="dialogActions"><button type="button" disabled={actionBusy} onClick={() => setAction(undefined)}>Cancel</button><button type="submit" className="primaryButton" disabled={actionBusy}>{actionBusy ? "Saving…" : action === "trash" ? "Move to trash" : "Save"}</button></div>
    </form></WorkspaceDialog>}
  </main>;
}

function notebookFor(path: string): string { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; }
function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
