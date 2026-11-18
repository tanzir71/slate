import {
  autocompletion,
  acceptCompletion,
  completionKeymap,
  pickedCompletion,
  closeCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { Facet, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editorTableAt } from "./tableStructure.js";
import { wikiCompletionText, type WikiCompletionTarget } from "@slate/core";
import {
  markdownCompletionQuery,
  type MarkdownCompletionQuery,
} from "./completionQuery.js";

export interface MarkdownCompletionOptions {
  readonly sheets?: readonly WikiCompletionTarget[];
  readonly tags?: readonly string[];
  readonly wiki?: boolean;
  readonly tag?: boolean;
  readonly date?: boolean;
  readonly onPickDate?: (view: EditorView) => void;
}

interface Entry {
  readonly identity: string;
  readonly kind: "wiki" | "tag";
  readonly label: string;
  readonly detail: string;
  readonly insert: string;
  readonly tableInsert: string;
  readonly search: readonly string[];
}

const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const tagPath = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/;

function entries(options: MarkdownCompletionOptions): readonly Entry[] {
  const wiki: Entry[] =
    options.wiki === false
      ? []
      : (options.sheets ?? []).flatMap((sheet) => {
          const insert = wikiCompletionText(sheet);
          return insert
            ? [
                {
                  identity: JSON.stringify([sheet.id, sheet.path, sheet.title]),
                  kind: "wiki" as const,
                  label: sheet.title || sheet.path,
                  detail: sheet.path,
                  insert,
                  tableInsert: wikiCompletionText({ ...sheet, title: "" })!,
                  search: [fold(sheet.title), fold(sheet.path)],
                },
              ]
            : [];
        });
  const tags: Entry[] =
    options.tag === false
      ? []
      : [...new Set(options.tags)]
          .filter((tag) => tagPath.test(tag))
          .map((tag) => ({
            identity: tag,
            kind: "tag",
            label: tag,
            detail: "Tag",
            insert: `#${tag}`,
            tableInsert: `#${tag}`,
            search: [fold(tag)],
          }));
  return [...wiki, ...tags].sort(
    (a, b) =>
      a.label.localeCompare(b.label) || a.detail.localeCompare(b.detail),
  );
}

interface CompletionData {
  readonly entries: readonly Entry[];
  readonly onPickDate: ((view: EditorView) => void) | undefined;
}
const completionData = Facet.define<MarkdownCompletionOptions, CompletionData>({
  combine: (values) => {
    const options = values.at(-1) ?? {};
    return {
      entries: entries(options),
      onPickDate: options.date === false ? undefined : options.onPickDate,
    };
  },
});

function applyEntry(
  view: EditorView,
  completion: Completion,
  entry: Entry,
  from: number,
  to: number,
) {
  const query = markdownCompletionQuery(view.state);
  if (
    view.compositionStarted ||
    !query ||
    query.kind !== entry.kind ||
    query.contentFrom !== from ||
    query.to !== to ||
    !entry.search.some((value) => value.includes(fold(query.query))) ||
    !view.state
      .facet(completionData)
      .entries.some(
        (current) =>
          current.kind === entry.kind && current.identity === entry.identity,
      )
  )
    return;
  const end =
    entry.kind === "wiki" && view.state.sliceDoc(to, to + 2) === "]]"
      ? to + 2
      : to;
  const insert = entry.kind === "wiki" && editorTableAt(view.state, query.from) ? entry.tableInsert : entry.insert;
  view.dispatch({
    changes: { from: query.from, to: end, insert },
    selection: { anchor: query.from + insert.length },
    annotations: [
      isolateHistory.of("full"),
      pickedCompletion.of(completion),
      Transaction.userEvent.of("input.complete"),
    ],
    scrollIntoView: true,
  });
}

function dateResult(
  context: CompletionContext,
  query: MarkdownCompletionQuery,
): CompletionResult | null {
  if (!context.state.facet(completionData).onPickDate) return null;
  return {
    from: query.contentFrom,
    to: query.to,
    filter: false,
    options: [
      {
        label: "Choose date…",
        detail: "YYYY-MM-DD",
        apply(view, _completion, from, to) {
          const current = markdownCompletionQuery(view.state);
          const pick = view.state.facet(completionData).onPickDate;
          if (
            view.compositionStarted ||
            !pick ||
            current?.kind !== "date" ||
            current.contentFrom !== from ||
            current.to !== to
          )
            return;
          closeCompletion(view);
          pick(view);
        },
      },
    ],
  };
}

/** Suggestions are derived from metadata only; ordinary input uses a bounded query. */
export function markdownCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  if (context.view?.compositionStarted) return null;
  const query = markdownCompletionQuery(context.state);
  if (!query) return null;
  if (query.kind === "date") return dateResult(context, query);
  const text = fold(query.query);
  const ranked = context.state
    .facet(completionData)
    .entries.filter((entry) => entry.kind === query.kind)
    .map((entry) => ({
      entry,
      rank: Math.min(
        ...entry.search.map((value) =>
          value === text
            ? 0
            : value.startsWith(text)
              ? 1
              : value.includes(text)
                ? 2
                : 3,
        ),
      ),
    }))
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => a.rank - b.rank);
  if (!ranked.length) return null;
  return {
    from: query.contentFrom,
    to: query.to,
    filter: false,
    options: ranked.map(({ entry }) => ({
      label: entry.label,
      detail: entry.detail,
      apply: (view, completion, from, to) =>
        applyEntry(view, completion, entry, from, to),
    })),
  };
}

export function createMarkdownCompletions(
  options: MarkdownCompletionOptions = {},
): Extension {
  return [
    completionData.of(options),
    autocompletion({
      override: [markdownCompletionSource],
      defaultKeymap: false,
      icons: false,
      maxRenderedOptions: 50,
      interactionDelay: 0,
      tooltipClass: () => "cm-slate-completions",
    }),
    Prec.highest(
      keymap.of([{ key: "Tab", run: acceptCompletion }, ...completionKeymap]),
    ),
    EditorView.theme({
      ".cm-tooltip.cm-slate-completions": {
        backgroundColor: "var(--bg-raised)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-default)",
        borderRadius: "10px",
        boxShadow: "0 12px 32px #0002",
        overflow: "hidden",
        font: "13px/20px var(--font-ui, Geist, Arial, sans-serif)",
        maxWidth: "min(420px, calc(100vw - 24px))",
      },
      ".cm-tooltip.cm-slate-completions > ul": {
        padding: "4px",
        maxHeight: "min(300px, 45vh)",
        fontFamily: "inherit",
      },
      ".cm-tooltip.cm-slate-completions > ul > li": {
        padding: "4px 8px",
        minHeight: "28px",
        boxSizing: "border-box",
        borderRadius: "6px",
      },
      ".cm-tooltip.cm-slate-completions > ul > li[aria-selected]": {
        backgroundColor: "var(--bg-selected)",
        color: "var(--text-primary)",
      },
      ".cm-completionDetail": {
        color: "var(--text-secondary)",
        fontStyle: "normal",
        fontSize: "12px",
        marginLeft: "16px",
      },
      "@media (pointer: coarse)": {
        ".cm-tooltip.cm-slate-completions > ul > li": {
          minHeight: "44px",
          paddingTop: "12px",
          paddingBottom: "12px",
        },
      },
    }),
  ];
}
