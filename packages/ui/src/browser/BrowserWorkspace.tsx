import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Folder, Hash, Inbox, Plus, Search, PanelRight, ArrowLeft, Download, Upload, Trash2, Pencil, BookOpen, Info } from "lucide-react";
import { parseSheet } from "@slate/core";
import { safeBrowserPath, type BrowserDirectoryHandle } from "@slate/storage/browser-files";
import { addBrowserImportEntry, collectBrowserDrop, type BrowserImportFile } from "@slate/storage/browser-import";
import type { WorkspaceStore } from "./workspaceStore";
import type { BrowserAppProps } from "./BrowserApp";
import { LaunchActions } from "./LaunchActions";
import { AppearanceControl, type useAppearance } from "../appearance";
import { BrandMark } from "../BrandMark";

const Editor = lazy(() => import("../MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const inspectorKey = `slate.inspector.${state.record.id}`;
  const [inspector, setInspector] = useState(() => {
    try { return localStorage.getItem(inspectorKey) === "true"; } catch { return false; }
  });
  const [palette, setPalette] = useState(false);
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
  const aboutButton = useRef<HTMLButtonElement>(null);
  const index = useRef<ReturnType<NonNullable<BrowserAppProps["createIndex"]>> | undefined>(undefined);
  const queryGeneration = useRef(0);
  const selected = state.sheets.find((sheet) => sheet.path === state.selectedPath);
  const documents = useMemo(() => state.sheets.map((sheet) => parseSheet(sheet.content, sheet.path)), [state.sheets]);
  const document = documents.find((sheet) => sheet.path === state.selectedPath);
  const notebooks = [...new Set([...state.sheets.map((sheet) => notebookFor(sheet.path)).filter(Boolean), ...extraNotebooks])].sort();
  const tags = [...new Set(documents.flatMap((sheet) => sheet.tags.map((tag) => tag.path)))].sort();
  const visible = documents.filter((sheet) => {
    const inNotebook = !filter || (filter.startsWith("#") ? sheet.tags.some((tag) => tag.path === filter.slice(1)) : sheet.path.startsWith(`${filter}/`));
    const textMatch = !query || (matches ? matches.includes(sheet.path) : `${sheet.title} ${sheet.raw}`.toLowerCase().includes(query.toLowerCase()));
    return inNotebook && textMatch;
  });

  function run(work: () => Promise<unknown>) {
    void work().catch((error: unknown) => store.api.setState({ error: error instanceof Error ? error.message : "The operation failed. Your files were kept." }));
  }

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
      if (active && window.document.visibilityState === "visible") run(store.refresh);
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
  }, [store]);

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
      history.replaceState(null, "", `#/space/${encodeURIComponent(state.record.id)}/sheet/${encodeURIComponent(state.selectedPath)}`);
      try { localStorage.setItem(`slate.last-sheet.${state.record.id}`, state.selectedPath); } catch { /* View preferences are optional. */ }
    }
  }, [state.record.id, state.selectedPath]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.getModifierState("AltGraph")) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") { setPalette(false); setAction(undefined); return; }
      if ((event.altKey && !mod && !event.shiftKey && key === "n")) { event.preventDefault(); run(() => store.create(filter && !filter.startsWith("#") ? filter : "Inbox")); }
      if (mod && key === "k") { event.preventDefault(); setPalette((open) => !open); }
      if (mod && event.shiftKey && key === "i") { event.preventDefault(); setInspector((open) => !open); }
      if (mod && event.shiftKey && key === "f") { event.preventDefault(); search.current?.focus(); }
      if (mod && key === "s") { event.preventDefault(); run(store.flush); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [store, filter]);

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
    if (action === "trash") await store.trash(path);
    else if (action === "rename") {
      const filename = actionValue.replace(/\.md$/i, "").trim();
      if (!filename || /[/\\]/.test(filename)) throw new Error("Choose a filename without slashes.");
      await store.move(path, `${notebookFor(path) ? `${notebookFor(path)}/` : ""}${filename}.md`);
    } else if (action === "move") await store.move(path, safeBrowserPath(`${actionValue}/${path.split("/").pop()!}`));
    else if (action === "notebook") {
      const name = safeBrowserPath(actionValue.trim());
      setExtraNotebooks((current) => [...current, name]);
      setFilter(name);
      await store.create(name);
    }
    setAction(undefined);
  }

  const outline = (document?.body ?? "").split("\n").filter((line) => /^#{1,6} /.test(line));
  const backlinks = documents.filter((sheet) => sheet.path !== selected?.path && sheet.links.some((link) => link.targetId === document?.id || link.target === document?.title));

  return <main className="browserWorkspace" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => { if (event.dataTransfer.files.length || event.dataTransfer.items.length) {
      event.preventDefault();
      const dropped = collectBrowserDrop(event.dataTransfer);
      run(async () => importPicked(await dropped));
    } }}>
    <header className="workspaceHeader"><button onClick={() => run(onSwitchSpace)} title="Switch Space"><ArrowLeft size={15} /><span>{state.record.name}</span></button><span className="headerBreadcrumb">{selected?.path ?? "Your writing"}</span><AppearanceControl preference={appearance.preference} onChange={appearance.change} />{onInstall && <button title="Install Slate" aria-label="Install Slate" onClick={onInstall}><Download size={17} /></button>}<button ref={aboutButton} title="About Slate" aria-label="About Slate" onClick={(event) => { event.currentTarget.focus(); onAbout(); }}><Info size={17} /></button><button title="Inspector (Ctrl Shift I)" aria-label="Toggle inspector" aria-pressed={inspector} onClick={() => setInspector((open) => !open)}><PanelRight size={17} /></button></header>
    {state.record.id === "sample" && <div className="notice">Sample — nothing is saved <button onClick={() => run(onKeepSample)}>Keep these sheets</button></div>}
    {!state.owned && <div className="notice" role="status">Slate is open in another tab <button onClick={() => run(onTakeover)}>Use here</button></div>}
    {state.error && <div className="errorNotice" role="alert">{state.error}<button onClick={() => run(store.flush)}>Retry saving</button></div>}
    {state.notice && <div className="notice" role="status">{state.notice}<button aria-label="Dismiss notice" onClick={() => store.api.setState({ notice: "" })}>×</button></div>}
    <div className={`browserPanes ${inspector ? "withInspector" : ""}`}>
      <aside className="browserSidebar" aria-label="Workspace navigation">
        <div className="spaceHeading"><BrandMark /><strong>{state.record.name}</strong></div>
        <button className={!filter ? "navItem selected" : "navItem"} onClick={() => setFilter("")}><BookOpen size={16} />All sheets<span>{state.sheets.length}</span></button>
        <button className={filter === "Inbox" ? "navItem selected" : "navItem"} onClick={() => setFilter("Inbox")}><Inbox size={16} />Inbox</button>
        <div className="sectionTitle">Notebooks<button aria-label="New notebook" disabled={!state.owned} onClick={() => { setAction("notebook"); setActionValue(""); }}><Plus size={15} /></button></div>
        {notebooks.map((notebook) => <button key={notebook} className={filter === notebook ? "navItem selected" : "navItem"} onClick={() => setFilter(notebook)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          const path = event.dataTransfer.getData("slate/sheet-path");
          if (path) { event.preventDefault(); run(() => store.move(path, `${notebook}/${path.split("/").pop()!}`)); }
        }}><Folder size={16} /><span>{notebook}</span></button>)}
        <div className="sectionTitle">Tags</div>
        {tags.length ? tags.map((tag) => <button key={tag} className="navItem" onClick={() => setFilter(`#${tag}`)}><Hash size={15} />{tag}</button>) : <p className="quiet">Add #tags in your writing.</p>}
        <div className="storageFooter">{state.record.id === "sample" ? "Sample" : state.record.tier === "folder" ? `Folder: ${state.record.name}` : `Browser library · ${usage}`}<br /><span>{indexWarning}</span></div>
      </aside>
      <aside className="browserSheetList" aria-label="Sheets">
        <div className="listHeading"><strong>{filter || "All sheets"}</strong><button title="New sheet (Alt N)" aria-label="New Sheet" disabled={!state.owned} onClick={() => run(() => store.create(filter && !filter.startsWith("#") ? filter : "Inbox"))}><Plus size={18} /></button></div>
        <label className="browserSearch"><Search size={15} /><input ref={search} aria-label="Search sheets" placeholder="Search sheets…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="browserSheetRows">{visible.map((sheet) => <button className={`browserSheetRow ${sheet.path === state.selectedPath ? "active" : ""}`} key={sheet.path} aria-current={sheet.path === state.selectedPath ? "true" : undefined} draggable={state.owned}
          onDragStart={(event) => event.dataTransfer.setData("slate/sheet-path", sheet.path)} onClick={() => run(() => store.select(sheet.path))}>
          <strong>{sheet.title || "Untitled"}</strong><span>{sheet.body.replace(/^#+\s.*$/gm, "").trim().slice(0, 115) || "Start writing…"}</span><small>{notebookFor(sheet.path)}</small>
        </button>)}</div>
        {!visible.length && <div className="browserEmpty"><strong>{query ? "No sheets match" : "A little room to think"}</strong><p>{query ? "Try another search." : "Create your first sheet or import your notes."}</p></div>}
        <div className="listFoot">{visible.length} sheets</div>
      </aside>
      <section className="browserEditor" aria-label="Editor">
        <div className="documentToolbar"><span>{document?.title || "Your next idea starts here"}</span><div>
          <button title="Rename sheet" aria-label="Rename sheet" disabled={!selected || selected.unsupportedEncoding || !state.owned} onClick={() => { setAction("rename"); setActionValue(selected?.path.split("/").pop()?.replace(/\.md$/i, "") ?? ""); }}><Pencil size={16} /></button>
          <button title="Move sheet" aria-label="Move sheet" disabled={!selected || selected.unsupportedEncoding || !state.owned} onClick={() => { setAction("move"); setActionValue(notebookFor(state.selectedPath)); }}><Folder size={16} /></button>
          <button title="Move to trash" aria-label="Delete sheet" disabled={!selected || selected.unsupportedEncoding || !state.owned} onClick={() => setAction("trash")}><Trash2 size={16} /></button>
        </div></div>
        {selected?.unsupportedEncoding ? <div className="browserEmpty editorEmpty"><h1>This file needs UTF-8.</h1><p>Slate kept the original bytes. Download the file to convert a copy to UTF-8, then import that copy to edit.</p><button className="primaryButton" onClick={() => run(downloadOriginal)}>Download original</button></div> : selected ? <Suspense fallback={<p role="status">Opening editor…</p>}><Editor key={`${state.record.id}/${selected.path}`} documentKey={`${state.record.id}/${selected.path}`} value={selected.content} readOnly={!state.owned} onReady={() => setEditorReady(true)} onChange={(content) => {
          store.edit(content);
        }} onNavigateWikiLink={(link) => {
          const target = documents.find((sheet) => sheet.id === link.targetId || sheet.title.toLowerCase() === link.target.toLowerCase());
          if (target) run(() => store.select(target.path));
        }} /></Suspense> : <div className="browserEmpty editorEmpty"><h1>A fresh page awaits.</h1><p>Your words, in plain Markdown. Always yours.</p><button className="primaryButton" disabled={!state.owned} onClick={() => run(() => store.create())}>New Sheet</button></div>}
      </section>
      {inspector && <aside className="browserInspector" aria-label="Inspector"><h2>Outline</h2>{outline.map((line, i) => <p key={i}>{line.replace(/^#+ /, "")}</p>)}{!outline.length && <p className="quiet">Headings appear here.</p>}<h2>Backlinks</h2>{backlinks.map((sheet) => <button key={sheet.path} onClick={() => run(() => store.select(sheet.path))}>{sheet.title}</button>)}{!backlinks.length && <p className="quiet">No backlinks yet.</p>}<h2>File</h2><p>{selected?.path}</p></aside>}
    </div>
    <footer className="workspaceStatus"><span role="status">{selected?.unsupportedEncoding ? "Read-only" : state.saveState}</span><span>{selected?.unsupportedEncoding ? "—" : document?.stats.words ?? 0} words</span><span>{selected?.unsupportedEncoding ? "—" : document?.stats.readingTimeMinutes ?? 0} min read</span><span>Markdown</span><div />
      <input ref={input} type="file" aria-label="Import files" multiple accept=".md,.zip" className="visuallyHidden" onChange={(event) => { const files = event.currentTarget.files; if (files) run(() => importPicked(files)); event.currentTarget.value = ""; }} />
      <input ref={folderInput} type="file" aria-label="Import folder" multiple className="visuallyHidden" {...{ webkitdirectory: "" }} onChange={(event) => { const files = event.currentTarget.files; if (files) run(() => importPicked(files)); event.currentTarget.value = ""; }} />
      <button disabled={!state.owned} onClick={() => input.current?.click()}><Upload size={14} />Import</button><button disabled={!state.owned} onClick={() => folderInput.current?.click()}>Import folder</button><button onClick={() => run(exportZip)}><Download size={14} />Export .zip</button>
    </footer>
    <LaunchActions key={state.record.id} store={store} />
    {palette && <div className="modalBackdrop" onClick={() => setPalette(false)}><section className="browserDialog" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
      <h2>Command palette</h2><button onClick={() => { setPalette(false); run(() => store.create()); }}>New sheet <kbd>Alt N</kbd></button><button onClick={() => { setPalette(false); search.current?.focus(); }}>Search sheets <kbd>Ctrl Shift F</kbd></button><button onClick={() => { setPalette(false); run(exportZip); }}>Export Space as .zip</button><button onClick={() => { setPalette(false); aboutButton.current?.focus(); onAbout(); }}>About Slate</button><button onClick={() => setPalette(false)}>Close</button>
    </section></div>}
    {action && <div className="modalBackdrop"><form className="browserDialog" role="dialog" aria-modal="true" aria-label={`${action} sheet`} onSubmit={(event) => { event.preventDefault(); run(performAction); }}>
      <h2>{action === "trash" ? "Move this sheet to trash?" : action === "notebook" ? "New notebook" : action === "rename" ? "Rename sheet" : "Move to notebook"}</h2>
      {action === "trash" ? <p>A copy stays in .slate/trash and is included in your Space export.</p> : <label>{action === "rename" ? "File name" : "Notebook path"}<input autoFocus value={actionValue} onChange={(event) => setActionValue(event.target.value)} required /></label>}
      <div className="dialogActions"><button type="button" onClick={() => setAction(undefined)}>Cancel</button><button type="submit" className="primaryButton">{action === "trash" ? "Move to trash" : "Save"}</button></div>
    </form></div>}
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
