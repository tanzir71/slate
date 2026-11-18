import {
  Archive,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronsLeft,
  CircleAlert,
  Code2,
  FilePlus2,
  Folder,
  Focus,
  Gauge,
  Library,
  Link2,
  ListTree,
  Maximize2,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  TextCursorInput,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  Dispatch,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  SetStateAction
} from "react";
import { matchCommand, resolveCommandKeymap } from "@slate/core";
import { computeEditorHud } from "@slate/editor";
import { slateTokens } from "@slate/tokens";
import {
  createAutosaveController,
  createBrowserDraftAutosaveWriter,
  type AutosaveController,
  type SheetAutosaveWriter
} from "./autosave";
import { MarkdownEditor } from "./MarkdownEditor";
import { commandShortcut, keyboardInput, shortcutOS, type MarkdownEditorHandle } from "./commands";
import { desktopPreviewCommands } from "./desktopCommands";
import { takeShortcutMigrationNotice } from "./shortcutMigrationNotice";
import { CommandDialog } from "./browser/CommandDialog";
import { AppearanceControl, useAppearance } from "./appearance";
import { EditorSettingsDialog } from "./EditorSettingsDialog";
import { useEditorPreferences } from "./editorPreferences";
import { notebooks, sheets as seedSheets, spaces, type NotebookSeed, type SheetSeed } from "./sampleData";
import "./styles.css";

type InspectorTab = "Backlinks" | "Outline" | "Metadata";

const previewCommands = desktopPreviewCommands(spaces.length);

const inspectorTabs: InspectorTab[] = ["Backlinks", "Outline", "Metadata"];

export interface SlateAppProps {
  autosaveWriter?: SheetAutosaveWriter;
  sheetMoveWriter?: SheetMoveWriter;
}

export interface SheetMoveWriter {
  moveSheet(fromPath: string, toPath: string): Promise<void>;
}

const smartFilters = [
  { label: "Today", count: 7, icon: CalendarDays },
  { label: "Recently Updated", count: 18, icon: Gauge },
  { label: "Pinned", count: 6, icon: Pin },
  { label: "Goal: At Risk", count: 3, icon: CircleAlert },
  { label: "Unlinked", count: 12, icon: Link2 },
  { label: "Drafts", count: 9, icon: Pencil }
];

export function SlateApp({ autosaveWriter, sheetMoveWriter }: SlateAppProps = {}) {
  const appearance = useAppearance();
  const editorPreferences = useEditorPreferences();
  const [editorSettingsOpen, setEditorSettingsOpen] = useState(false);
  const [activeSpace, setActiveSpace] = useState("work");
  const [sheets, setSheets] = useState<SheetSeed[]>(seedSheets);
  const [selectedId, setSelectedId] = useState(seedSheets[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutNotice, setShortcutNotice] = useState<string>();
  const os = shortcutOS();
  const keymap = useMemo(() => resolveCommandKeymap({ os, surface: "desktop" }, undefined, previewCommands), [os]);
  const editorHandle = useRef<MarkdownEditorHandle | undefined>(undefined);
  const receiveEditor = useCallback((handle: MarkdownEditorHandle | undefined) => { editorHandle.current = handle; }, []);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("Backlinks");
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sheetListVisible, setSheetListVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [draggedSheetId, setDraggedSheetId] = useState<string | undefined>(undefined);
  const [dropTargetNotebook, setDropTargetNotebook] = useState<string | undefined>(undefined);
  const [moveError, setMoveError] = useState<string | undefined>(undefined);
  const autosaveRef = useRef<AutosaveController | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const inspectorTabRefs = useRef<Record<InspectorTab, HTMLButtonElement | null>>({
    Backlinks: null,
    Outline: null,
    Metadata: null
  });
  const selected = sheets.find((sheet) => sheet.id === selectedId) ?? sheets[0];
  const selectedSpace = spaces.find((space) => space.id === activeSpace) ?? spaces[0];

  useEffect(() => {
    const notice = takeShortcutMigrationNotice(os, "desktop");
    if (notice) setShortcutNotice(notice);
  }, [os]);

  useEffect(() => {
    const writer = autosaveWriter ?? createBrowserDraftAutosaveWriter();
    const controller = createAutosaveController({ writer });
    autosaveRef.current = controller;
    return () => {
      void controller.dispose();
      autosaveRef.current = undefined;
    };
  }, [autosaveWriter]);

  function toggleInspector() {
    const opening = !inspectorVisible;
    setInspectorVisible(opening);
    if (opening) requestAnimationFrame(() => inspectorTabRefs.current[inspectorTab]?.focus());
  }

  function dispatchCommand(id: string) {
    if (id.startsWith("format.")) { editorHandle.current?.runFormat(id); return; }
    const spaceIndex = id.match(/^space\.activate([1-9])$/);
    if (spaceIndex) {
      const space = spaces[Number(spaceIndex[1]) - 1];
      if (space) setActiveSpace(space.id);
      return;
    }
    const actions: Record<string, () => void> = {
      "app.palette": () => setCommandOpen((open) => !open),
      "app.shortcuts": () => setShortcutsOpen(true),
      "app.editorSettings": () => setEditorSettingsOpen(true),
      "sheet.new": createSheet,
      "sheet.search": () => { setSheetListVisible(true); requestAnimationFrame(() => searchInputRef.current?.focus()); },
      "sheet.save": () => { void autosaveRef.current?.flush().catch((error: unknown) => setMoveError(error instanceof Error ? error.message : "Could not save. Keep this window open.")); },
      "view.sidebar": () => setSidebarVisible((visible) => !visible),
      "view.sheets": () => setSheetListVisible((visible) => !visible),
      "view.inspector": toggleInspector,
      "view.focus": () => setFocusMode((enabled) => !enabled),
      "view.typewriter": () => setTypewriterMode((enabled) => !enabled),
      "view.fullscreen": () => setFullscreenMode((enabled) => !enabled),
      "appearance.light": () => appearance.change("light"),
      "appearance.dark": () => appearance.change("dark"),
      "appearance.system": () => appearance.change("system"),
    };
    actions[id]?.();
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.getModifierState("AltGraph")) return;
      if (event.key === "Escape" && !commandOpen && !shortcutsOpen && !editorSettingsOpen && (focusMode || fullscreenMode)) {
        event.preventDefault();
        setFocusMode(false);
        setFullscreenMode(false);
        return;
      }
      if (commandOpen || shortcutsOpen || editorSettingsOpen) return;
      const editor = editorHandle.current;
      const id = matchCommand(keymap.bindings.filter((binding) => binding.command.group !== "Format"), keyboardInput(event), { editor: editor?.hasFocus() ?? false, selection: editor?.hasSelection() ?? false });
      if (id) { event.preventDefault(); dispatchCommand(id); }
    };
    // Explicit workspace bindings take precedence over CodeMirror's fallback keymap.
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  });

  const filteredSheets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return sheets;
    }

    return sheets.filter((sheet) =>
      `${sheet.title} ${sheet.preview} ${sheet.tags.join(" ")}`.toLowerCase().includes(normalized)
    );
  }, [query, sheets]);

  const hud = computeEditorHud(selected?.markdown ?? "");
  const outline = useMemo(() => extractOutline(selected?.markdown ?? ""), [selected?.markdown]);

  function updateSelectedMarkdown(markdown: string) {
    const currentSheet = selected;
    if (currentSheet) {
      autosaveRef.current?.schedule({
        path: sheetToPath(currentSheet),
        content: markdown,
        baseContent: currentSheet.markdown
      });
    }
    setSheets((current) =>
      current.map((sheet) => (sheet.id === selectedId ? { ...sheet, markdown, preview: previewFromMarkdown(markdown) } : sheet))
    );
  }

  function createSheet() {
    void autosaveRef.current?.flush();
    const next: SheetSeed = {
      id: `sheet-${Date.now()}`,
      title: "Untitled Sheet",
      notebook: "drafts",
      tags: ["drafts"],
      updated: "Now",
      status: "Not Started",
      progress: 0,
      preview: "Start writing...",
      backlinks: [],
      markdown: "# Untitled Sheet\n\nStart writing..."
    };
    setSheets((current) => [next, ...current]);
    setSelectedId(next.id);
    setCommandOpen(false);
  }

  async function moveSheetToNotebook(sheetId: string, notebook: string) {
    const sheet = sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet || sheet.notebook === notebook) {
      setDraggedSheetId(undefined);
      setDropTargetNotebook(undefined);
      return;
    }

    await autosaveRef.current?.flush();
    const moved = moveSheetSeed(sheet, notebook);
    const fromPath = sheetToPath(sheet);
    const toPath = sheetToPath(moved);

    try {
      await sheetMoveWriter?.moveSheet(fromPath, toPath);
      setSheets((current) => current.map((candidate) => (candidate.id === sheetId ? moved : candidate)));
      setMoveError(undefined);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Could not move sheet");
    } finally {
      setDraggedSheetId(undefined);
      setDropTargetNotebook(undefined);
    }
  }

  function handleNotebookDragOver(event: DragEvent<HTMLElement>, notebook: string) {
    if (!draggedSheetId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetNotebook(notebook);
  }

  function handleNotebookDrop(event: DragEvent<HTMLElement>, notebook: string) {
    event.preventDefault();
    const sheetId = event.dataTransfer.getData("text/plain") || draggedSheetId;
    if (!sheetId) {
      return;
    }

    void moveSheetToNotebook(sheetId, notebook);
  }

  if (!selected || !selectedSpace) {
    return null;
  }

  const appClassName = [
    "slateApp",
    focusMode ? "focusMode" : "",
    typewriterMode ? "typewriterMode" : "",
    fullscreenMode ? "fullscreenMode" : "",
    sidebarVisible ? "" : "sidebarHidden",
    sheetListVisible ? "" : "sheetListHidden",
    inspectorVisible ? "" : "inspectorHidden"
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      className={appClassName}
      style={{ "--slate-accent": selectedSpace.color, "--token-accent": slateTokens.colors.accent } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand">Slate</div>
        <nav aria-label="Application menu">
          <AppearanceControl preference={appearance.preference} onChange={appearance.change} />
          <button title={`Commands (${commandShortcut("app.palette", keymap, os)})`} onClick={() => setCommandOpen(true)}>Commands</button>
          <button title={`Keyboard shortcuts (${commandShortcut("app.shortcuts", keymap, os)})`} onClick={() => setShortcutsOpen(true)}>Keyboard shortcuts</button>
        </nav>
      </header>

      {shortcutNotice && <div className="shortcutMigrationNotice" role="status"><span>{shortcutNotice}</span><button aria-label="Dismiss shortcut notice" onClick={() => setShortcutNotice(undefined)}><X size={16} /></button></div>}

      <section className="workspace">
        <aside className="sidebar" aria-label="Workspace navigation">
          <SectionHeader label="Spaces" />
          <div className="spaceList">
            {spaces.map((space) => (
              <button
                className={space.id === activeSpace ? "navRow selected" : "navRow"}
                aria-current={space.id === activeSpace ? "true" : undefined}
                key={space.id}
                onClick={() => setActiveSpace(space.id)}
              >
                <SpaceIcon id={space.icon} />
                <span>{space.name}</span>
              </button>
            ))}
            <button className="navRow">
              <Plus size={16} />
              <span>New Space</span>
            </button>
          </div>

          <SectionHeader label="Smart Filters" />
          {smartFilters.map((filter) => (
            <button className="navRow" key={filter.label}>
              <filter.icon size={16} />
              <span>{filter.label}</span>
              <span className="rowCount">{filter.count}</span>
            </button>
          ))}

          <SectionHeader label="Tags" />
          <div className="tagTree">
            {notebooks.map((notebook) =>
              renderNotebook(notebook, {
                path: notebook.id,
                dropTargetNotebook,
                onDragOver: handleNotebookDragOver,
                onDragLeave: () => setDropTargetNotebook(undefined),
                onDrop: handleNotebookDrop
              })
            )}
          </div>

          <div className="sidebarFooter">
            <button aria-label="Editor settings" title={`Editor settings (${commandShortcut("app.editorSettings", keymap, os)})`} onClick={(event) => { event.currentTarget.focus(); setEditorSettingsOpen(true); }}>
              <Settings size={18} />
            </button>
            <button aria-label="Collapse sidebar">
              <ChevronsLeft size={18} />
            </button>
          </div>
        </aside>

        <aside className="sheetList" aria-label="Sheets">
          <div className="sheetActions">
            <button className="primaryButton" onClick={createSheet}>
              <FilePlus2 size={17} />
              <span>New Sheet</span>
            </button>
            <button aria-label="Toggle sheet list density">
              <ListTree size={17} />
            </button>
          </div>

          <label className="searchBox">
            <Search size={16} />
            <input
              aria-label="Search sheets"
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sheets..."
            />
          </label>

          <div className="sheetGroupLabel">
            <Pin size={15} />
            <span>Pinned</span>
          </div>

          <div className="sheetRows">
            {filteredSheets.length > 0 ? (
              filteredSheets.map((sheet) => (
                <button
                  className={`${sheet.id === selected.id ? "sheetRow active" : "sheetRow"}${sheet.id === draggedSheetId ? " dragging" : ""}`}
                  aria-current={sheet.id === selected.id ? "true" : undefined}
                  data-testid={`sheet-row-${sheet.id}`}
                  draggable
                  key={sheet.id}
                  onDragEnd={() => {
                    setDraggedSheetId(undefined);
                    setDropTargetNotebook(undefined);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", sheet.id);
                    setDraggedSheetId(sheet.id);
                  }}
                  onClick={() => {
                    void autosaveRef.current?.flush();
                    setSelectedId(sheet.id);
                  }}
                >
                  <span className="sheetTitleLine">
                    <strong>{sheet.title}</strong>
                    <StatusDot status={sheet.status} />
                  </span>
                  <span className="sheetPreview">{sheet.preview}</span>
                  <span className="tagLine">{sheet.tags.map((tag) => `#${tag}`).join("   ")}</span>
                  <span className="progressLine">
                    <span>{sheet.status}</span>
                    <span className="miniProgress">
                      <span style={{ width: `${sheet.progress}%` }} />
                    </span>
                    <span>{sheet.progress}%</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="emptyState sheetEmptyState" role="status">
                <Search size={20} />
                <strong>No sheets match</strong>
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="listFooter">
            <span>{sheets.length} sheets</span>
            <span>{moveError ?? "Updated"}</span>
          </div>
        </aside>

        <section className="editorPane" aria-label="Editor">
          <div className="editorToolbar">
            <div>
              <h1>{selected.title}</h1>
              <span className="statusLabel">
                <StatusDot status={selected.status} />
                {selected.status}
              </span>
            </div>
            <div className="toolButtons">
              <button
                aria-label="Toggle typewriter mode"
                aria-pressed={typewriterMode}
                className={typewriterMode ? "active" : ""}
                onClick={() => setTypewriterMode((enabled) => !enabled)}
              >
                <TextCursorInput size={17} />
              </button>
              <button
                aria-label="Toggle focus mode"
                aria-pressed={focusMode}
                className={focusMode ? "active" : ""}
                onClick={() => setFocusMode((enabled) => !enabled)}
              >
                <Focus size={17} />
              </button>
              <button
                aria-label="Toggle inspector"
                aria-pressed={inspectorVisible}
                title={`Toggle inspector (${commandShortcut("view.inspector", keymap, os)})`}
                onClick={toggleInspector}
              >
                <PanelRight size={17} />
              </button>
              <button
                aria-label="Toggle full-screen mode"
                aria-pressed={fullscreenMode}
                className={fullscreenMode ? "active" : ""}
                onClick={() => setFullscreenMode((enabled) => !enabled)}
              >
                <Maximize2 size={17} />
              </button>
              <button aria-label="Code tools">
                <Code2 size={17} />
              </button>
              <button aria-label="More actions">
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>

          <MarkdownEditor
            smartLists={editorPreferences.preferences.smartLists}
            selectionPairs={editorPreferences.preferences.selectionPairs}
            key={selected.id}
            documentKey={`desktop/${selected.id}`}
            keymap={keymap}
            onHandle={receiveEditor}
            value={selected.markdown}
            onChange={updateSelectedMarkdown}
            onNavigateWikiLink={(link) => {
              const nextId = resolveWikiLinkSheetId(sheets, link.target, link.targetId);
              if (!nextId) {
                return;
              }
              void autosaveRef.current?.flush();
              setSelectedId(nextId);
              setCommandOpen(false);
            }}
          />

          <div className="editorStatus">
            <span>{hud.words.toLocaleString()} words</span>
            <span>{hud.characters.toLocaleString()} characters</span>
            <span>Markdown</span>
            <span>100%</span>
          </div>
        </section>

        <aside className="inspector" aria-label="Inspector" aria-hidden={!inspectorVisible}>
          <div className="inspectorHeader">
            <strong>Inspector</strong>
            <button aria-label="Close inspector" title="Close inspector" onClick={toggleInspector}><X size={17} /></button>
          </div>
          <div className="tabs" role="tablist" aria-label="Inspector tabs">
            {inspectorTabs.map((tab) => (
              <button
                role="tab"
                aria-selected={inspectorTab === tab}
                aria-controls="inspector-panel"
                className={inspectorTab === tab ? "active" : ""}
                id={inspectorTabId(tab)}
                key={tab}
                ref={(element) => {
                  inspectorTabRefs.current[tab] = element;
                }}
                tabIndex={inspectorTab === tab ? 0 : -1}
                onClick={() => setInspectorTab(tab)}
                onKeyDown={(event) => handleInspectorTabKeyDown(event, tab, setInspectorTab, inspectorTabRefs)}
              >
                {tab}
              </button>
            ))}
          </div>
          <InspectorPanel
            labelledBy={inspectorTabId(inspectorTab)}
            panelId="inspector-panel"
            tab={inspectorTab}
            sheet={selected}
            outline={outline}
          />
        </aside>
      </section>
      {(commandOpen || shortcutsOpen) && <CommandDialog kind={shortcutsOpen ? "shortcuts" : "palette"} surface="desktop" registry={previewCommands} keymap={keymap} os={os} editor={!!selected} selection={editorHandle.current?.hasSelection() ?? false} onClose={() => { setCommandOpen(false); setShortcutsOpen(false); }} onCommand={(id) => { setCommandOpen(false); requestAnimationFrame(() => dispatchCommand(id)); }} />}
      {editorSettingsOpen && <EditorSettingsDialog preferences={editorPreferences.preferences} onChange={editorPreferences.change} onClose={() => setEditorSettingsOpen(false)} />}
    </main>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="sectionHeader">
      <span>{label}</span>
      <button aria-label={`Add ${label.toLowerCase()}`}>
        <Plus size={15} />
      </button>
    </div>
  );
}

function SpaceIcon({ id }: { id: string }) {
  if (id === "briefcase") {
    return <BriefcaseBusiness size={16} />;
  }
  if (id === "book-open") {
    return <BookOpen size={16} />;
  }
  if (id === "library") {
    return <Library size={16} />;
  }
  return <Pencil size={16} />;
}

interface NotebookDropHandlers {
  path: string;
  dropTargetNotebook: string | undefined;
  onDragOver: (event: DragEvent<HTMLElement>, notebook: string) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>, notebook: string) => void;
}

function renderNotebook(notebook: NotebookSeed, handlers: NotebookDropHandlers) {
  const isDropTarget = handlers.dropTargetNotebook === handlers.path;
  return (
    <div className="treeGroup" key={notebook.id}>
      <button
        className={`navRow compact treeParent${isDropTarget ? " dropTarget" : ""}`}
        data-testid={`notebook-drop-${notebook.id}`}
        onDragLeave={handlers.onDragLeave}
        onDragOver={(event) => handlers.onDragOver(event, handlers.path)}
        onDrop={(event) => handlers.onDrop(event, handlers.path)}
      >
        <ChevronDown size={14} />
        <Folder size={15} />
        <span>{notebook.label}</span>
        {notebook.count ? <span className="rowCount">{notebook.count}</span> : null}
      </button>
      {notebook.children ? (
        <div className="treeChildren">
          {notebook.children.map((child) => (
            <button
              className={`navRow compact treeLeaf${handlers.dropTargetNotebook === `${handlers.path}/${child.id}` ? " dropTarget" : ""}`}
              data-testid={`notebook-drop-${child.id}`}
              key={child.id}
              onDragLeave={handlers.onDragLeave}
              onDragOver={(event) => handlers.onDragOver(event, `${handlers.path}/${child.id}`)}
              onDrop={(event) => handlers.onDrop(event, `${handlers.path}/${child.id}`)}
            >
              <Archive size={14} />
              <span>{child.label}</span>
              {child.count ? <span className="rowCount">{child.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusDot({ status }: { status: SheetSeed["status"] }) {
  return <span className={`statusDot ${status === "At Risk" ? "risk" : status === "Not Started" ? "idle" : ""}`} />;
}

function InspectorPanel({
  labelledBy,
  panelId,
  tab,
  sheet,
  outline
}: {
  labelledBy: string;
  panelId: string;
  tab: InspectorTab;
  sheet: SheetSeed;
  outline: string[];
}) {
  const panelProps = {
    "aria-labelledby": labelledBy,
    className: "inspectorBody",
    id: panelId,
    role: "tabpanel"
  };

  if (tab === "Outline") {
    return (
      <div {...panelProps}>
        {outline.length > 0 ? (
          outline.map((heading) => (
            <button className="outlineRow" key={heading}>
              {heading}
            </button>
          ))
        ) : (
          <div className="emptyState inspectorEmptyState" role="status">
            <ListTree size={18} />
            <strong>No headings yet</strong>
          </div>
        )}
      </div>
    );
  }

  if (tab === "Metadata") {
    return (
      <div {...panelProps} className="inspectorBody metadataGrid">
        <span>Created</span>
        <strong>Apr 28, 2026</strong>
        <span>Updated</span>
        <strong>{sheet.updated}</strong>
        <span>Status</span>
        <strong>{sheet.status}</strong>
        <span>Notebook</span>
        <strong>{sheet.notebook}</strong>
      </div>
    );
  }

  return (
    <div {...panelProps}>
      <span className="subtle">{sheet.backlinks.length} backlinks</span>
      {sheet.backlinks.length > 0 ? (
        sheet.backlinks.map((backlink) => (
          <button className="backlinkRow" key={backlink}>
            <strong>{backlink}</strong>
            <span>...This plan connects to {sheet.title.toLowerCase()} and related launch work...</span>
            <Link2 size={15} />
          </button>
        ))
      ) : (
        <div className="emptyState inspectorEmptyState" role="status">
          <Link2 size={18} />
          <strong>No backlinks yet</strong>
        </div>
      )}
      <div className="goalBox">
        <span>
          <StatusDot status={sheet.status} />
          {sheet.status}
        </span>
        <strong>{sheet.progress}%</strong>
        <div className="goalTrack">
          <span style={{ width: `${sheet.progress}%` }} />
        </div>
        <small>Target: 100%</small>
      </div>
      <div className="tagPills">
        {sheet.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
        <button aria-label="Add tag">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function handleInspectorTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  tab: InspectorTab,
  setInspectorTab: Dispatch<SetStateAction<InspectorTab>>,
  tabRefs: MutableRefObject<Record<InspectorTab, HTMLButtonElement | null>>
): void {
  let nextTab: InspectorTab | undefined;
  const currentIndex = inspectorTabs.indexOf(tab);

  if (event.key === "ArrowRight") {
    event.preventDefault();
    nextTab = inspectorTabs[(currentIndex + 1) % inspectorTabs.length];
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    nextTab = inspectorTabs[(currentIndex - 1 + inspectorTabs.length) % inspectorTabs.length];
  }

  if (event.key === "Home") {
    event.preventDefault();
    nextTab = inspectorTabs[0];
  }

  if (event.key === "End") {
    event.preventDefault();
    nextTab = inspectorTabs[inspectorTabs.length - 1];
  }

  if (!nextTab) {
    return;
  }

  setInspectorTab(nextTab);
  window.requestAnimationFrame(() => tabRefs.current[nextTab]?.focus());
}

function inspectorTabId(tab: InspectorTab): string {
  return `inspector-tab-${tab.toLowerCase()}`;
}

function extractOutline(markdown: string): string[] {
  return Array.from(markdown.matchAll(/^#{1,3}\s+(.+)$/gm), (match) => match[1] ?? "").filter(Boolean);
}

function previewFromMarkdown(markdown: string): string {
  return markdown
    .replace(/^#+\s+/gm, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2")
    .replace(/[#*_`>-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 18)
    .join(" ");
}

function moveSheetSeed(sheet: SheetSeed, notebook: string): SheetSeed {
  const nextTags = sheet.tags.map((tag) => (tag === sheet.notebook ? notebook : tag));
  if (!nextTags.includes(notebook)) {
    nextTags.unshift(notebook);
  }

  return { ...sheet, notebook, tags: nextTags, updated: "Now" };
}

export function resolveWikiLinkSheetId(
  sheets: SheetSeed[],
  target: string,
  targetId?: string
): string | undefined {
  if (targetId) {
    const byId = sheets.find((sheet) => sheet.id === targetId);
    if (byId) {
      return byId.id;
    }
  }

  const normalizedTarget = normalizeWikiTitle(target);
  return sheets.find((sheet) => normalizeWikiTitle(sheet.title) === normalizedTarget)?.id;
}

function sheetToPath(sheet: SheetSeed): string {
  return `${sheet.notebook}/${slugify(sheet.title)}.md`;
}

function normalizeWikiTitle(title: string): string {
  return title.trim().toLowerCase();
}

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";
}
