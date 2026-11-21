import { syntaxTree } from "@codemirror/language";
import { Facet, Prec, StateEffect, StateField, Transaction, type EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { livePreviewSettings } from "./livePreviewSettings.js";
import { previewSourceActive, previewSourceRange } from "./previewSource.js";
import { previewTable } from "./tablePreview.js";
import { codeFenceText } from "./codePreview.js";
import { createDefaultRichPreviewRenderer, type RichPreviewRenderer, type RichPreviewRendererFactory, type RichPreviewRequest, type RichPreviewResult } from "./richPreviewRenderer.js";

export const richPreviewRenderer = Facet.define<RichPreviewRendererFactory, RichPreviewRendererFactory>({ combine: values => values.at(-1) ?? createDefaultRichPreviewRenderer });
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
interface RichPreview extends RichPreviewRequest { from: number; to: number; source: string; anchor: number; fontSize: string }
interface Resource { spec: RichPreview; controller: AbortController; observer?: ResizeObserver }
const resources = new WeakMap<HTMLElement, Resource>();
const sessions = new WeakMap<EditorView, { factory: RichPreviewRendererFactory; renderer: RichPreviewRenderer }>();
const theme = (): "light" | "dark" => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
function enabled(state: EditorState) {
  const settings = state.facet(livePreviewSettings);
  return !!state.facet(richPreviewRenderer) && settings.hideSyntax && !settings.sourceMode;
}
function render(view: EditorView, factory: RichPreviewRendererFactory, request: RichPreviewRequest, signal: AbortSignal) {
  let session = sessions.get(view);
  if (session?.factory !== factory) { session?.renderer.destroy(); session = { factory, renderer: factory() }; sessions.set(view, session); }
  return session.renderer.render(request, signal);
}
function childDocument(result: RichPreviewResult, spec: RichPreview, fontSize: string) {
  const color = spec.theme === "dark" ? "#e7e7e5" : "#1c1c1a";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:${spec.theme}}body{margin:0;color:${color};font:${fontSize} Georgia,serif;text-align:${spec.display ? "center" : "start"}}#slate-rich-content{display:inline-block;max-width:100%}math{color:inherit}svg{max-width:100%;height:auto}a{pointer-events:none}</style><body><span id="slate-rich-content">${result.html}</span></body>`;
}
class RichWidget extends WidgetType {
  constructor(readonly spec: RichPreview, readonly factory: RichPreviewRendererFactory) { super(); }
  eq(other: RichWidget) { return this.factory === other.factory && this.spec.source === other.spec.source && this.spec.from === other.spec.from && this.spec.to === other.spec.to && this.spec.theme === other.spec.theme && this.spec.fontSize === other.spec.fontSize; }
  updateDOM(dom: HTMLElement, _view: EditorView, previous: RichWidget) {
    if (this.factory !== previous.factory || this.spec.body !== previous.spec.body || this.spec.kind !== previous.spec.kind || this.spec.theme !== previous.spec.theme || this.spec.fontSize !== previous.spec.fontSize) return false;
    const resource = resources.get(dom); if (!resource) return false;
    resource.spec = this.spec; return true;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("span"), spec = this.spec;
    dom.className = `cm-slate-rich-preview${spec.display ? " cm-slate-rich-display" : ""}`; dom.contentEditable = "false";
    dom.setAttribute("aria-busy", "true");
    const status = dom.appendChild(document.createElement("span")); status.className = "cm-slate-rich-status"; status.textContent = "Loading preview…";
    const button = dom.appendChild(document.createElement("button")); button.type = "button";
    button.className = "cm-slate-rich-source"; button.textContent = "Source";
    button.setAttribute("aria-label", spec.kind === "math" ? "Show math source" : "Show diagram source");
    const resource: Resource = { spec, controller: new AbortController() }; resources.set(dom, resource);
    dom.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
    dom.addEventListener("click", () => {
      const current = resource.spec;
      if (resource.controller.signal.aborted || !dom.isConnected || view.state.sliceDoc(current.from, current.to) !== current.source) return;
      view.dispatch({ selection: { anchor: current.anchor }, scrollIntoView: true }); view.focus();
    });
    void Promise.resolve().then(() => {
      resource.controller.signal.throwIfAborted();
      return render(view, this.factory, spec, resource.controller.signal);
    }).then(result => {
      if (resource.controller.signal.aborted || !dom.isConnected || !view.dom.isConnected) return;
      const frame = document.createElement("iframe"); frame.title = spec.kind === "math" ? "Math preview" : "Diagram preview";
      frame.tabIndex = -1; frame.setAttribute("sandbox", spec.kind === "math" ? "allow-same-origin" : "");
      frame.setAttribute("scrolling", "no"); frame.referrerPolicy = "no-referrer";
      const fontSize = /^\d+(?:\.\d+)?px$/.test(spec.fontSize) ? spec.fontSize : "18px";
      frame.style.height = `${Math.min(2_000, Math.max(24, result.height ?? 32))}px`;
      if (result.width && !spec.display) frame.style.width = `${Math.ceil(result.width)}px`;
      if (spec.kind === "diagram" && result.width && result.height && typeof ResizeObserver !== "undefined") {
        const width = result.width, height = result.height;
        const resize = () => {
          if (resource.controller.signal.aborted) return;
          frame.style.height = `${Math.ceil(height * Math.min(1, Math.max(1, dom.clientWidth - button.offsetWidth - 4) / width)) + 4}px`; view.requestMeasure();
        };
        resource.observer = new ResizeObserver(resize); resource.observer.observe(dom);
      }
      frame.addEventListener("load", () => {
        if (resource.controller.signal.aborted) return;
        if (spec.kind === "math") {
          const bounds = frame.contentDocument?.querySelector("#slate-rich-content")?.getBoundingClientRect();
          if (bounds?.height) { frame.style.height = `${Math.ceil(bounds.height) + 4}px`; if (!spec.display) frame.style.width = `${Math.ceil(bounds.width) + 4}px`; }
        }
        view.requestMeasure();
      });
      frame.srcdoc = childDocument(result, spec, fontSize); status.textContent = ""; dom.prepend(frame);
      dom.setAttribute("aria-busy", "false"); view.requestMeasure();
    }).catch(() => {
      if (resource.controller.signal.aborted || !dom.isConnected) return;
      status.textContent = spec.kind === "math" ? "Math preview unavailable" : "Diagram preview unavailable";
      dom.setAttribute("aria-busy", "false"); view.requestMeasure();
    });
    return dom;
  }
  destroy(dom: HTMLElement) { const resource = resources.get(dom); resource?.controller.abort(); resource?.observer?.disconnect(); resources.delete(dom); }
  ignoreEvent() { return true; }
}
const setPreviews = StateEffect.define<{ doc: Text; ranges: readonly Range<Decoration>[]; viewport: readonly { from: number; to: number }[] }>();
const decorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(previous, transaction) {
    const { state } = transaction;
    if (!enabled(state) || state.facet(richPreviewRenderer) !== transaction.startState.facet(richPreviewRenderer)) return Decoration.none;
    if (!previous.size && !transaction.effects.some(effect => effect.is(setPreviews))) return previous;
    let result = previous.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setPreviews) && effect.value.doc === state.doc) {
      for (const range of effect.value.viewport) result = result.update({ filterFrom: range.from, filterTo: range.to, filter: (from, to) => from > range.to || to < range.from });
      result = result.update({ add: effect.value.ranges, sort: true });
    }
    transaction.changes.iterChanges((_fromA, _toA, from, to) => {
      result = result.update({ filterFrom: state.doc.lineAt(from).from, filterTo: state.doc.lineAt(to).to, filter: (start, end, decoration) => {
        const widget: unknown = decoration.spec.widget;
        return widget instanceof RichWidget && state.sliceDoc(start, end) === widget.spec.source;
      } });
    });
    for (const range of state.selection.ranges) {
      const scope = previewSourceRange(state, range.from, range.to);
      result = result.update({ filterFrom: scope.from, filterTo: scope.to, filter: (from, to) => !previewSourceActive(state, from, to) });
    }
    return result;
  },
  provide: field => Prec.highest(EditorView.decorations.from(field)),
});
function specification(state: EditorState, node: SyntaxNode): RichPreview | undefined {
  const marks = node.getChildren(node.name === "FencedCode" ? "CodeMark" : "SlateMathMark");
  if (marks.length !== 2) return;
  const source = state.sliceDoc(node.from, node.to), diagram = node.name === "FencedCode";
  if (diagram && state.sliceDoc(node.getChild("CodeInfo")?.from, node.getChild("CodeInfo")?.to).trim().toLowerCase() !== "mermaid") return;
  const body = diagram ? codeFenceText(state, node).replace(/\n$/, "") : mathBody(state, node);
  return { from: node.from, to: node.to, source, anchor: marks[0]!.to, kind: diagram ? "diagram" : "math", display: node.name !== "SlateMathInline", body, theme: theme(), fontSize: "18px" };
}
/** Lezer injects quote marks into inline spans; their raw offsets remain source, not TeX. */
function mathBody(state: EditorState, node: SyntaxNode): string {
  const text = node.getChildren("SlateMathText");
  if (node.name !== "SlateMathInline" || !text.length) return text.map(part => state.sliceDoc(part.from, part.to)).join("\n");
  let owner = node.parent;
  while (owner?.parent && !/^(?:Paragraph|ATXHeading\d|SetextHeading\d|TableCell|TableHeader)$/.test(owner.name)) owner = owner.parent;
  const first = state.doc.lineAt(owner?.from ?? node.from);
  const prefix = state.sliceDoc(first.from, owner?.from ?? node.from), quoteEnd = prefix.lastIndexOf(">") + 1;
  const suffix = quoteEnd ? prefix.slice(quoteEnd).replace(/^[\t ]/, "") : prefix;
  const indentation = [...suffix].reduce((column, character) => character === "\t" ? column + 4 - column % 4 : column + 1, 0);
  return text.map(part => {
    const parts: string[] = [], quotes = part.getChildren("QuoteMark");
    for (let number = state.doc.lineAt(part.from).number; number <= state.doc.lineAt(part.to).number; number++) {
      const line = state.doc.line(number); let from = Math.max(line.from, part.from);
      if (line.from > part.from) {
        const quote = quotes.filter(mark => mark.from >= line.from && mark.to <= line.to).at(-1);
        if (quote) from = quote.to + (/^[\t ]/.test(state.sliceDoc(quote.to, quote.to + 1)) ? 1 : 0);
        for (let column = 0; column < indentation && /^[\t ]/.test(state.sliceDoc(from, from + 1)); from++)
          column += state.sliceDoc(from, from + 1) === "\t" ? 4 - column % 4 : 1;
      }
      parts.push(state.sliceDoc(from, Math.min(line.to, part.to)));
    }
    return parts.join("\n");
  }).join("\n");
}
export function createRichPreviewExtension(): Extension {
  return [decorations, ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private observer: MutationObserver;
    constructor(private view: EditorView) {
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); this.schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.geometryChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.startState.facet(livePreviewSettings) !== update.state.facet(livePreviewSettings) || update.startState.facet(richPreviewRenderer) !== update.state.facet(richPreviewRenderer)) this.schedule();
    }
    schedule() { clearTimeout(this.timer); if (enabled(this.view.state)) this.timer = setTimeout(() => this.refresh(), 0); }
    refresh() {
      const { view } = this, state = view.state, factory = state.facet(richPreviewRenderer); if (!factory || !enabled(state)) return;
      const ranges: Range<Decoration>[] = [], seen = new Set<number>(); let fontSize: string | undefined;
      for (const range of view.visibleRanges) syntaxTree(state).iterate({ from: range.from, to: range.to, enter(reference) {
        const node = reference.node;
        if (node.name === "Table" && !previewTable(state, node)) return false;
        if (/^(?:SlateMathInline|SlateMathBlock|FencedCode)$/.test(node.name)) {
          if (!seen.has(node.from) && !previewSourceActive(state, node.from, node.to)) {
            seen.add(node.from); const spec = specification(state, node);
            if (spec) {
              // Plain notes never need a style/layout read for rich rendering.
              fontSize ??= getComputedStyle(view.contentDOM).fontSize;
              ranges.push(Decoration.replace({ widget: new RichWidget({ ...spec, fontSize }, factory) }).range(spec.from, spec.to));
            }
          }
          return false;
        }
        return /^(?:CodeBlock|HTMLBlock|InlineHTML|Image|SlateFrontmatter|SlateFootnoteDefinition)$/.test(node.name) ? false : undefined;
      } });
      let prior = false;
      for (const range of view.visibleRanges) state.field(decorations).between(range.from, range.to, () => { prior = true; });
      if (ranges.length || prior) view.dispatch({ effects: setPreviews.of({ doc: state.doc, ranges, viewport: view.visibleRanges }), annotations: Transaction.addToHistory.of(false) });
    }
    destroy() { clearTimeout(this.timer); this.observer.disconnect(); sessions.get(this.view)?.renderer.destroy(); sessions.delete(this.view); }
  })];
}
