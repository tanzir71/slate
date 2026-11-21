import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { BlockWrapper, Decoration, EditorView, WidgetType } from "@codemirror/view";

type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];

/** CodeText ranges omit enclosing list/quote markers. Read only when copying. */
export function codeFenceText(state: EditorState, node: MarkdownNode): string {
  const closing = node.lastChild?.name === "CodeMark" && node.lastChild.from !== node.from ? node.lastChild : undefined;
  const first = state.doc.lineAt(node.from).number + 1;
  const last = state.doc.lineAt(closing?.from ?? node.to).number - (closing ? 1 : 0);
  const parts: string[] = [];
  let child = node.firstChild;
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    while (child && (child.name !== "CodeText" || child.to <= line.from)) child = child.nextSibling;
    const from = child && child.from <= line.to ? Math.max(line.from, child.from) : line.to;
    parts.push(state.sliceDoc(from, Math.min(line.to, node.to)));
    if (closing || line.to < node.to) parts.push("\n");
  }
  return parts.join("");
}

class CodeHeader extends WidgetType {
  constructor(private from: number, private to: number, private language: string) { super(); }
  eq(other: CodeHeader) { return this.from === other.from && this.to === other.to && this.language === other.language; }
  toDOM(view: EditorView) {
    const header = document.createElement("span");
    header.className = "cm-slate-code-header";
    header.contentEditable = "false";
    const language = document.createElement("button");
    language.type = "button"; language.className = "cm-slate-code-language";
    language.textContent = this.language || "Plain text";
    language.setAttribute("aria-label", `Show ${this.language || "plain text"} code fence in source`);
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "cm-slate-code-copy"; copy.textContent = "Copy";
    copy.setAttribute("aria-label", "Copy code");
    const status = document.createElement("span");
    status.className = "cm-slate-code-status";
    status.setAttribute("role", "status");
    header.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
    const current = () => {
      if (!header.isConnected) return undefined;
      const node = syntaxTree(view.state).resolveInner(this.from, 1);
      for (let owner: MarkdownNode | null = node; owner; owner = owner.parent)
        if (owner.name === "FencedCode" && owner.from === this.from && owner.to === this.to) return owner;
      return undefined;
    };
    language.addEventListener("click", () => {
      const node = current();
      if (!node) return;
      const position = node.getChild("CodeInfo")?.from ?? node.getChild("CodeMark")!.to;
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true }); view.focus();
    });
    copy.addEventListener("click", () => {
      const node = current();
      if (!node) return;
      const result = (success: boolean) => {
        if (!header.isConnected) return;
        copy.textContent = success ? "Copied" : "Copy failed";
        status.textContent = success ? "Code copied" : "Clipboard access unavailable. Select the code to copy it.";
      };
      try { void navigator.clipboard.writeText(codeFenceText(view.state, node)).then(() => result(true), () => result(false)); }
      catch { result(false); }
    });
    header.append(language, copy, status);
    return header;
  }
  ignoreEvent() { return true; }
}

/** Line decorations retain CodeMirror's virtualized, editable code body. */
export function previewCodeFence(view: EditorView, node: MarkdownNode, active: (from: number, to: number) => boolean,
  wrappers: Range<BlockWrapper>[]): Range<Decoration>[] {
  const { state } = view, opening = state.doc.lineAt(node.from);
  const closing = node.lastChild?.name === "CodeMark" && node.lastChild.from !== node.from ? node.lastChild : undefined;
  const language = node.firstChild?.nextSibling?.name === "CodeInfo" ? node.firstChild.nextSibling : null;
  const ranges: Range<Decoration>[] = [];
  const visited = new Set<number>();
  wrappers.push(BlockWrapper.create({ tagName: "div", rank: 0, attributes: { class: "cm-slate-code-block" } }).range(opening.from, node.to));
  for (const range of view.visibleRanges) {
    const from = Math.max(opening.number, state.doc.lineAt(range.from).number), to = Math.min(state.doc.lineAt(node.to).number, state.doc.lineAt(range.to).number);
    for (let number = from; number <= to; number++) {
      if (visited.has(number)) continue;
      visited.add(number);
      const line = state.doc.line(number), isOpening = number === opening.number, isClosing = closing && state.doc.lineAt(closing.from).number === number;
      const visible = active(line.from, line.to);
      ranges.push(Decoration.line({ class: `cm-slate-code-line${isOpening ? " cm-slate-code-opening" : ""}${isClosing ? " cm-slate-code-closing" : ""}${isClosing && !visible ? " cm-slate-code-hidden-fence" : ""}` }).range(line.from));
      if (isOpening && !visible) ranges.push(Decoration.replace({ widget: new CodeHeader(node.from, node.to, language ? state.sliceDoc(language.from, language.to) : "") }).range(node.from, line.to));
      if (isClosing && !visible) ranges.push(Decoration.replace({}).range(line.from, line.to));
    }
  }
  for (const range of view.visibleRanges) {
    for (let child = node.childAfter(range.from); child && child.from <= range.to; child = child.nextSibling) {
      if (child.name !== "QuoteMark") continue;
      const line = state.doc.lineAt(child.from);
      if (closing && line.number === state.doc.lineAt(closing.from).number && !active(line.from, line.to)) continue;
      ranges.push(Decoration.replace({}).range(child.from, child.to + (state.sliceDoc(child.to, child.to + 1) === " " ? 1 : 0)));
    }
  }
  return ranges;
}
