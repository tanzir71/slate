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
  Gauge,
  Library,
  Link2,
  ListTree,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  TextCursorInput
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { computeEditorHud } from "@slate/editor";
import { slateTokens } from "@slate/tokens";
import {
  createAutosaveController,
  createBrowserDraftAutosaveWriter,
  type AutosaveController,
  type SheetAutosaveWriter
} from "./autosave";
import { MarkdownEditor } from "./MarkdownEditor";
import { notebooks, sheets as seedSheets, spaces, type NotebookSeed, type SheetSeed } from "./sampleData";
import "./styles.css";

type InspectorTab = "Backlinks" | "Outline" | "Metadata";

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
  const [activeSpace, setActiveSpace] = useState("work");
  const [sheets, setSheets] = useState<SheetSeed[]>(seedSheets);
  const [selectedId, setSelectedId] = useState(seedSheets[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("Backlinks");
  const [draggedSheetId, setDraggedSheetId] = useState<string | undefined>(undefined);
  const [dropTargetNotebook, setDropTargetNotebook] = useState<string | undefined>(undefined);
  const [moveError, setMoveError] = useState<string | undefined>(undefined);
  const autosaveRef = useRef<AutosaveController | undefined>(undefined);
  const selected = sheets.find((sheet) => sheet.id === selectedId) ?? sheets[0];
  const selectedSpace = spaces.find((space) => space.id === activeSpace) ?? spaces[0];

  useEffect(() => {
    const writer = autosaveWriter ?? createBrowserDraftAutosaveWriter();
    const controller = createAutosaveController({ writer });
    autosaveRef.current = controller;
    return () => {
      void controller.dispose();
      autosaveRef.current = undefined;
    };
  }, [autosaveWriter]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }

      if (commandKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createSheet();
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [sheets]);

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

  return (
    <main
      className="slateApp"
      style={{ "--slate-accent": selectedSpace.color, "--token-accent": slateTokens.colors.accent } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand">Slate</div>
        <nav aria-label="Application menu">
          <button>File</button>
          <button>Edit</button>
          <button>View</button>
          <button>Go</button>
          <button>Window</button>
          <button>Help</button>
        </nav>
        <div className="windowControls" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar" aria-label="Workspace navigation">
          <SectionHeader label="Spaces" />
          <div className="spaceList">
            {spaces.map((space) => (
              <button
                className={space.id === activeSpace ? "navRow selected" : "navRow"}
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
            <button aria-label="Settings">
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sheets..." />
          </label>

          <div className="sheetGroupLabel">
            <Pin size={15} />
            <span>Pinned</span>
          </div>

          <div className="sheetRows">
            {filteredSheets.map((sheet) => (
              <button
                className={`${sheet.id === selected.id ? "sheetRow active" : "sheetRow"}${sheet.id === draggedSheetId ? " dragging" : ""}`}
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
            ))}
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
              <button aria-label="Typography">
                <TextCursorInput size={17} />
              </button>
              <button aria-label="Toggle inspector" onClick={() => setInspectorTab("Backlinks")}>
                <PanelRight size={17} />
              </button>
              <button aria-label="Code tools">
                <Code2 size={17} />
              </button>
              <button aria-label="More actions">
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>

          {commandOpen ? <CommandPalette onClose={() => setCommandOpen(false)} onCreate={createSheet} /> : null}

          <MarkdownEditor
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

        <aside className="inspector" aria-label="Inspector">
          <div className="inspectorHeader">
            <strong>Inspector</strong>
            <Pin size={17} />
          </div>
          <div className="tabs" role="tablist" aria-label="Inspector tabs">
            {(["Backlinks", "Outline", "Metadata"] as const).map((tab) => (
              <button
                role="tab"
                aria-selected={inspectorTab === tab}
                className={inspectorTab === tab ? "active" : ""}
                key={tab}
                onClick={() => setInspectorTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <InspectorPanel tab={inspectorTab} sheet={selected} outline={outline} />
        </aside>
      </section>
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

function CommandPalette({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const commands = [
    { label: "New Sheet", shortcut: "Ctrl N", action: onCreate },
    { label: "Search Everything", shortcut: "Ctrl Shift F", action: onClose },
    { label: "Export Markdown", shortcut: "Ctrl Shift E", action: onClose },
    { label: "Open Command Palette", shortcut: "Ctrl K", action: onClose },
    { label: "Toggle Right Inspector", shortcut: "Ctrl I", action: onClose }
  ];

  return (
    <div className="commandPalette" role="dialog" aria-label="Command palette">
      <label className="commandSearch">
        <Search size={17} />
        <input autoFocus placeholder="Search Everything" />
        <kbd>Ctrl K</kbd>
      </label>
      <span className="commandLabel">Command</span>
      {commands.map((command, index) => (
        <button className={index === 0 ? "commandRow active" : "commandRow"} key={command.label} onClick={command.action}>
          <span>{command.label}</span>
          <kbd>{command.shortcut}</kbd>
        </button>
      ))}
      <button className="showAll" onClick={onClose}>
        <Sparkles size={15} />
        <span>Show All Commands</span>
      </button>
    </div>
  );
}

function InspectorPanel({
  tab,
  sheet,
  outline
}: {
  tab: InspectorTab;
  sheet: SheetSeed;
  outline: string[];
}) {
  if (tab === "Outline") {
    return (
      <div className="inspectorBody">
        {outline.map((heading) => (
          <button className="outlineRow" key={heading}>
            {heading}
          </button>
        ))}
      </div>
    );
  }

  if (tab === "Metadata") {
    return (
      <div className="inspectorBody metadataGrid">
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
    <div className="inspectorBody">
      <span className="subtle">{sheet.backlinks.length} backlinks</span>
      {sheet.backlinks.map((backlink) => (
        <button className="backlinkRow" key={backlink}>
          <strong>{backlink}</strong>
          <span>...This plan connects to {sheet.title.toLowerCase()} and related launch work...</span>
          <Link2 size={15} />
        </button>
      ))}
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
