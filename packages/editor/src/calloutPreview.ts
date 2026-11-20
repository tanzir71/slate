import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, WidgetType } from "@codemirror/view";

type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];
type CalloutKind = "NOTE" | "TIP" | "WARNING" | "IMPORTANT" | "CAUTION";
export interface EditorCallout {
  readonly from: number;
  readonly to: number;
  readonly markerFrom: number;
  readonly markerTo: number;
  readonly kind: CalloutKind;
  readonly fallbackTitle: string;
}

/** Inspect only the opening marker of a parsed blockquote, never its body. */
export function editorCallout(state: EditorState, node: MarkdownNode): EditorCallout | undefined {
  if (node.name !== "Blockquote") return;
  const line = state.doc.lineAt(node.from);
  const prefix = state.sliceDoc(node.from, Math.min(line.to, node.from + 128));
  const marker = /^(>[\t ]*)\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\](?:[\t ]+|$)/i.exec(prefix);
  if (!marker) return;
  const markerFrom = node.from + marker[1]!.length;
  // Four-space indentation denotes code, even when its bytes resemble a callout.
  if (node.getChild("Paragraph")?.from !== markerFrom) return;
  const kind = marker[2]!.toUpperCase() as CalloutKind;
  const markerTo = node.from + marker[0].length;
  return {
    from: node.from, to: node.to, markerFrom, markerTo, kind,
    fallbackTitle: markerTo < line.to ? "" : kind[0] + kind.slice(1).toLowerCase(),
  };
}

const lightIcon = new URL("./assets/callout-info-light.svg", import.meta.url).href;
const darkIcon = new URL("./assets/callout-info-dark.svg", import.meta.url).href;

export class CalloutLabel extends WidgetType {
  constructor(private callout: EditorCallout) { super(); }
  eq(other: CalloutLabel) {
    return this.callout.markerFrom === other.callout.markerFrom &&
      this.callout.kind === other.callout.kind &&
      this.callout.fallbackTitle === other.callout.fallbackTitle;
  }
  toDOM(view: EditorView) {
    const label = document.createElement("span");
    label.className = "cm-slate-callout-label";
    const icon = label.appendChild(document.createElement("span"));
    icon.className = "cm-slate-callout-icon";
    icon.setAttribute("aria-hidden", "true");
    for (const [theme, source] of [["light", lightIcon], ["dark", darkIcon]] as const) {
      const image = icon.appendChild(document.createElement("img"));
      image.className = `cm-slate-callout-icon-${theme}`;
      image.src = source; image.alt = ""; image.width = 16; image.height = 16;
    }
    label.appendChild(document.createTextNode(this.callout.fallbackTitle));
    label.addEventListener("mousedown", event => {
      if (event.button !== 0 || !label.isConnected || !view.dom.contains(label)) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.callout.markerFrom } });
      view.focus();
    });
    return label;
  }
}
