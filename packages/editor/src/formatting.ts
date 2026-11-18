import { isolateHistory } from "@codemirror/commands";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { inlineCodeDelimiters } from "./codeDelimiters.js";
import {
  matchCommand,
  resolveCommandKeymap,
  type ResolvedKeymap,
} from "@slate/core";

export function wrapEditorSelection(
  view: EditorView,
  before: string,
  after = before,
  allowEmpty = true,
): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  if (from === to && !allowEmpty) return false;
  const text = view.state.sliceDoc(from, to);
  const star = /^\*+$/.test(before);
  const outside =
    from >= before.length &&
    view.state.sliceDoc(from - before.length, from) === before &&
    view.state.sliceDoc(to, to + after.length) === after &&
    (!star ||
      (view.state.sliceDoc(
        Math.max(0, from - before.length - 1),
        from - before.length,
      ) !== "*" &&
        view.state.sliceDoc(to + after.length, to + after.length + 1) !== "*"));
  const inside =
    text.startsWith(before) &&
    text.endsWith(after) &&
    text.length >= before.length + after.length &&
    (!star ||
      (text[before.length] !== "*" &&
        text[text.length - after.length - 1] !== "*"));
  const start = outside ? from - before.length : from;
  const end = outside ? to + after.length : to;
  const insert = outside
    ? text
    : inside
      ? text.slice(before.length, -after.length)
      : `${before}${text}${after}`;
  view.dispatch({
    changes: { from: start, to: end, insert },
    selection: {
      anchor: start + (outside || inside ? 0 : before.length),
      head: start + insert.length - (outside || inside ? 0 : after.length),
    },
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
  });
  return true;
}

export function toggleEditorTask(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const match = /^(\s*[-*+] \[)([ xX])(\])/.exec(line.text);
  if (!match) return false;
  const from = line.from + match[1]!.length;
  view.dispatch({
    changes: { from, to: from + 1, insert: match[2] === " " ? "x" : " " },
    annotations: isolateHistory.of("full"),
    userEvent: "input.task",
  });
  return true;
}

type BlockKind =
  | "paragraph"
  | "ordered"
  | "bullet"
  | "task"
  | "quote"
  | `heading${1 | 2 | 3 | 4 | 5 | 6}`;
function selectedLines(view: EditorView) {
  const range = view.state.selection.main;
  const first = view.state.doc.lineAt(range.from).number;
  const last = view.state.doc.lineAt(
    range.to > range.from && view.state.doc.lineAt(range.to).from === range.to
      ? range.to - 1
      : range.to,
  ).number;
  return Array.from({ length: last - first + 1 }, (_, index) =>
    view.state.doc.line(first + index),
  );
}

function lineParts(text: string) {
  const match =
    /^(\s*)(?:(#{1,6})\s+|> ?|(?:[-+*]|\d+[.)])\s+(?:\[([ xX])\]\s*)?)/.exec(
      text,
    );
  const indent = match?.[1] ?? /^\s*/.exec(text)![0];
  return {
    indent,
    body: text.slice(match?.[0].length ?? indent.length),
    checked: match?.[3]?.toLowerCase() === "x",
  };
}

export function setEditorBlock(view: EditorView, kind: BlockKind): boolean {
  if (view.state.readOnly) return false;
  const lines = selectedLines(view);
  const existing = (text: string) =>
    kind === "quote"
      ? /^\s*> ?/.test(text)
      : kind === "task"
        ? /^\s*[-+*] \[[ xX]\]/.test(text)
        : kind === "bullet"
          ? /^\s*[-+*] (?!\[)/.test(text)
          : kind === "ordered"
            ? /^\s*\d+[.)] /.test(text)
            : kind.startsWith("heading")
              ? new RegExp(`^\\s*#{${kind.slice(7)}} `).test(text)
              : false;
  const toggleOff =
    kind !== "paragraph" && lines.every((line) => existing(line.text));
  const changes = lines.map((line, index) => {
    const { indent, body, checked } = lineParts(line.text);
    const prefix =
      toggleOff || kind === "paragraph"
        ? ""
        : kind === "quote"
          ? "> "
          : kind === "bullet"
            ? "- "
            : kind === "ordered"
              ? `${index + 1}. `
              : kind === "task"
                ? `- [${checked ? "x" : " "}] `
                : `${"#".repeat(Number(kind.slice(7)))} `;
    return {
      from: line.from,
      to: line.to,
      insert:
        lines.length > 1 && !line.text.trim()
          ? ""
          : `${indent}${prefix}${body}`,
    };
  });
  view.dispatch({
    changes,
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
  });
  return true;
}

function inlineCode(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  const wrapped = /^(`+)( ?)([\s\S]*?)\2\1$/.exec(text);
  if (wrapped && !wrapped[3]!.startsWith("`") && !wrapped[3]!.endsWith("`"))
    return wrapEditorSelection(
      view,
      `${wrapped[1]}${wrapped[2]}`,
      `${wrapped[2]}${wrapped[1]}`,
    );
  const [before, after] = inlineCodeDelimiters(text);
  return wrapEditorSelection(view, before, after);
}

function codeBlock(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const lines = selectedLines(view);
  let from = lines[0]!.from;
  let to = lines.at(-1)!.to;
  const text = view.state.sliceDoc(from, to);
  const fenced = /^(`{3,})[^\n]*\n([\s\S]*)\n\1$/.exec(text);
  const firstNumber = lines[0]!.number;
  const lastNumber = lines.at(-1)!.number;
  const opening =
    firstNumber > 1 ? view.state.doc.line(firstNumber - 1) : undefined;
  const closing =
    lastNumber < view.state.doc.lines
      ? view.state.doc.line(lastNumber + 1)
      : undefined;
  const outerFence = opening && /^(`{3,})[^`]*$/.exec(opening.text);
  const outside = outerFence && closing?.text === outerFence[1];
  if (outside && opening && closing) {
    from = opening.from;
    to = closing.to;
  }
  const fence = "`".repeat(
    Math.max(
      3,
      ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1),
    ),
  );
  const insert = outside
    ? text
    : fenced
      ? fenced[2]!
      : `${fence}\n${text}\n${fence}`;
  const offset = fenced || outside ? 0 : fence.length + 1;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + offset, head: from + insert.length - offset },
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
  });
  return true;
}

const formatHandlers: Readonly<Record<string, (view: EditorView) => boolean>> =
  {
    "format.bold": (view) => wrapEditorSelection(view, "**"),
    "format.italic": (view) => wrapEditorSelection(view, "*"),
    "format.strike": (view) => wrapEditorSelection(view, "~~"),
    "format.highlight": (view) => wrapEditorSelection(view, "=="),
    "format.code": inlineCode,
    "format.comment": (view) => wrapEditorSelection(view, "<!-- ", " -->"),
    "format.link": (view) => wrapEditorSelection(view, "[", "](url)", false),
    "format.paragraph": (view) => setEditorBlock(view, "paragraph"),
    ...Object.fromEntries(
      ([1, 2, 3, 4, 5, 6] as const).map((level) => [
        `format.heading${level}`,
        (view: EditorView) => setEditorBlock(view, `heading${level}`),
      ]),
    ),
    "format.ordered": (view) => setEditorBlock(view, "ordered"),
    "format.bullet": (view) => setEditorBlock(view, "bullet"),
    "format.task": (view) => setEditorBlock(view, "task"),
    "format.quote": (view) => setEditorBlock(view, "quote"),
    "format.codeblock": codeBlock,
    "format.toggleTask": toggleEditorTask,
  };
export const formattingCommandIds = Object.keys(formatHandlers);

export function runFormattingCommand(view: EditorView, id: string): boolean {
  return !view.state.readOnly && (formatHandlers[id]?.(view) ?? false);
}

export function createFormattingBindings(resolved?: ResolvedKeymap): Extension {
  const os =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "mac"
      : "windows";
  const bindings = (
    resolved ?? resolveCommandKeymap({ os, surface: "web" })
  ).bindings.filter((binding) => binding.command.group === "Format");
  function keydown(event: KeyboardEvent, view: EditorView) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      view.composing ||
      !view.hasFocus
    )
      return false;
    const id = matchCommand(
      bindings,
      {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        altGraph: event.getModifierState("AltGraph"),
        isComposing: event.isComposing,
      },
      { editor: true, selection: !view.state.selection.main.empty },
    );
    if (!id || !runFormattingCommand(view, id)) return false;
    event.preventDefault();
    return true;
  }
  // CodeMirror's Android Enter deferral discards modifiers before DOM handlers.
  // Capture only modified Enter; unmodified IME input stays with CodeMirror.
  const androidEnter = ViewPlugin.define((view) => {
    const capture = (event: KeyboardEvent) => {
      if (
        event.key === "Enter" &&
        (event.ctrlKey || event.metaKey || event.altKey) &&
        keydown(event, view)
      )
        event.stopImmediatePropagation();
    };
    if (/Android/.test(navigator.userAgent))
      view.contentDOM.addEventListener("keydown", capture, true);
    return {
      destroy() {
        view.contentDOM.removeEventListener("keydown", capture, true);
      },
    };
  });
  return Prec.high([EditorView.domEventHandlers({ keydown }), androidEnter]);
}
