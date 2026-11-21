import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { parseMarkdownPreview, type MarkdownPreviewNode } from "@slate/core";
import { editorFrontmatter } from "./frontmatterPreview.js";
import { displayFootnoteLabel, footnoteLabel, normalizedFootnoteLabel } from "./footnoteSyntax.js";

type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];
const cleanup = new WeakMap<HTMLElement, () => void>();
const openPreviews = new WeakMap<EditorView, Set<() => void>>();
let tooltipId = 0;
export function closeFootnotePreviews(view: EditorView): void {
  for (const close of openPreviews.get(view) ?? []) close();
}

function plainNote(node: MarkdownPreviewNode): string {
  if (node.type === "html") return "";
  if (node.children) {
    const separator = /^(?:root|blockquote|list|listItem)$/.test(node.type) ? "\n\n" : "";
    return node.children.map(plainNote).filter(Boolean).join(separator);
  }
  return node.value ?? node.alt ?? "";
}

function stripQuotes(line: string, count: number): string {
  for (let index = 0; index < count; index++) line = line.replace(/^ {0,3}> ?/, "");
  return line;
}
function stripColumns(line: string, columns: number): string {
  let index = 0, column = 0;
  while (column < columns && /[ \t]/.test(line[index] ?? "x")) {
    column += line[index++] === "\t" ? 4 - column % 4 : 1;
  }
  return line.slice(index);
}
function noteBody(state: EditorState, node: MarkdownNode): string {
  const marker = node.getChild("SlateFootnoteLabel")!;
  let quotes = 0;
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === "Blockquote") quotes++;
  const line = state.doc.lineAt(node.from);
  const prefix = stripQuotes(state.sliceDoc(line.from, node.from), quotes);
  const columns = [...prefix].reduce((column, character) => column + (character === "\t" ? 4 - column % 4 : 1), 0);
  const body = state.sliceDoc(marker.to, node.to).split("\n").map((text, index) => index
    ? stripColumns(stripColumns(stripQuotes(text, quotes), columns), 4) : text.trimStart()).join("\n");
  return plainNote(parseMarkdownPreview(body)).trim() || "Empty footnote.";
}

/** Resolve only on hover/focus: no whole-document text parsing on a keystroke. */
function footnoteText(view: EditorView, label: string): string | undefined {
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 5);
  if (!tree) return undefined;
  const metadataEnd = editorFrontmatter(view.state)?.end ?? 0;
  const wanted = normalizedFootnoteLabel(label);
  let found: MarkdownNode | undefined;
  tree.iterate({ enter(reference) {
    const node = reference.node;
    if (found || node.to <= metadataEnd || /^(?:FencedCode|CodeBlock|HTMLBlock|InlineHTML|Image)$/.test(node.name)) return false;
    if (node.name !== "SlateFootnoteDefinition") return undefined;
    const marker = node.getChild("SlateFootnoteLabel")!;
    const candidate = footnoteLabel(view.state.sliceDoc(marker.from, marker.to));
    if (candidate && normalizedFootnoteLabel(candidate) === wanted) found = node;
    return false;
  } });
  return found ? noteBody(view.state, found) : "Footnote definition not found.";
}

export class FootnoteReference extends WidgetType {
  constructor(private from: number, private source: string) { super(); }
  eq(other: FootnoteReference) { return this.from === other.from && this.source === other.source; }
  toDOM(view: EditorView) {
    const root = document.createElement("span"), button = document.createElement("button"), tooltip = document.createElement("span");
    root.className = "cm-slate-footnote"; root.contentEditable = "false";
    const label = footnoteLabel(this.source)!;
    button.type = "button"; button.className = "cm-slate-footnote-reference";
    button.textContent = displayFootnoteLabel(label); button.setAttribute("aria-label", `Footnote ${button.textContent}`);
    tooltip.className = "cm-slate-footnote-tooltip"; tooltip.id = `slate-footnote-${++tooltipId}`;
    tooltip.setAttribute("role", "tooltip"); tooltip.hidden = true;
    const current = () => root.isConnected && view.state.sliceDoc(this.from, this.from + this.source.length) === this.source;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    let parseTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelLeave = () => { clearTimeout(leaveTimer); leaveTimer = undefined; };
    const close = () => { cancelLeave(); clearTimeout(parseTimer); tooltip.hidden = true; button.removeAttribute("aria-describedby"); openPreviews.get(view)?.delete(close); };
    const refresh = () => {
      if (!current() || tooltip.hidden) return;
      const text = footnoteText(view, label);
      tooltip.textContent = text ?? "Loading footnote…"; tooltip.style.visibility = "hidden";
      if (text === undefined) parseTimer = setTimeout(refresh, 25);
      view.requestMeasure({ key: root, read: () => ({ anchor: button.getBoundingClientRect(), tip: tooltip.getBoundingClientRect(), width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }),
        write: ({ anchor, tip, width, height }) => {
          if (!current() || tooltip.hidden) return;
          tooltip.style.left = `${Math.max(8, Math.min(anchor.left, width - tip.width - 8))}px`;
          tooltip.style.top = `${Math.max(8, Math.min(height - tip.height - 8, anchor.bottom + tip.height + 8 <= height ? anchor.bottom + 8 : anchor.top - tip.height - 8))}px`;
          tooltip.style.visibility = "visible";
        } });
    };
    const show = () => {
      if (!current()) return;
      closeFootnotePreviews(view);
      let open = openPreviews.get(view);
      if (!open) openPreviews.set(view, open = new Set());
      open.add(close);
      tooltip.hidden = false;
      button.setAttribute("aria-describedby", tooltip.id);
      refresh();
    };
    button.addEventListener("mouseenter", show); button.addEventListener("focus", show);
    button.addEventListener("blur", close);
    root.addEventListener("mouseenter", cancelLeave);
    root.addEventListener("mouseleave", () => { if (document.activeElement !== button) leaveTimer = setTimeout(close, 200); });
    root.addEventListener("keydown", event => { if (event.key === "Escape" && !tooltip.hidden) { close(); event.preventDefault(); event.stopPropagation(); } });
    button.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
    button.addEventListener("click", show);
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node) || !root.contains(event.target)) close(); };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !tooltip.contains(event.target)) close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true); window.addEventListener("resize", close);
    cleanup.set(root, () => { close(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", close); });
    root.append(button, tooltip); return root;
  }
  destroy(dom: HTMLElement) { cleanup.get(dom)?.(); cleanup.delete(dom); }
  ignoreEvent() { return true; }
}
