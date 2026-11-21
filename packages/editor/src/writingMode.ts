import { syntaxTree } from "@codemirror/language";
import { Facet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export type WritingFocus = "none" | "paragraph" | "sentence";
export interface WritingModeOptions { focus: WritingFocus; typewriter: boolean; zen: boolean }
const defaults: WritingModeOptions = { focus: "none", typewriter: false, zen: false };
const settings = Facet.define<WritingModeOptions, WritingModeOptions>({ combine: values => values.at(-1) ?? defaults });
let sentences: Intl.Segmenter | undefined;
interface FocusRange { from: number; to: number }

function paragraph(state: EditorState, position: number): FocusRange {
  for (let node = syntaxTree(state).resolveInner(position, -1); node; node = node.parent!) {
    if (/^(?:Paragraph|ATXHeading[1-6]|SetextHeading[12]|FencedCode|CodeBlock|SlateMathBlock|HorizontalRule)$/.test(node.name))
      return { from: node.from, to: node.to };
  }
  const line = state.doc.lineAt(position); return { from: line.from, to: line.to };
}

function sentence(state: EditorState, position: number): FocusRange {
  const block = paragraph(state, position), text = state.sliceDoc(block.from, block.to);
  sentences ??= new Intl.Segmenter(undefined, { granularity: "sentence" });
  const part = sentences.segment(text).containing(Math.max(0, Math.min(position - block.from, text.length - 1)));
  return part ? { from: block.from + part.index, to: block.from + part.index + part.segment.length } : block;
}

function focusRanges(state: EditorState, focus: WritingFocus): FocusRange[] {
  const range = focus === "sentence" ? sentence : paragraph;
  const sorted = state.selection.ranges.map(selection => ({ from: range(state, selection.from).from, to: range(state, selection.to).to })).sort((a, b) => a.from - b.from);
  const merged: FocusRange[] = [];
  for (const current of sorted) {
    const previous = merged.at(-1);
    if (previous && current.from <= previous.to) previous.to = Math.max(previous.to, current.to); else merged.push(current);
  }
  return merged;
}

function decorations(view: EditorView): DecorationSet {
  const options = view.state.facet(settings);
  if (options.focus === "none" && !options.zen) return Decoration.none;
  const active = options.focus === "none" ? [] : focusRanges(view.state, options.focus), ranges: Range<Decoration>[] = [], seen = new Set<number>();
  for (const visible of view.visibleRanges) for (let position = visible.from; position <= visible.to;) {
    const line = view.state.doc.lineAt(position); position = line.to + 1;
    if (seen.has(line.from)) continue; seen.add(line.from);
    const overlapping = active.filter(range => range.from <= line.to && range.to >= line.from);
    const classes = [options.zen && !line.text.trim() ? "cm-writing-gap" : "", options.focus !== "none" && !overlapping.length ? "cm-writing-dim" : ""].filter(Boolean);
    if (classes.length) ranges.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
    if (options.focus !== "sentence" || !overlapping.length) continue;
    let from = line.from;
    for (const range of overlapping) {
      const before = Math.min(line.to, range.from);
      if (from < before) ranges.push(Decoration.mark({ class: "cm-writing-dim" }).range(from, before));
      from = Math.max(from, range.to);
    }
    if (from < line.to) ranges.push(Decoration.mark({ class: "cm-writing-dim" }).range(from, line.to));
  }
  return Decoration.set(ranges, true);
}

/** Place the caret's centre at45% of its scroll viewport; no document position changes. */
export function typewriterScrollTop(scrollTop: number, viewportTop: number, viewportHeight: number, caretTop: number, caretBottom: number): number {
  return Math.max(0, scrollTop + (caretTop + caretBottom) / 2 - viewportTop - viewportHeight * 0.45);
}

const writingView = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private observer: ResizeObserver | undefined;
  private height = 0;
  private destroyed = false;
  constructor(private view: EditorView) {
    this.decorations = decorations(view); this.observe(); this.center();
  }
  update(update: ViewUpdate) {
    const before = update.startState.facet(settings), after = update.state.facet(settings), changed = before !== after;
    if (changed || update.docChanged || update.selectionSet || update.viewportChanged ||
      after.focus !== "none" && syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorations(update.view);
    if (before.typewriter !== after.typewriter) this.observe();
    if (changed || update.selectionSet || update.docChanged && update.view.hasFocus || update.focusChanged && update.view.hasFocus || update.transactions.some(transaction => transaction.reconfigured)) this.center();
  }
  private observe() {
    this.observer?.disconnect(); this.observer = undefined;
    if (this.view.state.facet(settings).typewriter && typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => { if (this.view.hasFocus) this.center(); });
      this.observer.observe(this.view.scrollDOM);
    }
  }
  center() {
    if (!this.view.state.facet(settings).typewriter) return;
    this.view.requestMeasure({ key: this,
      read: view => {
        if (this.destroyed || !view.dom.isConnected || !view.state.facet(settings).typewriter || view.composing || !view.scrollDOM.clientHeight) return undefined;
        const caret = view.coordsAtPos(view.state.selection.main.head); if (!caret) return undefined;
        return { height: view.scrollDOM.clientHeight, top: typewriterScrollTop(view.scrollDOM.scrollTop, view.scrollDOM.getBoundingClientRect().top, view.scrollDOM.clientHeight, caret.top, caret.bottom) };
      },
      write: (measurement, view) => {
        if (!measurement || this.destroyed || !view.state.facet(settings).typewriter) return;
        if (measurement.height !== this.height) {
          this.height = measurement.height; view.dom.style.setProperty("--writing-viewport-height", measurement.height + "px");
          this.center(); return;
        }
        if (Math.abs(view.scrollDOM.scrollTop - measurement.top) > 0.5) view.scrollDOM.scrollTop = measurement.top;
      },
    });
  }
  destroy() { this.destroyed = true; this.observer?.disconnect(); this.view.dom.style.removeProperty("--writing-viewport-height"); }
}, { decorations: view => view.decorations });

export function createWritingModeExtensions(options: Partial<WritingModeOptions> = {}): Extension[] {
  const value = { ...defaults, ...options };
  if (value.focus === "none" && !value.typewriter && !value.zen) return [];
  return [settings.of(value), writingView,
    EditorView.editorAttributes.compute([settings], state => {
      const value = state.facet(settings);
      return { class: [value.typewriter ? "cm-writing-typewriter" : "", value.focus !== "none" ? "cm-writing-focus" : "", value.zen ? "cm-writing-zen" : ""].filter(Boolean).join(" "), "data-writing-focus": value.focus };
    }),
    EditorView.scrollHandler.of(view => {
      if (!view.state.facet(settings).typewriter || view.composing) return false;
      view.plugin(writingView)?.center(); return true;
    }),
    EditorView.domEventHandlers({ compositionend(_event, view) { view.plugin(writingView)?.center(); } }),
    EditorView.baseTheme({
      ".cm-writing-dim": { opacity: "0.3" },
      "&.cm-writing-typewriter .cm-content": { paddingTop: "max(24px, calc(var(--writing-viewport-height, 100vh) * .45))", paddingBottom: "max(100px, calc(var(--writing-viewport-height, 100vh) * .55))" },
      "&.cm-writing-zen .cm-writing-gap": { lineHeight: "26px" },
    }),
  ];
}
