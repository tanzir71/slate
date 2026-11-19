import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { CalendarDays, ChevronDown, Hash, Inbox, Plus, Search, Download, BookOpen, Info, Pin, HardDrive, Keyboard, Filter, Gauge, FileText, X, Settings } from "lucide-react";
import { matchCommand, resolveCommandKeymap, type WikiCompletionTarget, type ScopedSnippet } from "@slate/core";
import { useTemplateLibrary } from "../blocks/useTemplateLibrary";
import { useBlockLibrary } from "../blocks/useBlockLibrary";
import { useSnippetLibrary } from "../snippets/useSnippetLibrary";
import type { SnippetTarget } from "../snippets/snippetTypes";
import type { SnippetInvocation, PreparedSnippet } from "../snippets/snippetSession";
import { safeBrowserPath, type BrowserDirectoryHandle } from "@slate/storage/browser-files";
import { addBrowserImportEntry, collectBrowserDrop, type BrowserImportFile } from "@slate/storage/browser-import";
import type { WorkspaceStore } from "./workspaceStore";
import type { BrowserAppProps } from "./BrowserApp";
import { LaunchActions } from "./LaunchActions";
import { AppearanceControl, type useAppearance } from "../appearance";
import { BrandMark } from "../BrandMark";
import { commandShortcut, createCursorStore, keyboardInput, readKeymap, shortcutOS, type MarkdownEditorHandle } from "../commands";
import { CommandDialog } from "./CommandDialog";
import { WorkspaceTitleBar } from "./WorkspaceTitleBar";
import { WorkspaceStatusBar } from "./WorkspaceStatusBar";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { NotebookTree } from "./NotebookTree";
import { SheetList } from "./SheetList";
import { matchesWorkspaceFilter } from "./workspaceFilter";
import { useSheetSummaries } from "./useSheetSummaries";
import { inspectorContents } from "./inspectorContents";
import { sheetStructureReady } from "./sheetStructureReady";
import { importBlockImage } from "./importBlockImage";
import { importClipboardImage } from "./importClipboardImage";
import { EditorSettingsDialog } from "../EditorSettingsDialog";
import { useEditorPreferences } from "../editorPreferences";
import { useTidyReview } from "../tidy/useTidyReview";

const Editor = lazy(() => import("../MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));
const TemplateGallery = lazy(() => import("../templates/TemplateGallery"));
const NotebookTemplateDialog = lazy(() => import("../templates/NotebookTemplateDialog"));
const StarterKitDialog = lazy(() => import("../templates/StarterKitDialog"));
const SnippetPicker = lazy(() => import("../snippets/SnippetPicker"));
const SnippetPrompt = lazy(() => import("../snippets/SnippetPrompt"));
const BlockSettings = lazy(() => import("../blocks/BlockSettings"));
const SnippetSettings = lazy(() => import("../snippets/SnippetSettings"));
const TidyPanel = lazy(() => import("../tidy/TidyPanel"));
interface TemplateRequest {
  notebook: string; selection: string; returnFocus: HTMLElement | undefined;
  initialTemplateId?: string; initialDestination?: string;
}
interface FolderObserver {
  observe(handle: BrowserDirectoryHandle, options: { recursive: boolean }): Promise<void>;
  disconnect(): void;
}
interface ObserverWindow extends Window { FileSystemObserver?: new(callback: () => void) => FolderObserver }
interface WorkspaceProps {
  appearance: ReturnType<typeof useAppearance>;
  store: WorkspaceStore;
  createIndex: BrowserAppProps["createIndex"];
  onKeepSample: () => Promise<void>;
  onTakeover: () => Promise<void>;
  onSwitchSpace: () => Promise<void>;
  onAbout: () => void;
  onInstall: (() => void) | undefined;
}

export default function BrowserWorkspace({ store, createIndex, onKeepSample, onTakeover, onSwitchSpace, onAbout, onInstall, appearance }: WorkspaceProps) {
  const state = useStore(store.api);
  const snippets = useSnippetLibrary(store);
  const blocks = useBlockLibrary(store);
  const templates = useTemplateLibrary(store);
  const refreshLibraries = useRef({ templates: templates.library, blocks: blocks.library, snippets: snippets.library });
  const refreshTidy = useRef<(() => Promise<void>) | undefined>(undefined);
  useLayoutEffect(() => {
    refreshLibraries.current = { templates: templates.library, blocks: blocks.library, snippets: snippets.library };
  }, [templates.library, blocks.library, snippets.library]);
  const [blockSettings, setBlockSettings] = useState<{ returnFocus: HTMLElement | undefined }>();
  const [snippetPicker, setSnippetPicker] = useState<SnippetInvocation>();
  const [snippetPrompt, setSnippetPrompt] = useState<PreparedSnippet>();
  const [snippetSettings, setSnippetSettings] = useState<{ returnFocus: HTMLElement | undefined }>();
  const copyBlockImage = useCallback((file: File) => importBlockImage(store.space, file, state.selectedPath), [store, state.selectedPath]);
  const copyClipboardImage = useCallback((file: File) => importClipboardImage(store.space, file, state.selectedPath), [store, state.selectedPath]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const inspectorKey = `slate.inspector.${state.record.id}`;
  const [inspector, setInspector] = useState(() => {
    try { return localStorage.getItem(inspectorKey) === "true"; } catch { return false; }
  });
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [editorSettings, setEditorSettings] = useState(false);
  const [templateRequest, setTemplateRequest] = useState<TemplateRequest>();
  const [notebookTemplateRequest, setNotebookTemplateRequest] = useState<{ notebook: string; returnFocus: HTMLElement | undefined }>();
  const [starterKitRequest, setStarterKitRequest] = useState<{ returnFocus: HTMLElement | undefined }>();
  const editorPreferences = useEditorPreferences();
  const [pane, setPane] = useState<"navigation" | "sheets" | "editor">(() => state.selectedPath ? "editor" : "sheets");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sheetsVisible, setSheetsVisible] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Set(state.preferences.collapsedNotebooks));
  const [actionBusy, setActionBusy] = useState(false);
  const [actionPaths, setActionPaths] = useState<string[]>([]);
  const cursor = useMemo(createCursorStore, []);
  const os = shortcutOS();
  const [keymap, setKeymap] = useState(() => resolveCommandKeymap({ os, surface: "web" }));
  const [action, setAction] = useState<"rename" | "move" | "trash" | "notebook" | undefined>();
  const [actionValue, setActionValue] = useState("");
  const [extraNotebooks, setExtraNotebooks] = useState<string[]>([]);
  const [usage, setUsage] = useState("");
  const [matches, setMatches] = useState<string[] | undefined>();
  const [indexWarning, setIndexWarning] = useState("");
  const [editorReady, setEditorReady] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const editorSettingsInvoker = useRef<HTMLElement | undefined>(undefined);
  const aboutButton = useRef<HTMLButtonElement>(null);
  const index = useRef<ReturnType<NonNullable<BrowserAppProps["createIndex"]>> | undefined>(undefined);
  const queryGeneration = useRef(0);
  const editorHandle = useRef<MarkdownEditorHandle | undefined>(undefined);
  const selected = state.sheets.find((sheet) => sheet.path === state.selectedPath);
  const tidy = useTidyReview({
    space: store.space,
    source: editorReady && selected && !selected.unsupportedEncoding ? selected.content : undefined,
    path: selected && !selected.unsupportedEncoding ? selected.path : undefined,
    canWrite: () => store.api.getState().owned,
    apply(result) {
      const current = store.api.getState();
      const sheet = current.sheets.find((item) => item.path === current.selectedPath);
      if (!current.owned || current.selectedPath !== selected?.path || sheet?.content !== result.source || editorHandle.current?.source() !== result.source) return false;
      return editorHandle.current.applyTidy(result);
    },
  });
  const tidyLines = useMemo(() => tidy.report ? [...new Set(tidy.report.issues.map((issue) => issue.line))] : [], [tidy.report]);
  const tidyLayout = useRef({ sheets: true, inspector: false });
  useLayoutEffect(() => { refreshTidy.current = tidy.refresh; }, [tidy.refresh]);
  function openTidy() {
    if (!selected || selected.unsupportedEncoding) return;
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
  const documents = useSheetSummaries(state.sheets);
  const summariesPending = !sheetStructureReady(state.sheets, documents);
  const document = documents.find((sheet) => sheet.path === state.selectedPath);
  const blockNote = useMemo(() => ({ space: state.record.name, path: state.selectedPath, title: document?.title ?? "Untitled" }), [state.record.name, state.selectedPath, document?.title]);
  const canInsertBlock = useCallback(() => store.api.getState().owned, [store]);
  const completionIdentities = useMemo(() => JSON.stringify(documents.map(({ id, path, title }) => ({ id, path, title }))), [documents]);
  const completionSheets = useMemo(() => JSON.parse(completionIdentities) as WikiCompletionTarget[], [completionIdentities]);
  const notebooks = [...new Set([...state.sheets.map((sheet) => notebookFor(sheet.path)).filter(Boolean), ...extraNotebooks])].sort();
  const tagIdentities = useMemo(() => JSON.stringify([...new Set(documents.flatMap((sheet) => sheet.tags.map((tag) => tag.path)))].sort()), [documents]);
  const tags = useMemo(() => JSON.parse(tagIdentities) as string[], [tagIdentities]);
  const visible = documents.filter((sheet) => {
    const inNotebook = matchesWorkspaceFilter(sheet, filter, state.preferences.pinned);
    const textMatch = !query || (matches ? matches.includes(sheet.path) : `${sheet.title} ${sheet.raw}`.toLowerCase().includes(query.toLowerCase()));
    return inNotebook && textMatch;
  });
  const pinnedCount = documents.filter((sheet) => state.preferences.pinned.includes(sheet.path)).length;
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
  function focusSearch() { setPane("sheets"); setSheetsVisible(true); requestAnimationFrame(() => search.current?.focus()); }

  const run = useCallback((work: () => Promise<unknown>) => {
    void work().catch((error: unknown) => store.api.setState({ error: error instanceof Error ? error.message : "The operation failed. Your files were kept." }));
  }, [store]);
  const receiveEditor = useCallback((handle: MarkdownEditorHandle | undefined) => { editorHandle.current = handle; }, []);
  const focusCreatedSheet = useCallback(() => {
    const pending = store.api.getState().initialCursor;
    if (!templateRequest && !starterKitRequest && pending?.path === store.api.getState().selectedPath && editorHandle.current) {
      editorHandle.current.focus();
      store.clearInitialCursor();
    }
  }, [store, templateRequest, starterKitRequest]);
  const editorBecameReady = useCallback(() => { setEditorReady(true); focusCreatedSheet(); }, [focusCreatedSheet]);
  useEffect(() => {
    if (!templateRequest && !starterKitRequest && state.initialCursor) {
      // Native dialog cleanup restores its invoker; focus the new editor after it closes.
      const frame = requestAnimationFrame(focusCreatedSheet);
      return () => cancelAnimationFrame(frame);
    }
  }, [templateRequest, starterKitRequest, state.initialCursor, focusCreatedSheet]);
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

  function dispatchCommand(id: string) {
    if (id.startsWith("table.")) { if (state.owned) editorHandle.current?.runTable(id); return; }
    if (id.startsWith("format.")) { if (state.owned) editorHandle.current?.runFormat(id); return; }
    const actions: Record<string, () => void> = {
      "app.palette": () => setPalette((open) => !open),
      "tidy.document": openTidy,
      "sheet.new": requestNewSheet,
      "sheet.fromTemplate": () => {
        if (!state.owned) return;
        setTemplateRequest(captureTemplateRequest(filter && !/^[#@]/.test(filter) ? filter : notebookFor(state.selectedPath) || "Inbox"));
      },
      "sheet.search": focusSearch,
      "sheet.today": () => run(async () => { await store.openToday(); setFilter("Daily"); setPane("editor"); }),
      "sheet.pin": () => { if (state.selectedPath && state.owned) run(() => store.togglePinned(state.selectedPath)); },
      "view.sidebar": toggleNavigation,
      "view.sheets": toggleSheets,
      "view.density": () => { if (state.owned) run(() => store.setDensity(state.preferences.density === "compact" ? "comfortable" : "compact")); },
      "sheet.save": () => run(store.flush),
      "space.export": () => run(exportZip),
      "space.switch": () => run(onSwitchSpace),
      "view.inspector": () => setInspector((open) => !open),
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
        const next = readKeymap(await store.space.files.read(".slate/keymap.json"), os);
        if (active) setKeymap(next);
      } catch {
        if (active) setKeymap({ ...resolveCommandKeymap({ os, surface: "web" }), issues: [{ commandId: "", message: "The Space keymap could not be read. Default shortcuts remain active." }] });
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [store, os]);

  useEffect(() => {
    try { localStorage.setItem(inspectorKey, String(inspector)); } catch { /* View preferences are optional. */ }
  }, [inspectorKey, inspector]);

  useEffect(() => {
    const record = state.record;
    let active = true;
    if (record.id !== "sample" && createIndex && editorReady) {
      const cache = createIndex(record.id);
      index.current = cache;
      let indexed = store.api.getState().sheets;
      const rebuild = () => cache.rebuild(store.api.getState().sheets).then(() => { if (active) setIndexWarning(""); }).catch(() => {
        if (active) setIndexWarning("Search cache unavailable. Searching files directly.");
      });
      void rebuild();
      const unsubscribe = store.api.subscribe((next) => {
        if (next.saveState === "Saved" && next.sheets !== indexed) { indexed = next.sheets; void rebuild(); }
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
  }, [query, state.saveState]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active && window.document.visibilityState === "visible") {
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
    const interval = setInterval(refresh, 5000);
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
    void navigator.storage?.estimate?.().then((estimate) => setUsage(`${((estimate.usage ?? 0) / 1024 / 1024).toFixed(1)} MB`)).catch(() => undefined);
    return () => {
      active = false;
      observer?.disconnect();
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.document.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [store, run]);

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
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { setPalette(false); setShortcuts(false); if (!actionBusy) setAction(undefined); return; }
      if (palette || shortcuts || action || editorSettings || templateRequest || notebookTemplateRequest || starterKitRequest || snippetPicker || snippetPrompt || snippetSettings || blockSettings) return;
      const editor = editorHandle.current;
      const id = matchCommand(keymap.bindings.filter((binding) => binding.command.group !== "Format"), keyboardInput(event), { editor: editor?.hasFocus() ?? false, selection: editor?.hasSelection() ?? false, get tableColumns() { return editor?.tableColumns() ?? 0; } });
      if (id) { if (window.document.querySelector("dialog[open]")) return; event.preventDefault(); dispatchCommand(id); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
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

  async function downloadOriginal() {
    if (!selected) return;
    const bytes = await store.space.files.read(selected.path);
    if (bytes === undefined) throw new Error("File no longer exists. Refresh your Space.");
    download(selected.path.split("/").pop()!, new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
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

  const { outline, backlinks } = useMemo(() => inspectorContents(inspector, document, documents), [inspector, document, documents]);
  const pinned = state.preferences.pinned.includes(state.selectedPath);

  return <main className="browserWorkspace" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => { if (event.dataTransfer.files.length || event.dataTransfer.items.length) {
      event.preventDefault();
      const dropped = collectBrowserDrop(event.dataTransfer);
      run(async () => importPicked(await dropped));
    } }}>
    <WorkspaceTitleBar viewLabel={tidy.open ? "Source" : "Live"} windowControls={false} space={state.record.name} path={selected?.path ?? ""} inspector={inspector} canWrite={state.owned} shortcut={shortcut}
      onSwitchSpace={() => run(onSwitchSpace)} onNotebook={selectFilter} onNavigation={toggleNavigation} onSheets={toggleSheets} onSearch={focusSearch} onNew={() => dispatchCommand("sheet.new")} onExport={() => dispatchCommand("space.export")} onInspector={() => dispatchCommand("view.inspector")}
      controls={<><button title={`Editor settings (${shortcut("app.editorSettings")})`} aria-label="Editor settings" onClick={(event) => { event.currentTarget.focus(); openEditorSettings(); }}><Settings size={16} /></button><AppearanceControl preference={appearance.preference} onChange={appearance.change} />{onInstall && <button title="Install Slate" aria-label="Install Slate" onClick={onInstall}><Download size={16} /></button>}<button title={`Keyboard shortcuts (${shortcut("app.shortcuts")})`} aria-label="Keyboard shortcuts" onClick={(event) => { event.currentTarget.focus(); setShortcuts(true); }}><Keyboard size={16} /></button><button ref={aboutButton} title="About Slate" aria-label="About Slate" onClick={(event) => { event.currentTarget.focus(); onAbout(); }}><Info size={16} /></button></>}
      menuControls={<AppearanceControl preference={appearance.preference} onChange={appearance.change} />}
      actions={[
        { label: "New from template", disabled: !state.owned, run: () => dispatchCommand("sheet.fromTemplate") },
        { label: "Starter kits", disabled: !state.owned, run: () => setStarterKitRequest(captureTemplateRequest("Inbox")) },
        { label: "Insert snippet", disabled: !state.owned || !selected || selected.unsupportedEncoding || !snippets.library, run: openSnippetPicker },
        { label: "Manage custom blocks", disabled: !blocks.library, run: () => openBlockSettings() },
        { label: "Manage snippets", disabled: !snippets.library, run: () => openSnippetSettings() },
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
        <div className="spaceHeading"><button className="spaceSwitcher" title="Switch Space" onClick={() => run(onSwitchSpace)}><span className="spaceAvatar"><BrandMark size={17} /></span><strong>{state.record.name}</strong><ChevronDown size={13} /></button><button title={`Search sheets (${shortcut("sheet.search")})`} aria-label="Search workspace" onClick={focusSearch}><Search size={16} /></button></div>
        <button className={!filter ? "navItem selected" : "navItem"} onClick={() => selectFilter("")}><BookOpen size={16} />All sheets<span>{state.sheets.length}</span></button>
        <button className={filter === "Inbox" ? "navItem selected" : "navItem"} onClick={() => selectFilter("Inbox")}><Inbox size={16} />Inbox<span>{documents.filter((sheet) => sheet.path.startsWith("Inbox/")).length}</span></button>
        <button className={filter === "Daily" ? "navItem selected" : "navItem"} title={`Today (${shortcut("sheet.today")})`} onClick={() => dispatchCommand("sheet.today")} disabled={!state.owned}><CalendarDays size={16} />Today</button>
        <button className={filter === "@pinned" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@pinned")}><Pin size={16} />Pinned<span>{pinnedCount}</span></button>
        <div className="sectionTitle">Notebooks<button title="New notebook" aria-label="New notebook" disabled={!state.owned} onClick={(event) => { event.currentTarget.focus(); setAction("notebook"); setActionValue(""); }}><Plus size={14} /></button></div>
        <NotebookTree onTemplate={state.owned ? openNotebookTemplate : undefined} paths={notebooks} sheetPaths={state.sheets.map((sheet) => sheet.path)} selected={filter} collapsed={collapsed} onSelect={selectFilter} onToggle={(path) => { if (state.owned) run(async () => { await store.toggleNotebook(path); setCollapsed(new Set(store.api.getState().preferences.collapsedNotebooks)); }); else setCollapsed((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; }); }} onMove={(path, notebook) => run(() => store.move(path, `${notebook}/${path.split("/").pop()!}`))} />
        <div className="sectionTitle">Smart filters</div>
        <button className={filter === "@drafts" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@drafts")}><FileText size={16} />Drafts in progress</button>
        <button className={filter === "@goals" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@goals")}><Gauge size={16} />Goal in progress</button>
        <button className={filter === "@recent" ? "navItem selected" : "navItem"} onClick={() => selectFilter("@recent")}><Filter size={16} />Edited recently</button>
        <div className="sectionTitle">Tags</div>
        {tags.length ? tags.map((tag) => <button key={tag} className={filter === `#${tag}` ? "navItem selected" : "navItem"} onClick={() => selectFilter(`#${tag}`)}><Hash size={15} /><span className="navLabel">{tag}</span><small>{documents.filter((sheet) => sheet.tags.some((entry) => entry.path === tag || entry.path.startsWith(`${tag}/`))).length}</small></button>) : <p className="quiet">Add #tags in your writing.</p>}
        <div className="storageFooter"><HardDrive size={14} /><span>{state.record.id === "sample" ? "Sample" : state.record.tier === "folder" ? `Folder: ${state.record.name}` : `Browser library · ${usage}`}<small>{indexWarning}</small></span></div>
      </aside>
      <aside className="browserSheetList" aria-label="Sheets">
        <div className="listHeading"><strong>{listTitle}</strong><small>{visible.length}</small><label className="densityControl"><span className="visuallyHidden">Sheet density</span><select aria-label="Sheet density" value={state.preferences.density} disabled={!state.owned} onChange={(event) => run(() => store.setDensity(event.target.value as "comfortable" | "compact"))}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button title={`New sheet (${shortcut("sheet.new")})`} aria-label="New Sheet" disabled={!state.owned} onClick={() => dispatchCommand("sheet.new")}><Plus size={17} /></button></div>
        <label className="browserSearch"><Search size={15} /><input ref={search} aria-label="Search sheets" placeholder={filter ? `Filter ${listTitle}…` : "Search sheets…"} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <SheetList sheets={visible} selectedPath={state.selectedPath} preferences={state.preferences} owned={state.owned} pending={summariesPending} readOnlyPaths={new Set(state.sheets.filter((sheet) => sheet.unsupportedEncoding).map((sheet) => sheet.path))} onOpen={(path) => run(async () => { await store.select(path); setPane("editor"); })} onBulk={(kind, paths) => { setActionPaths(paths); setAction(kind); setActionValue(notebookFor(paths[0] ?? "")); }} />
        {!visible.length && <div className="browserEmpty"><strong>{query ? "No sheets match" : "A little room to think"}</strong><p>{query ? "Try another search." : "Create your first sheet or import your notes."}</p></div>}
        <div className="listFoot">{visible.length} sheets</div>
      </aside>
      <section className="browserEditor" aria-label="Editor">
        <div className="documentToolbar"><span>{document?.title || "Your next idea starts here"}</span></div>
        {selected?.unsupportedEncoding ? <div className="browserEmpty editorEmpty"><h1>This file needs UTF-8.</h1><p>Slate kept the original bytes. Download the file to convert a copy to UTF-8, then import that copy to edit.</p><button className="primaryButton" onClick={() => run(downloadOriginal)}>Download original</button></div> : selected ? <Suspense fallback={<p role="status">Opening editor…</p>}><Editor sourceMode={tidy.open} tidyLines={tidyLines} key={`${state.record.id}/${selected.path}`} documentKey={`${state.record.id}/${selected.path}`} initialCursor={state.initialCursor?.path === selected.path ? state.initialCursor.position : undefined} value={selected.content} smartTables={editorPreferences.preferences.smartTables} fences={editorPreferences.preferences.fences} frontmatter={editorPreferences.preferences.frontmatter} smartLists={editorPreferences.preferences.smartLists} selectionPairs={editorPreferences.preferences.selectionPairs} readOnly={!state.owned} onCursorChange={cursor.update} keymap={keymap} completionSheets={completionSheets} completionTags={tags} wikiCompletion={editorPreferences.preferences.wikiCompletion} tagCompletion={editorPreferences.preferences.tagCompletion} dateCompletion={editorPreferences.preferences.dateCompletion} templateMenuLibrary={templates.library} snippetMenuLibrary={snippets.library} blockNote={blockNote} canInsertBlock={canInsertBlock} customBlockLibrary={blocks.library} onManageBlocks={openBlockSettings} snippetIndex={snippets.snapshot?.index} onSnippet={expandSnippet} onHandle={receiveEditor} onReady={editorBecameReady} onChange={store.edit} onImportImage={copyBlockImage} onImportClipboardImage={copyClipboardImage} pasteRichText={editorPreferences.preferences.pasteRichText} pasteLinks={editorPreferences.preferences.pasteLinks} pasteImages={editorPreferences.preferences.pasteImages} pasteTables={editorPreferences.preferences.pasteTables} onNavigateWikiLink={navigateWiki} /></Suspense> : <div className="browserEmpty editorEmpty"><h1>A fresh page awaits.</h1><p>Your words, in plain Markdown. Always yours.</p><button className="primaryButton" disabled={!state.owned} onClick={() => dispatchCommand("sheet.new")}>New Sheet</button></div>}
      </section>
      {tidy.open && <Suspense fallback={<aside className="tidyPanel" aria-label="Tidy review"><p role="status">Opening Tidy…</p></aside>}><TidyPanel review={tidy} readOnly={!state.owned} onClose={closeTidy} onJump={(line) => { setPane("editor"); editorHandle.current?.goToLine(line); }} /></Suspense>}
      {inspector && <aside className="browserInspector" aria-label="Inspector"><button className="inspectorClose" aria-label="Close inspector" onClick={() => setInspector(false)}><X size={16} /></button><h2>Outline</h2>{outline.map((line, i) => <p key={i}>{line.replace(/^#+ /, "")}</p>)}{!outline.length && <p className="quiet">Headings appear here.</p>}<h2>Backlinks</h2>{backlinks.map((sheet) => <button key={sheet.path} onClick={() => run(() => store.select(sheet.path))}>{sheet.title}</button>)}{!backlinks.length && <p className="quiet">No backlinks yet.</p>}{document?.goal && <><h2>Writing goal</h2><p>{document.goal.current.toLocaleString()} / {document.goal.target.toLocaleString()} {document.goal.type === "readingTimeMinutes" ? "minutes" : document.goal.type}</p><progress aria-label="Writing goal" value={document.goal.current} max={document.goal.target} /></>}<h2>File</h2><p>{selected?.path}</p></aside>}
    </div>
    <input ref={input} type="file" aria-label="Import files" multiple accept=".md,.zip" className="visuallyHidden" onChange={(event) => { const files = event.currentTarget.files; if (files) run(() => importPicked(files)); event.currentTarget.value = ""; }} />
    <input ref={folderInput} type="file" aria-label="Import folder" multiple className="visuallyHidden" {...{ webkitdirectory: "" }} onChange={(event) => { const files = event.currentTarget.files; if (files) run(() => importPicked(files)); event.currentTarget.value = ""; }} />
    <WorkspaceStatusBar tidy={{ count: tidy.report?.issues.length, pending: tidy.pending, error: !!tidy.error, open: tidy.open, available: !!selected && !selected.unsupportedEncoding, onOpen: openTidy }} saveState={state.saveState} path={selected?.path ?? ""} content={selected?.content ?? ""} unsupported={!!selected?.unsupportedEncoding} stats={selected?.unsupportedEncoding ? undefined : document?.stats} goal={document?.goal} cursor={cursor} onSave={() => run(store.flush)} onGoal={() => setInspector(true)} onJump={(line) => { setPane("editor"); editorHandle.current?.goToLine(line); }} />
    <LaunchActions key={state.record.id} store={store} />
    {editorSettings && <EditorSettingsDialog preferences={editorPreferences.preferences} onChange={editorPreferences.change} onClose={() => setEditorSettings(false)} onBlocks={blocks.library ? () => { setEditorSettings(false); openBlockSettings(editorSettingsInvoker.current); } : undefined} onSnippets={snippets.library ? () => { setEditorSettings(false); openSnippetSettings(); } : undefined} />}
    {snippetPicker && snippets.library && <Suspense fallback={<WorkspaceDialog title="Insert snippet" returnFocus={snippetPicker.target.element} onClose={() => setSnippetPicker(undefined)}><p role="status">Opening snippets…</p></WorkspaceDialog>}><SnippetPicker library={snippets.library} invocation={snippetPicker} spaceName={state.record.name} onClose={() => setSnippetPicker(undefined)} onChoose={(definition) => { applySnippet(snippetPicker, definition); setSnippetPicker(undefined); }} onManage={() => { openSnippetSettings(snippetPicker.target.element); setSnippetPicker(undefined); }} /></Suspense>}
    {snippetPrompt && <Suspense fallback={<WorkspaceDialog title="Insert snippet" returnFocus={snippetPrompt.target.element} onClose={() => setSnippetPrompt(undefined)}><p role="status">Opening snippet fields…</p></WorkspaceDialog>}><SnippetPrompt request={snippetPrompt} onClose={() => setSnippetPrompt(undefined)} /></Suspense>}
    {blockSettings && blocks.library && <Suspense fallback={<WorkspaceDialog title="Custom blocks" returnFocus={blockSettings.returnFocus} onClose={() => setBlockSettings(undefined)}><p role="status">Opening custom blocks…</p></WorkspaceDialog>}><BlockSettings library={blocks.library} store={store} returnFocus={blockSettings.returnFocus} onTakeover={onTakeover} onClose={() => setBlockSettings(undefined)} /></Suspense>}
    {snippetSettings && snippets.library && <Suspense fallback={<WorkspaceDialog title="Snippets" returnFocus={snippetSettings.returnFocus} onClose={() => setSnippetSettings(undefined)}><p role="status">Opening snippets…</p></WorkspaceDialog>}><SnippetSettings library={snippets.library} store={store} returnFocus={snippetSettings.returnFocus} onTakeover={onTakeover} onClose={() => setSnippetSettings(undefined)} /></Suspense>}
    {(palette || shortcuts) && <CommandDialog kind={shortcuts ? "shortcuts" : "palette"} keymap={keymap} os={os} editor={!!selected && !selected.unsupportedEncoding && state.owned} selection={editorHandle.current?.hasSelection() ?? false} tableColumns={editorHandle.current?.tableColumns() ?? 0} onClose={() => { setPalette(false); setShortcuts(false); }} onCommand={(id) => { setPalette(false); requestAnimationFrame(() => dispatchCommand(id)); }} />}
    {templateRequest && <Suspense fallback={<WorkspaceDialog title="New from template" returnFocus={templateRequest.returnFocus} onClose={() => { setTemplateRequest(undefined); if (templates.library) run(templates.library.refresh); }}><p role="status">Opening templates…</p></WorkspaceDialog>}><TemplateGallery store={store} notebook={templateRequest.notebook} selection={templateRequest.selection} returnFocus={templateRequest.returnFocus} initialTemplateId={templateRequest.initialTemplateId} initialDestination={templateRequest.initialDestination} onClose={() => { setTemplateRequest(undefined); if (templates.library) run(templates.library.refresh); }} onStarterKits={() => { setStarterKitRequest({ returnFocus: templateRequest.returnFocus }); setTemplateRequest(undefined); }} /></Suspense>}
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
