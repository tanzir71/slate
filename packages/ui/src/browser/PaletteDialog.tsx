import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Braces, Command, Hash, Heading, LayoutGrid } from "lucide-react";
import { createPaletteIndex, parsePaletteQuery, type PaletteEntry, type PaletteKind, type PaletteMode, type ShortcutOS } from "@slate/core";
import { WorkspaceDialog } from "./WorkspaceDialog";
import "../palette.css";

const kinds: readonly PaletteKind[] = ["commands", "sheets", "tags", "headings", "blocks", "snippets"];
const modes: readonly { mode: PaletteMode; label: string; prefix: string }[] = [
  { mode: "commands", label: "Commands", prefix: ">" }, { mode: "tags", label: "Tags", prefix: "#" },
  { mode: "headings", label: "Headings", prefix: "@" }, { mode: "blocks", label: "Blocks", prefix: "/" },
  { mode: "snippets", label: "Snippets", prefix: ";" },
];
const suggested = new Set(["sheet.today", "sheet.new", "sheet.fromTemplate", "tidy.document", "sheet.search"]);
const identity = (entry: PaletteEntry) => `${entry.kind}/${entry.id}`;

function ResultIcon({ entry, active }: { entry: PaletteEntry; active: boolean }) {
  if (entry.kind === "sheets") return <span className="paletteGlyph paletteGlyph--file" />;
  if (entry.kind === "commands" && entry.id.startsWith("tidy."))
    return <span className={`paletteGlyph paletteGlyph--${active ? "wand-selected" : "wand"}`} />;
  if (entry.kind === "commands" && /settings|manage/i.test(entry.label)) return <span className="paletteGlyph paletteGlyph--sliders" />;
  const Icon = entry.kind === "tags" ? Hash : entry.kind === "headings" ? Heading : entry.kind === "blocks" ? LayoutGrid : entry.kind === "snippets" ? Braces : Command;
  return <Icon size={16} />;
}

export function PaletteDialog({ entries, index: prepared, initialMode = "all", returnFocus, shortcut, available, visible, preview, allowSplit = false, os = "windows", onChoose, onClose }: {
  entries: readonly PaletteEntry[];
  index?: ReturnType<typeof createPaletteIndex>;
  initialMode?: "all" | "sheets";
  returnFocus?: HTMLElement | undefined;
  shortcut?(entry: PaletteEntry): string;
  available?(entry: PaletteEntry): boolean;
  visible?(entry: PaletteEntry): boolean;
  preview?(entry: PaletteEntry): ReactNode;
  allowSplit?: boolean;
  os?: ShortcutOS;
  onChoose(entry: PaletteEntry, split: boolean): void | Promise<void>;
  onClose(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState("");
  const [fallback, setFallback] = useState<PaletteMode>(initialMode);
  const [activeKey, setActiveKey] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resultId = useId();
  const helpId = useId();
  const index = useMemo(() => prepared ?? createPaletteIndex(entries), [entries, prepared]);
  const parsed = parsePaletteQuery(query, fallback);
  const result = useMemo(() => {
    if (parsed.mode === "all" && !parsed.text) return {
      total: index.search("", { limit: 0, ...(visible ? { accept: visible } : {}) }).total,
      items: [...entries.filter((entry) => entry.kind === "commands" && suggested.has(entry.id) && visible?.(entry) !== false).slice(0, 5),
        ...index.search("", { mode: "sheets", limit: 8 }).items],
    };
    return index.search(query, { mode: fallback, ...(visible ? { accept: visible } : {}) });
  }, [entries, index, query, fallback, parsed.mode, parsed.text, visible]);
  const items = useMemo(() => kinds.flatMap((kind) => result.items.filter((entry) => entry.kind === kind)), [result.items]);
  const found = items.findIndex((entry) => identity(entry) === activeKey);
  const activeIndex = found < 0 ? 0 : found;
  const active = items[activeIndex];
  const title = initialMode === "sheets" ? "Quick open" : "Command palette";
  const label = parsed.mode === "all" ? "Search commands and sheets" : `Search ${parsed.mode}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (active) buttons.current.get(identity(active))?.scrollIntoView({ block: "nearest" }); }, [active]);
  useEffect(() => { if (error && !busy) input.current?.focus(); }, [error, busy]);

  function changeMode(mode: PaletteMode) {
    setFallback(mode); setQuery(parsed.text); setActiveKey(undefined); setError(""); input.current?.focus();
  }
  async function choose(entry: PaletteEntry, split = false) {
    if (working.current || available?.(entry) === false) return;
    working.current = true; setBusy(true); setError("");
    try { await onChoose(entry, split); if (alive.current) onClose(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || busy) return;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey && !event.ctrlKey && !event.metaKey && items.length) {
      event.preventDefault(); event.stopPropagation();
      const next = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      setActiveKey(identity(items[next]!));
    } else if (event.key === "Enter" && !event.altKey && active) {
      event.preventDefault(); event.stopPropagation();
      void choose(active, allowSplit && (event.ctrlKey || event.metaKey) && (active.kind === "sheets" || active.kind === "headings"));
    } else if (event.key === "Tab" && !event.shiftKey && !showPreview && preview && active) {
      event.preventDefault(); setShowPreview(true);
    }
  }
  const header = <header className="paletteHeader">
    <span className="paletteGlyph paletteGlyph--search" aria-hidden="true" />
    <input className="paletteInput" ref={input} aria-label={label} aria-describedby={helpId} aria-controls={resultId}
      placeholder={initialMode === "sheets" ? "Find a sheet…" : "What would you like to do?"} autoComplete="off" spellCheck={false}
      value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setActiveKey(undefined); setError(""); }} onKeyDown={keys} />
    <button className="paletteEscape" aria-label={`Close ${title.toLowerCase()}`} disabled={busy} onClick={onClose}><kbd>Esc</kbd></button>
  </header>;
  return <WorkspaceDialog title={title} className="slatePalette" busy={busy} returnFocus={returnFocus} initialFocus={input} headerContent={header} onClose={onClose}>
    <nav className="paletteModes" aria-label="Palette modes">
      <button aria-pressed={parsed.mode === initialMode} disabled={busy} onClick={() => changeMode(initialMode)}>{initialMode === "sheets" ? "Sheets" : "All"}</button>
      {modes.map(({ mode, label, prefix }) => <button key={mode} aria-pressed={parsed.mode === mode} disabled={busy} onClick={() => changeMode(mode)}><span>{prefix}</span>{label}</button>)}
    </nav>
    {error && <p role="alert" className="paletteError">{error}</p>}
    <div className="paletteContent">
      <div id={resultId} className="commandResults" aria-label="Palette results" aria-busy={busy}>
        {kinds.map((kind) => {
          const group = items.filter((entry) => entry.kind === kind);
          return !group.length ? null : <section key={kind} aria-label={kind}><h2>{kind}</h2>{group.map((entry) => {
            const key = identity(entry), selected = active === entry;
            const detailId = `${resultId}-${items.indexOf(entry)}-detail`;
            const binding = shortcut?.(entry);
            return <button key={key} ref={(element) => { if (element) buttons.current.set(key, element); else buttons.current.delete(key); }}
              className={`paletteResult${selected ? " isActive" : ""}`} aria-label={entry.label} aria-describedby={entry.detail ? detailId : undefined} disabled={busy || available?.(entry) === false}
              onPointerMove={(event) => { if (event.movementX || event.movementY) setActiveKey(key); }} onFocus={() => setActiveKey(key)}
              onClick={(event) => void choose(entry, allowSplit && (event.ctrlKey || event.metaKey) && (kind === "sheets" || kind === "headings"))}>
              <span className="paletteTile" aria-hidden="true"><ResultIcon entry={entry} active={selected} /></span>
              <span className="paletteResultText"><span className="commandLabel">{entry.label}</span>{entry.detail && <small id={detailId}>{entry.detail}</small>}</span>
              {binding && <kbd>{binding}</kbd>}
            </button>;
          })}</section>;
        })}
        {!items.length && <p className="paletteEmpty">No matches. Try another search or mode.</p>}
      </div>
      {showPreview && active && preview && <section className="palettePreview" aria-label="Result preview" tabIndex={0}><h2>{active.label}</h2>{preview(active)}</section>}
    </div>
    <p className="visuallyHidden" role="status">{result.total} matches.{active ? ` Selected: ${active.label}.` : ""}{showPreview ? " Preview open." : ""}</p>
    <footer className="paletteFooter">
      <span><kbd>Enter</kbd>Run</span>
      {allowSplit && <span><kbd>{os === "mac" ? "⌘" : "Ctrl"}</kbd><kbd>Enter</kbd>Open in split</span>}
      {preview && <button disabled={busy || !active} aria-pressed={showPreview} onClick={() => setShowPreview(!showPreview)}><kbd>Tab</kbd>Preview</button>}
      <span className="paletteModeHint" id={helpId}>Type &gt; # @ / ; to switch mode</span>
      {result.total > items.length && <span className="paletteMatchCount">{items.length} of {result.total.toLocaleString()} matches · refine your search</span>}
    </footer>
  </WorkspaceDialog>;
}
