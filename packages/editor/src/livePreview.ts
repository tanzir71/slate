import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Facet, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { livePreviewTheme } from "./livePreviewTheme.js";
import { findWikiLinkAtPosition } from "./wikiLinks.js";
import {
  createWikiPathIndex,
  resolveWikiPath,
  type WikiPathIndex,
} from "@slate/core";

export interface LivePreviewSettings {
  hideSyntax: boolean;
  highContrastMarkers: boolean;
  sourceMode?: boolean;
}
const defaults: LivePreviewSettings = {
  hideSyntax: true,
  highContrastMarkers: false,
};
const emptyTargets: ReadonlySet<string> = new Set();
const emptyPaths = createWikiPathIndex<{ readonly path: string }>([]);
export const livePreviewSettings = Facet.define<
  LivePreviewSettings,
  LivePreviewSettings
>({ combine: (values) => values.at(-1) ?? defaults });
export const knownWikiTargets = Facet.define<
  ReadonlySet<string>,
  ReadonlySet<string>
>({ combine: (values) => values.at(-1) ?? emptyTargets });
export const knownWikiPaths = Facet.define<
  WikiPathIndex<{ readonly path: string }>,
  WikiPathIndex<{ readonly path: string }>
>({ combine: (values) => values.at(-1) ?? emptyPaths });
type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];

export function findEditorWikiLink(view: EditorView, position: number) {
  const tree = syntaxTree(view.state);
  for (const side of [1, -1] as const) {
    for (
      let node: MarkdownNode | null = tree.resolveInner(position, side);
      node;
      node = node.parent
    ) {
      if (node.name !== "SlateWikiLink") continue;
      const hit = findWikiLinkAtPosition(
        view.state.sliceDoc(node.from, node.to),
        position - node.from,
      );
      return hit
        ? { ...hit, from: hit.from + node.from, to: hit.to + node.from }
        : undefined;
    }
  }
  return undefined;
}

class StaticGlyph extends WidgetType {
  constructor(private kind: "bullet" | "rule") {
    super();
  }
  eq(other: StaticGlyph) {
    return this.kind === other.kind;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = `cm-slate-${this.kind}`;
    if (this.kind === "bullet") {
      element.textContent = "•";
      element.setAttribute("aria-hidden", "true");
    } else element.setAttribute("role", "separator");
    return element;
  }
}

class TaskCheckbox extends WidgetType {
  constructor(
    private from: number,
    private checked: boolean,
    private label: string,
    private readOnly: boolean,
  ) {
    super();
  }
  eq(other: TaskCheckbox) {
    return (
      this.from === other.from &&
      this.checked === other.checked &&
      this.label === other.label &&
      this.readOnly === other.readOnly
    );
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-slate-checkbox";
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-checked", String(this.checked));
    button.setAttribute("aria-label", this.label || "Task");
    button.disabled = this.readOnly;
    const glyph = document.createElement("span");
    glyph.className = "cm-slate-checkbox-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = this.checked ? "✓" : "";
    button.append(glyph);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (
        view.state.readOnly ||
        !/^\[[ xX]\]$/.test(view.state.sliceDoc(this.from, this.from + 3))
      )
        return;
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.from + 2,
          insert: this.checked ? " " : "x",
        },
        annotations: isolateHistory.of("full"),
        userEvent: "input.task",
      });
    });
    return button;
  }
}

function children(node: MarkdownNode) {
  const nodes: MarkdownNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling)
    nodes.push(child);
  return nodes;
}

function frontmatterEnd(view: EditorView) {
  if (view.state.doc.line(1).text !== "---") return 0;
  for (let number = 2; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    if (line.text === "---") return line.to;
  }
  return 0;
}

/** Only visible syntax nodes are decorated. Rendering never edits the document. */
export function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const settings = state.facet(livePreviewSettings);
  if (settings.sourceMode) return Decoration.none;
  const tree = syntaxTree(state);
  const ranges: Range<Decoration>[] = [];
  const visited = new Set<string>();
  const lineClasses = new Set<string>();
  const metadataEnd = frontmatterEnd(view);
  const activeLines = state.selection.ranges.map((range) => ({
    from: state.doc.lineAt(range.from).from,
    to: state.doc.lineAt(range.to).to,
  }));
  const active = (from: number, to: number) =>
    activeLines.some((line) => from <= line.to && to >= line.from);
  const mark = (
    from: number,
    to: number,
    className: string,
    attributes?: Record<string, string>,
  ) => {
    if (from < to)
      ranges.push(
        Decoration.mark({
          class: className,
          ...(attributes ? { attributes } : {}),
        }).range(from, to),
      );
  };
  const hide = (from: number, to: number) => {
    if (from >= to) return;
    if (settings.hideSyntax && !active(from, to))
      ranges.push(Decoration.replace({}).range(from, to));
    else
      mark(
        from,
        to,
        `cm-slate-source-marker${settings.highContrastMarkers ? " cm-slate-high-contrast-marker" : ""}`,
      );
  };
  const lineClass = (position: number, className: string) => {
    const from = state.doc.lineAt(position).from;
    const key = `${from}:${className}`;
    if (!lineClasses.has(key)) {
      lineClasses.add(key);
      ranges.push(Decoration.line({ class: className }).range(from));
    }
  };
  let references: Map<string, string> | undefined;
  const referenceUrl = (label: string) => {
    if (!references)
      references = new Map(
        tree.topNode.getChildren("LinkReference").flatMap((node) => {
          const label = node.getChild("LinkLabel"),
            url = node.getChild("URL");
          return label && url
            ? [
                [
                  state
                    .sliceDoc(label.from + 1, label.to - 1)
                    .trim()
                    .replace(/\s+/g, " ")
                    .toLowerCase(),
                  state.sliceDoc(url.from, url.to),
                ],
              ]
            : [];
        }),
      );
    return references.get(label.trim().replace(/\s+/g, " ").toLowerCase());
  };

  for (const visible of view.visibleRanges) {
    for (
      let number = state.doc.lineAt(visible.from).number;
      metadataEnd && number <= state.doc.lineAt(visible.to).number;
      number++
    ) {
      const line = state.doc.line(number);
      if (line.from < metadataEnd) lineClass(line.from, "cm-slate-frontmatter");
      else break;
    }
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(reference) {
        const node = reference.node;
        if (
          node.to <= metadataEnd ||
          /^(?:FencedCode|CodeBlock|HTMLBlock|InlineHTML|Image|LinkReference)$/.test(
            node.name,
          )
        )
          return false;
        const key = `${node.name}:${node.from}:${node.to}`;
        if (visited.has(key)) return undefined;
        visited.add(key);
        if (/^ATXHeading[1-6]$/.test(node.name)) {
          lineClass(
            node.from,
            `cm-slate-heading cm-slate-heading-${node.name.at(-1)}`,
          );
          const marker = node.getChild("HeaderMark");
          if (marker)
            hide(
              marker.from,
              marker.to +
                (state.sliceDoc(marker.to, marker.to + 1) === " " ? 1 : 0),
            );
        } else if (
          [
            "StrongEmphasis",
            "Emphasis",
            "Strikethrough",
            "InlineCode",
            "SlateHighlight",
          ].includes(node.name)
        ) {
          const nodes = children(node);
          const first = nodes[0],
            last = nodes.at(-1);
          if (first && last && first !== last) {
            const style = (
              {
                StrongEmphasis: "strong",
                Emphasis: "emphasis",
                Strikethrough: "strike",
                InlineCode: "inline-code",
                SlateHighlight: "highlight",
              } as Record<string, string>
            )[node.name]!;
            mark(first.to, last.from, `cm-slate-${style}`);
            hide(first.from, first.to);
            hide(last.from, last.to);
          }
          if (node.name === "InlineCode") return false;
        } else if (node.name === "Link" || node.name === "Autolink") {
          const nodes = children(node);
          const url = node.getChild("URL");
          const opening = nodes.find((child) => child.name === "LinkMark");
          const closing = nodes.find(
            (child) =>
              child.name === "LinkMark" &&
              state.sliceDoc(child.from, child.to) === "]",
          );
          const from = opening?.to ?? node.from;
          const to = closing?.from ?? url?.to ?? node.to;
          const label = node.getChild("LinkLabel");
          const href = url
            ? state.sliceDoc(url.from, url.to)
            : referenceUrl(
                label
                  ? state.sliceDoc(label.from + 1, label.to - 1) ||
                      state.sliceDoc(from, to)
                  : state.sliceDoc(from, to),
              );
          mark(
            from,
            to,
            "cm-slate-link",
            href ? { "data-slate-href": href } : undefined,
          );
          if (!active(node.from, node.to)) {
            hide(node.from, from);
            hide(to, node.to);
          }
          return undefined;
        } else if (node.name === "SlateWikiLink") {
          const link = findWikiLinkAtPosition(
            state.sliceDoc(node.from, node.to),
            0,
          );
          const target = node.getChild("SlateWikiTarget"),
            label = node.getChild("SlateWikiLabel");
          if (link && target && !active(node.from, node.to)) {
            const resolved =
              state.facet(knownWikiTargets).has(link.target.toLowerCase()) ||
              !!resolveWikiPath(state.facet(knownWikiPaths), link.target);
            const from = label?.from ?? target.from,
              to = label?.to ?? target.to;
            mark(
              from,
              to,
              `cm-slate-wiki-link${resolved ? "" : " cm-slate-unresolved-link"}`,
            );
            hide(node.from, from);
            hide(to, node.to);
          }
          return false;
        } else if (
          node.name === "URL" &&
          !["Link", "Autolink", "LinkReference"].includes(
            node.parent?.name ?? "",
          )
        ) {
          const text = state.sliceDoc(node.from, node.to);
          const href = /^www\./i.test(text)
            ? `https://${text}`
            : /^[^\s@]+@[^\s@]+$/.test(text)
              ? `mailto:${text}`
              : text;
          mark(node.from, node.to, "cm-slate-link", {
            "data-slate-href": href,
          });
        } else if (node.name === "SlateTag" && !active(node.from, node.to)) {
          mark(node.from, node.to, "cm-slate-tag");
        } else if (
          node.name === "TaskMarker" &&
          settings.hideSyntax &&
          !active(node.from, node.to)
        ) {
          const line = state.doc.lineAt(node.from);
          const checked = /[xX]/.test(state.sliceDoc(node.from, node.to));
          const label = state.sliceDoc(node.to, line.to).trim();
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckbox(
                node.from,
                checked,
                label,
                state.readOnly,
              ),
            }).range(node.from, node.to),
          );
          if (checked) mark(node.to, line.to, "cm-slate-task-done");
        } else if (node.name === "ListMark") {
          const task = node.nextSibling?.name === "Task";
          if (task) hide(node.from, node.to + 1);
          else if (
            settings.hideSyntax &&
            !active(node.from, node.to) &&
            /^[-+*]$/.test(state.sliceDoc(node.from, node.to))
          )
            ranges.push(
              Decoration.replace({ widget: new StaticGlyph("bullet") }).range(
                node.from,
                node.to,
              ),
            );
          else mark(node.from, node.to, "cm-slate-ordered-marker");
        } else if (node.name === "QuoteMark") {
          if (!active(node.from, node.to)) {
            lineClass(node.from, "cm-slate-quote-line");
            hide(
              node.from,
              node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0),
            );
          }
        } else if (
          node.name === "HorizontalRule" &&
          settings.hideSyntax &&
          !active(node.from, node.to)
        ) {
          ranges.push(
            Decoration.replace({ widget: new StaticGlyph("rule") }).range(
              node.from,
              node.to,
            ),
          );
        }
        return undefined;
      },
    });
  }
  return Decoration.set(ranges, true);
}

export function createLivePreviewExtension(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildLivePreviewDecorations(view);
        }
        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state) ||
            update.transactions.some((transaction) => transaction.reconfigured)
          )
            this.decorations = buildLivePreviewDecorations(update.view);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    livePreviewTheme,
  ];
}
