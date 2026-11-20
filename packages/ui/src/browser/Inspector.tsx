import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type PointerEvent } from "react";
import type { SheetDocument } from "@slate/core";
import type { createCursorStore, MarkdownEditorHandle } from "../commands";
import { inspectorContents, outlineMoveBefore } from "./inspectorContents";
import type { MentionSnapshot } from "./inspectorMentionProtocol";
import type { NativeFileModel } from "./useNativeFileInfo";
import "./inspector.css";

type SectionTarget = NonNullable<ReturnType<MarkdownEditorHandle["sectionTarget"]>>;
type InspectorSection = "Outline" | "Links" | "Info";
const dragType = "application/x-slate-section";

export default function Inspector({ document, documents, path, cursor, readOnly, closeShortcut, onClose, onJump, onOpen, captureMove, mentions, nativeFile, outlineUnavailable }: {
  document: SheetDocument | undefined;
  documents: readonly SheetDocument[];
  path: string;
  cursor: ReturnType<typeof createCursorStore>;
  readOnly: boolean;
  closeShortcut: string;
  onClose(): void;
  onJump(source: string, offset: number): boolean;
  onOpen(path: string): void;
  captureMove(source: string): SectionTarget | undefined;
  nativeFile?: NativeFileModel;
  outlineUnavailable?: string;
  mentions?: { snapshot: MentionSnapshot; busy: boolean; message: string; error: string; canUndo: boolean;
    title(path: string): string; onLink(): void; onUndo(): void };
}) {
  const { outline, backlinks } = useMemo(() => inspectorContents(true, document, documents), [document, documents]);
  const outlineKeys = useMemo(() => {
    const occurrences = new Map<string, number>();
    return outline.map((heading) => {
      const label = `${heading.depth}/${heading.label}`, count = occurrences.get(label) ?? 0;
      occurrences.set(label, count + 1); return `${label}/${count}`;
    });
  }, [outline]);
  const active = useSyncExternalStore(cursor.subscribe, () => {
    const line = cursor.getSnapshot().line; let low = 0, high = outline.length;
    while (low < high) { const middle = (low + high) >>> 1; if (outline[middle]!.line <= line) low = middle + 1; else high = middle; }
    return low - 1;
  });
  const [section, setSection] = useState<InspectorSection>("Outline");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState<number>();
  const [before, setBefore] = useState<number>();
  const [reviewMentions, setReviewMentions] = useState(false);
  const sections = useRef<Partial<Record<InspectorSection, HTMLElement>>>({});
  const drag = useRef<{ index: number; token: string; target: SectionTarget } | undefined>(undefined);
  const touch = useRef<{ pointer: number; index: number; x: number; y: number; target: SectionTarget; moved: boolean; before: number | undefined } | undefined>(undefined);
  const suppressClickUntil = useRef(0);
  const keyboardFocus = useRef<{ source: string; origin: HTMLButtonElement; index: number; headings: string } | undefined>(undefined);
  const bytes = useMemo(() => section === "Info" && document ? new TextEncoder().encode(document.raw).length : undefined, [section, document]);
  const mentionCount = useMemo(() => mentions?.snapshot.status === "ready" ? mentions.snapshot.rows.reduce((count, row) => count + row.plan.changes.length, 0) : undefined, [mentions?.snapshot]);
  const backlinkCount = useMemo(() => backlinks.reduce((count, row) => count + row.count, 0), [backlinks]);
  useLayoutEffect(() => {
    const pending = keyboardFocus.current;
    if (!pending || !document || document.raw === pending.source) return;
    keyboardFocus.current = undefined;
    if (pending.origin.ownerDocument.activeElement === pending.origin && JSON.stringify(outline.map(heading => `${heading.depth}/${heading.label}`)) === pending.headings)
      sections.current.Outline?.querySelectorAll<HTMLButtonElement>(".inspectorHeading")[pending.index]?.focus();
  }, [document?.raw, outline]);

  function resetDrag() { drag.current = undefined; touch.current = undefined; setDragging(undefined); setBefore(undefined); }
  function move(target: SectionTarget | undefined, index: number, destination: number) {
    const changed = target?.move(index, destination) ?? false;
    setNotice(changed ? "Section moved." : "This section could not move. The sheet may have changed; choose the section again.");
    return changed;
  }
  function hover(event: DragEvent, destination: number) {
    if (!drag.current || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move"; setBefore(destination);
  }
  function drop(event: DragEvent, destination: number) {
    const captured = drag.current;
    if (!captured || event.dataTransfer.getData(dragType) !== captured.token) return;
    event.preventDefault(); resetDrag(); move(captured.target, captured.index, destination);
  }
  function startTouch(event: PointerEvent<HTMLElement>, index: number) {
    if (event.pointerType !== "touch" || readOnly || !document || touch.current) return;
    const target = captureMove(document.raw);
    if (!target) { setNotice("The sheet changed. Choose the section again."); return; }
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    touch.current = { pointer: event.pointerId, index, x: event.clientX, y: event.clientY, target, moved: false, before: undefined };
  }
  function moveTouch(event: PointerEvent<HTMLElement>) {
    const captured = touch.current, outlineElement = sections.current.Outline;
    if (!captured || captured.pointer !== event.pointerId || !outlineElement) return;
    if (!captured.moved && Math.hypot(event.clientX - captured.x, event.clientY - captured.y) < 8) return;
    event.preventDefault(); captured.moved = true; setDragging(captured.index); suppressClickUntil.current = performance.now() + 500;
    const row = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".inspectorHeading");
    const bounds = outlineElement.getBoundingClientRect(), last = outlineElement.querySelector<HTMLElement>(".inspectorHeading:last-of-type")?.getBoundingClientRect();
    captured.before = row && outlineElement.contains(row) ? Number(row.dataset.outlineIndex)
      : last && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= last.bottom && event.clientY <= bounds.bottom ? outline.length : undefined;
    setBefore(captured.before);
    const scroll = outlineElement.parentElement, viewport = scroll?.getBoundingClientRect();
    if (scroll && viewport && scroll.scrollHeight > scroll.clientHeight) { if (event.clientY < viewport.top + 24) scroll.scrollBy(0, -12); else if (event.clientY > viewport.bottom - 24) scroll.scrollBy(0, 12); }
  }
  function endTouch(event: PointerEvent<HTMLElement>) {
    const captured = touch.current;
    if (!captured || captured.pointer !== event.pointerId) return;
    event.preventDefault(); resetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (captured.moved && captured.before !== undefined) move(captured.target, captured.index, captured.before);
  }
  function selectSection(next: InspectorSection) {
    if (next === "Info") nativeFile?.refresh();
    setSection(next); sections.current[next]?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  return <aside className="browserInspector" aria-label="Inspector">
    <nav className="inspectorSections" aria-label="Inspector sections">
      {(["Outline", "Links", "Info"] as const).map((label) => <button key={label} type="button" aria-pressed={section === label}
        title={label === "Links" ? `${backlinkCount} incoming links from ${backlinks.length} sheets` : undefined} onClick={() => selectSection(label)}>{label === "Links" ? `Links · ${backlinkCount}` : label}</button>)}
      <button type="button" className="inspectorClose" aria-label="Close inspector" title={`Close inspector (${closeShortcut})`} onClick={onClose}>
        <span className="inspectorGlyph inspectorGlyph--close" aria-hidden="true" />
      </button>
    </nav>
    <div className="inspectorScroll">
      <section ref={(element) => { if (element) sections.current.Outline = element; }} className="inspectorOutline" data-row-drop={before !== undefined && before < outline.length} aria-label="Document outline">
        <p id="outline-move-help" className="visuallyHidden">Choose a heading to jump to it. Drag a heading with a mouse, or its grip with touch, to reorder a whole section. Use Alt and the Up or Down arrow to move it beside sibling sections.</p>
        {outline.map((heading, index) => <button key={outlineKeys[index]} type="button" className="inspectorHeading" aria-label={`Jump to ${heading.label} (H${heading.depth})`}
          style={{ paddingInlineStart: 8 + (heading.depth - 1) * 14 }} data-depth={heading.depth} data-dragging={dragging === index}
          data-drop-before={before === index} data-outline-index={index} aria-current={active === index ? "location" : undefined} aria-describedby="outline-move-help"
          draggable={!readOnly} title={`Jump to ${heading.label}${readOnly ? "" : " · Alt+↑/↓ to move section"}`}
          onClick={(event) => {
            if (event.detail && performance.now() < suppressClickUntil.current) { suppressClickUntil.current = 0; event.preventDefault(); return; }
            if (document && !onJump(document.raw, heading.from)) setNotice("The sheet changed. Wait for its current outline, then choose the heading again.");
          }}
          onKeyDown={(event) => {
            if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || event.getModifierState("AltGraph") ||
              !["ArrowUp", "ArrowDown"].includes(event.key) || readOnly || !document) return;
            event.preventDefault(); const destination = outlineMoveBefore(outline, index, event.key === "ArrowUp" ? "up" : "down");
            if (destination !== undefined) {
              let end = index + 1; while (end < outline.length && outline[end]!.depth > heading.depth) end++;
              const next = destination > index ? destination - (end - index) : destination, labels = outline.map(heading => `${heading.depth}/${heading.label}`);
              const remaining = [...labels.slice(0, index), ...labels.slice(end)];
              keyboardFocus.current = { source: document.raw, origin: event.currentTarget, index: next,
                headings: JSON.stringify([...remaining.slice(0, next), ...labels.slice(index, end), ...remaining.slice(next)]) };
              if (!move(captureMove(document.raw), index, destination)) keyboardFocus.current = undefined;
            }
          }}
          onDragStart={(event) => {
            const target = document && !readOnly ? captureMove(document.raw) : undefined;
            if (!target) { event.preventDefault(); setNotice("The sheet changed. Choose the section again."); return; }
            const token = crypto.randomUUID(); drag.current = { index, token, target }; setDragging(index);
            event.dataTransfer.setData(dragType, token); event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={resetDrag} onDragOver={(event) => hover(event, index)} onDrop={(event) => drop(event, index)}>
          <span className="inspectorGrip" aria-hidden="true" onPointerDown={event => startTouch(event, index)} onPointerMove={moveTouch} onPointerUp={endTouch} onPointerCancel={resetDrag} onLostPointerCapture={resetDrag}>
            <span className="inspectorGlyph inspectorGlyph--grip" /></span><span className="inspectorHeadingLabel">{heading.label}</span><span className="inspectorDepth">H{heading.depth}</span>
        </button>)}
        {!outline.length && <p className="inspectorEmpty">{outlineUnavailable ?? (document ? "Headings appear here." : path ? "Reading the outline…" : "Open a sheet to see its outline.")}</p>}
        {dragging !== undefined && <div className="inspectorOutlineEnd" data-drop-before={before === outline.length} aria-label="End of outline"
          onDragOver={(event) => hover(event, outline.length)} onDrop={(event) => drop(event, outline.length)} />}
      </section>
      <section ref={(element) => { if (element) sections.current.Links = element; }} aria-label="Backlinks">
        <h2 className="inspectorLabel">Backlinks · {backlinkCount}</h2>
        <div className="inspectorBacklinks">{backlinks.map(({ document: source, snippet }) => <button type="button" className="inspectorBacklink" key={source.path} onClick={() => onOpen(source.path)}>
          <span className="inspectorBacklinkTitle"><span className="inspectorGlyph inspectorGlyph--link" aria-hidden="true" />{source.title}</span>
          <span className="inspectorSnippet">{snippet.before}<span>{snippet.label}</span>{snippet.after}</span>
        </button>)}{!backlinks.length && <p className="inspectorEmpty">No backlinks yet.</p>}</div>
      </section>
      {mentions && <section aria-label="Unlinked mentions">
        <div className="inspectorLabel inspectorMentionLabel"><h2><button type="button" className="inspectorMentionToggle" aria-expanded={reviewMentions}
          onClick={() => setReviewMentions(value => !value)}>Unlinked mentions{mentionCount !== undefined ? ` · ${mentionCount}` : ""}</button></h2>
          {mentions.snapshot.status === "ready" && !!mentions.snapshot.rows.length && <button type="button" className="inspectorLinkAll" disabled={readOnly || mentions.busy} onClick={mentions.onLink}>Link all</button>}
        </div>
        {mentions.snapshot.status === "pending" && <p className="inspectorEmpty" role="status">Reading mentions…</p>}
        {mentions.snapshot.status === "unavailable" && <p className="inspectorEmpty" role="status">{mentions.snapshot.error ?? "Mentions are unavailable."}</p>}
        {reviewMentions && mentions.snapshot.status === "ready" && <div className="inspectorBacklinks">{mentions.snapshot.rows.map(row => {
          const first = row.plan.mentions[0]!;
          return <button type="button" className="inspectorBacklink" key={row.path} onClick={() => onOpen(row.path)}>
            <span className="inspectorBacklinkTitle">{mentions.title(row.path)} <span className="inspectorMentionCount">{row.plan.changes.length}</span></span>
            <span className="inspectorSnippet">{row.plan.source.slice(Math.max(0, first.from - 48), first.from).replace(/\s+/g, " ")}<span>{first.text}</span>{row.plan.source.slice(first.to, first.to + 64).replace(/\s+/g, " ")}</span>
          </button>;
        })}{!mentions.snapshot.rows.length && <p className="inspectorEmpty">No unlinked mentions.</p>}</div>}
        {(mentions.busy || mentions.message) && <p className="inspectorEmpty" role="status">{mentions.busy ? "Updating links…" : mentions.message}</p>}
        {mentions.error && <p className="inspectorEmpty" role="alert">{mentions.error}</p>}
        {mentions.canUndo && <button type="button" className="inspectorUndo" disabled={readOnly || mentions.busy} onClick={mentions.onUndo}>Undo linking</button>}
      </section>}
      <section ref={(element) => { if (element) sections.current.Info = element; }} aria-label="File information">
        <h2 className="inspectorLabel">File</h2><div className="inspectorFile"><p className="inspectorFilePath">{nativeFile?.info?.absolutePath ?? (path || "No sheet open")}</p>
          {nativeFile?.info && <button type="button" className="inspectorReveal" onClick={nativeFile.reveal} disabled={nativeFile.revealing} title={nativeFile.info.revealLabel}>
            <span className="inspectorGlyph inspectorGlyph--folder" aria-hidden="true" />{nativeFile.info.revealLabel}</button>}
          {nativeFile?.pending && <p className="inspectorEmpty" role="status">Reading file information…</p>}
          {nativeFile?.error && <><p className="inspectorFileError" role="alert">{nativeFile.error}</p><button type="button" disabled={nativeFile.pending || nativeFile.revealing} onClick={nativeFile.retry}>Try again</button></>}
          {section === "Info" && (document || nativeFile?.info) && <dl className="inspectorDetails">
            {document && <><dt>Words</dt><dd>{document.stats.words.toLocaleString()}</dd><dt>Characters</dt><dd>{document.stats.characters.toLocaleString()}</dd>
              <dt>UTF-8 bytes</dt><dd>{bytes?.toLocaleString()}</dd></>}
            {nativeFile?.info && <><dt>Saved bytes</dt><dd>{nativeFile.info.bytes.toLocaleString()}</dd>
              {nativeFile.info.modifiedAt !== null && <><dt>Modified on disk</dt><dd><time dateTime={new Date(nativeFile.info.modifiedAt).toISOString()}>{new Date(nativeFile.info.modifiedAt).toLocaleString()}</time></dd></>}
            </>}
          </dl>}
          {document?.goal && <><h3>Writing goal</h3><p>{document.goal.current.toLocaleString()} / {document.goal.target.toLocaleString()} {document.goal.type === "readingTimeMinutes" ? "minutes" : document.goal.type}</p>
            <progress aria-label="Writing goal" value={document.goal.current} max={document.goal.target} /></>}
        </div>
      </section>
      <p className="visuallyHidden" role="status">{notice}</p>
    </div>
  </aside>;
}
