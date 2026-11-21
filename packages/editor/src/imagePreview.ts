import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Facet, StateEffect, StateField, Transaction, type EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parseMarkdownPreview, type MarkdownPreviewNode } from "@slate/core";
import { editorFrontmatter } from "./frontmatterPreview.js";
import { livePreviewSettings } from "./livePreviewSettings.js";

export type LoadPreviewImage = (destination: string, signal: AbortSignal) => Promise<Blob | undefined>;
export const imagePreviewLoader = Facet.define<LoadPreviewImage, LoadPreviewImage | undefined>({ combine: values => values.at(-1) });

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
interface PreviewImage { from: number; to: number; source: string; destination: string; alt: string; href?: string }
interface ImageDOM { spec: PreviewImage; loader: LoadPreviewImage; controller: AbortController; active: boolean; url?: string }
const resources = new WeakMap<HTMLElement, ImageDOM>();
function imageLink(dom: HTMLElement, href: string | undefined) {
  if (href) dom.setAttribute("data-slate-href", href); else dom.removeAttribute("data-slate-href");
  dom.classList.toggle("cm-slate-link", href !== undefined);
}

class ImageWidget extends WidgetType {
  constructor(readonly image: PreviewImage, readonly loader: LoadPreviewImage) { super(); }
  eq(other: ImageWidget) { return this.loader === other.loader && this.image.from === other.image.from && this.image.to === other.image.to && this.image.source === other.image.source && this.image.destination === other.image.destination && this.image.alt === other.image.alt && this.image.href === other.image.href; }
  updateDOM(dom: HTMLElement, _view: EditorView, from: ImageWidget) {
    if (this.loader !== from.loader || this.image.destination !== from.image.destination || this.image.alt !== from.image.alt) return false;
    const record = resources.get(dom); if (!record) return false;
    record.spec = this.image; imageLink(dom, this.image.href); return true;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "cm-slate-image-preview"; button.contentEditable = "false";
    button.setAttribute("aria-label", `Show image source${this.image.alt ? ": " + this.image.alt : ""}`);
    imageLink(button, this.image.href);
    button.setAttribute("aria-busy", "true");
    const placeholder = button.appendChild(document.createElement("span"));
    placeholder.className = "cm-slate-image-status"; placeholder.textContent = "Loading image…";
    if (this.image.alt) {
      const caption = button.appendChild(document.createElement("span"));
      caption.className = "cm-slate-image-caption"; caption.textContent = this.image.alt; caption.setAttribute("aria-hidden", "true");
    }
    const record: ImageDOM = { spec: this.image, loader: this.loader, controller: new AbortController(), active: true };
    resources.set(button, record);
    button.addEventListener("mousedown", event => { if (!event.metaKey && !event.ctrlKey) event.preventDefault(); });
    button.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey || !record.active || !button.isConnected) return;
      const { from, to, source } = record.spec;
      if (view.state.sliceDoc(from, to) !== source) return;
      view.dispatch({ selection: { anchor: from + 2 }, scrollIntoView: true }); view.focus();
    });
    const failed = () => {
      if (!record.active) return;
      if (record.url) { URL.revokeObjectURL(record.url); delete record.url; }
      button.querySelector("img")?.remove(); placeholder.textContent = "Image unavailable";
      button.setAttribute("aria-busy", "false"); view.requestMeasure();
    };
    void Promise.resolve().then(() => record.loader(record.spec.destination, record.controller.signal)).then(blob => {
      if (!record.active || !button.isConnected || !view.dom.isConnected) return;
      if (!blob || !blob.type.startsWith("image/")) { failed(); return; }
      const image = document.createElement("img");
      image.alt = record.spec.alt; image.decoding = "async";
      image.addEventListener("load", () => { if (record.active) { placeholder.textContent = ""; button.setAttribute("aria-busy", "false"); view.requestMeasure(); } });
      image.addEventListener("error", failed);
      record.url = URL.createObjectURL(blob); image.src = record.url; button.prepend(image);
    }).catch(failed);
    return button;
  }
  destroy(dom: HTMLElement) {
    const record = resources.get(dom); if (!record) return;
    record.active = false; record.controller.abort();
    if (record.url) URL.revokeObjectURL(record.url);
    resources.delete(dom);
  }
  ignoreEvent(event: Event) { return !(event instanceof MouseEvent && (event.metaKey || event.ctrlKey)); }
}

const setImages = StateEffect.define<{ doc: Text; ranges: readonly Range<Decoration>[]; viewport: readonly { from: number; to: number }[] }>();
function enabled(state: EditorState) {
  const settings = state.facet(livePreviewSettings);
  return state.facet(imagePreviewLoader) !== undefined && settings.hideSyntax && !settings.sourceMode;
}
function active(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some(range => from <= state.doc.lineAt(range.to).to && to >= state.doc.lineAt(range.from).from);
}

/** Direct decorations may change height or replace multiline Markdown safely. */
const imageDecorations = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(previous, transaction) {
    const { state } = transaction, loader = state.facet(imagePreviewLoader);
    if (!loader || !enabled(state)) return Decoration.none;
    if (loader !== transaction.startState.facet(imagePreviewLoader)) return Decoration.none;
    if (!previous.size && !transaction.effects.some(effect => effect.is(setImages))) return previous;
    let decorations = previous.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setImages) && effect.value.doc === state.doc) {
      for (const range of effect.value.viewport) decorations = decorations.update({ filterFrom: range.from, filterTo: range.to, filter: (from, to) => from > range.to || to < range.from });
      decorations = decorations.update({ add: effect.value.ranges, sort: true });
    }
    transaction.changes.iterChanges((_fromA, _toA, from, to) => {
      decorations = decorations.update({ filterFrom: state.doc.lineAt(from).from, filterTo: state.doc.lineAt(to).to, filter: (start, end, decoration) => {
        const widget: unknown = decoration.spec.widget;
        return widget instanceof ImageWidget && state.sliceDoc(start, end) === widget.image.source;
      } });
    });
    for (const range of state.selection.ranges) decorations = decorations.update({ filterFrom: state.doc.lineAt(range.from).from, filterTo: state.doc.lineAt(range.to).to, filter: (from, to) => !active(state, from, to) });
    return decorations;
  },
  provide: field => EditorView.decorations.from(field),
});

function previewNode(node: MarkdownPreviewNode, kind: "image" | "link"): MarkdownPreviewNode | undefined {
  if (node.type === kind || node.type === kind + "Reference") return node;
  for (const child of node.children ?? []) { const found = previewNode(child, kind); if (found) return found; }
  return undefined;
}
function labelIdentifier(label: string): string | undefined {
  const definition = parseMarkdownPreview(`[${label}]: /slate-image-label`).children?.[0];
  return definition?.type === "definition" && "identifier" in definition && typeof definition.identifier === "string" ? definition.identifier : undefined;
}
function parsedPreview(state: EditorState, node: SyntaxNode, definitions: ReadonlyMap<string, string>, kind: "image" | "link"): MarkdownPreviewNode | undefined {
  const source = state.sliceDoc(node.from, node.to);
  let parsedNode = previewNode(parseMarkdownPreview(source), kind);
  if (!parsedNode) {
    const label = node.getChild("LinkLabel"), marks = node.getChildren("LinkMark");
    const text = label ? state.sliceDoc(label.from + 1, label.to - 1) : "";
    const fallback = marks[1] && state.sliceDoc(node.from + (kind === "image" ? 2 : 1), marks[1].from);
    const key = labelIdentifier(text || fallback || ""), definition = key && definitions.get(key);
    if (definition) {
      const parsed = parseMarkdownPreview(source + "\n\n" + definition), target = parsed.children?.find(child => child.type === "definition");
      const reference = previewNode(parsed, kind);
      if (reference && target?.url !== undefined) parsedNode = { ...reference, url: target.url };
    }
  }
  return parsedNode;
}
function linkOwner(node: SyntaxNode): SyntaxNode | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === "Link") return parent;
  return undefined;
}
function needsDefinitions(node: SyntaxNode) {
  const owner = linkOwner(node);
  return !node.getChild("URL") || !!owner && !owner.getChild("URL");
}
function imageSpec(state: EditorState, node: SyntaxNode, definitions: ReadonlyMap<string, string>): PreviewImage | undefined {
  const image = parsedPreview(state, node, definitions, "image"), owner = linkOwner(node);
  const destination = owner && parsedPreview(state, owner, definitions, "link")?.url;
  const href = destination && /^(https?:|mailto:)/i.test(destination) ? destination : undefined;
  return image?.url !== undefined ? { from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to), destination: image.url, alt: image.alt ?? "", ...(href ? { href } : {}) } : undefined;
}

const excluded = /^(?:FencedCode|CodeBlock|HTMLBlock|InlineHTML|Image|Table|SlateFootnoteDefinition)$/;
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
/** Reference indexing happens in cancellable slices, outside the input transaction. */
async function imageDefinitions(state: EditorState, signal: AbortSignal): Promise<Map<string, string>> {
  let tree = ensureSyntaxTree(state, state.doc.length, 5);
  while (!tree) { signal.throwIfAborted(); await delay(25); tree = ensureSyntaxTree(state, state.doc.length, 5); }
  const definitions = new Map<string, string>(), end = editorFrontmatter(state)?.end ?? 0;
  const stack: SyntaxNode[] = tree.topNode.firstChild ? [tree.topNode.firstChild] : [];
  let deadline = performance.now() + 5;
  while (stack.length) {
    signal.throwIfAborted();
    if (performance.now() >= deadline) { await delay(0); deadline = performance.now() + 5; continue; }
    const node = stack.pop()!;
    if (node.nextSibling) stack.push(node.nextSibling);
    if (node.to <= end || excluded.test(node.name)) continue;
    if (node.name === "LinkReference") {
      const source = state.sliceDoc(node.from, node.to), definition = parseMarkdownPreview(source).children?.[0];
      if (definition?.type === "definition" && "identifier" in definition && typeof definition.identifier === "string" && !definitions.has(definition.identifier)) definitions.set(definition.identifier, source);
    } else if (node.firstChild) stack.push(node.firstChild);
  }
  return definitions;
}

export function createImagePreviewExtension(): Extension {
  return [imageDecorations, ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private request: AbortController | undefined;
    constructor(private view: EditorView) { this.schedule(); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.startState.facet(imagePreviewLoader) !== update.state.facet(imagePreviewLoader) || update.startState.facet(livePreviewSettings) !== update.state.facet(livePreviewSettings) || syntaxTree(update.startState) !== syntaxTree(update.state)) this.schedule();
    }
    schedule() {
      clearTimeout(this.timer); this.request?.abort();
      if (!enabled(this.view.state)) return;
      const request = this.request = new AbortController();
      this.timer = setTimeout(() => { void this.refresh(request.signal).catch(() => { /* A cancelled or unavailable preview leaves source intact. */ }); }, 0);
    }
    async refresh(signal: AbortSignal) {
      const { view } = this, state = view.state, loader = state.facet(imagePreviewLoader);
      if (!loader || !enabled(state)) return;
      const nodes: SyntaxNode[] = [], visited = new Set<number>(), end = editorFrontmatter(state)?.end ?? 0;
      for (const range of view.visibleRanges) syntaxTree(state).iterate({ from: range.from, to: range.to, enter(reference) {
        const node = reference.node;
        if (node.to <= end) return false;
        if (node.name === "Image") {
          if (!visited.has(node.from) && !active(state, node.from, node.to)) { nodes.push(node); visited.add(node.from); }
          return false;
        }
        return excluded.test(node.name) || node.name === "LinkReference" ? false : undefined;
      } });
      let previousVisible = false;
      for (const range of view.visibleRanges) state.field(imageDecorations).between(range.from, range.to, () => { previousVisible = true; });
      if (!nodes.length && !previousVisible) return;
      const definitions = nodes.some(needsDefinitions) ? await imageDefinitions(state, signal) : new Map<string, string>();
      signal.throwIfAborted();
      if (view.state.doc !== state.doc || !enabled(view.state)) return;
      const ranges = nodes.flatMap(node => {
        const image = imageSpec(state, node, definitions);
        return image ? [Decoration.replace({ widget: new ImageWidget(image, loader) }).range(image.from, image.to)] : [];
      });
      view.dispatch({ effects: setImages.of({ doc: state.doc, ranges, viewport: view.visibleRanges }), annotations: Transaction.addToHistory.of(false) });
    }
    destroy() { clearTimeout(this.timer); this.request?.abort(); }
  })];
}
