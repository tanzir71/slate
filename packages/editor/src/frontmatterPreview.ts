import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, StateEffect, StateField, Transaction, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { parseMarkdownProperties, type MarkdownProperties, type MarkdownProperty } from "@slate/core";
import { livePreviewSettings } from "./livePreviewSettings.js";

interface FrontmatterHeader { readonly end: number; readonly scanEnd: number; readonly closed: boolean; readonly model: MarkdownProperties | undefined; }
interface PropertiesPreview { readonly header: FrontmatterHeader | undefined; readonly decorations: DecorationSet; readonly focused: boolean; readonly requested: boolean; }
const propertyFocus = StateEffect.define<boolean>(), propertySource = StateEffect.define<boolean>();
const maxPreviewLength = 65_536;
const maxScanLines = 2_048;
function readHeader(state: EditorState): FrontmatterHeader | undefined {
  const first = state.doc.line(1);
  if (first.length > 128 || !/^\uFEFF?---[\t ]*$/.test(state.sliceDoc(0, first.to))) return;
  const last = Math.min(state.doc.lines, maxScanLines);
  for (let number = 2; number <= last; number++) {
    const line = state.doc.line(number);
    if (line.length <= 128 && /^(?:---|\.\.\.)[\t ]*$/.test(state.sliceDoc(line.from, line.to))) {
      const model = line.to <= maxPreviewLength ? parseMarkdownProperties(state.sliceDoc(0, Math.min(state.doc.length, line.to + 1))) : undefined;
      return { end: line.to, scanEnd: line.to, closed: true, model };
    }
  }
  return { end: state.doc.length, scanEnd: state.doc.line(last).to, closed: false, model: undefined };
}

function plainValue(value: unknown): string {
  if (value === null || value === "") return "Empty";
  if (value instanceof Map) return `${value.size} ${value.size === 1 ? "field" : "fields"}`;
  if (Array.isArray(value)) return value.map((item: unknown) => plainValue(item)).join(", ") || "Empty";
  return String(value);
}
function propertyValue(property: MarkdownProperty, now: number): string {
  const { key, value } = property;
  if (key === "status" && typeof value === "string" && value.toLowerCase() === "draft") return "Draft";
  if (key === "tags") {
    const tags = Array.isArray(value) ? value.filter((tag: unknown): tag is string => typeof tag === "string") : typeof value === "string" ? value.split(",").map(tag => tag.trim()).filter(Boolean) : [];
    if (tags.length) return tags.map(tag => tag.startsWith("#") ? tag : `#${tag}`).join("  ");
  }
  const words: unknown = value instanceof Map ? value.get("words") : value;
  if (key === "goal" && typeof words === "number" && Number.isSafeInteger(words) && words >= 0) return `${words.toLocaleString("en-US")} words`;
  if (key === "updated" && typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value)) {
    const time = Date.parse(value), elapsed = now - time, minutes = Math.floor(Math.abs(elapsed) / 60_000);
    if (Number.isFinite(time)) {
      if (!minutes) return "Just now";
      const amount = minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
      const unit = minutes < 60 ? "min" : minutes < 1440 ? "hr" : "d";
      return elapsed >= 0 ? `${amount} ${unit} ago` : `in ${amount} ${unit}`;
    }
  }
  return plainValue(value);
}

const lightIcon = new URL("./assets/property-plus-light.svg", import.meta.url).href;
const darkIcon = new URL("./assets/property-plus-dark.svg", import.meta.url).href;
const propertyTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const retiredProperties = new WeakSet<HTMLElement>();
const propertyObservers = new WeakMap<HTMLElement, ResizeObserver>();

/** Figma text frames round intrinsic glyph bounds up to whole CSS pixels. */
function alignPropertyText(view: EditorView, row: HTMLElement) {
  if (retiredProperties.has(row) || typeof row.ownerDocument.createRange().getBoundingClientRect !== "function") return;
  view.requestMeasure({ key: row,
    read() {
      if (!row.isConnected || retiredProperties.has(row) || !row.getClientRects().length) return [];
      return Array.from(row.querySelectorAll<HTMLElement>(".cm-slate-property-key, .cm-slate-property-value, .cm-slate-property-add > span:last-child"), node => {
        const range = row.ownerDocument.createRange(); range.selectNodeContents(node);
        return { node, width: `${Math.ceil(range.getBoundingClientRect().width)}px` };
      });
    },
    write(frames) {
      if (!row.isConnected || retiredProperties.has(row)) return;
      let changed = false;
      for (const { node, width } of frames) if (node.style.inlineSize !== width) { node.style.inlineSize = width; changed = true; }
      if (changed) view.requestMeasure();
    },
  });
}

class PropertiesWidget extends WidgetType {
  constructor(private model: MarkdownProperties, private readOnly: boolean) { super(); }
  eq(other: PropertiesWidget) { return this.model.prefix === other.model.prefix && this.readOnly === other.readOnly; }
  get estimatedHeight() { return 24; }
  toDOM(view: EditorView) {
    const row = document.createElement("div");
    const relative: { property: MarkdownProperty; chip: HTMLButtonElement; value: HTMLSpanElement }[] = [];
    row.className = "cm-slate-properties"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Properties");
    const current = () => !retiredProperties.has(row) && row.isConnected && view.state.field(frontmatterPreviewState, false)?.decorations.size
      && view.state.field(frontmatterPreviewState, false)?.header?.model?.prefix === this.model.prefix;
    for (const property of this.model.properties) {
      const chip = document.createElement("button"), key = document.createElement("span"), value = document.createElement("span");
      chip.type = "button"; chip.className = "cm-slate-property"; chip.dataset.key = property.key;
      if (property.key === "status" && typeof property.value === "string" && property.value.toLowerCase() === "draft") chip.dataset.tone = "warning";
      key.className = "cm-slate-property-key"; key.textContent = property.key;
      value.className = "cm-slate-property-value"; value.textContent = propertyValue(property, Date.now());
      chip.setAttribute("aria-label", `Show ${property.key} property in source`); chip.title = `${property.key}: ${value.textContent}`;
      chip.append(key, value);
      if (property.key === "updated" && typeof property.value === "string" && /^\d{4}-\d\d-\d\dT/.test(property.value) && Number.isFinite(Date.parse(property.value))) relative.push({ property, chip, value });
      chip.addEventListener("click", () => {
        if (!current()) return;
        view.dispatch({ selection: { anchor: property.valueFrom }, effects: propertySource.of(true), scrollIntoView: true }); view.focus();
      });
      row.append(chip);
    }
    const add = document.createElement("button"), icon = document.createElement("span"), label = document.createElement("span");
    add.type = "button"; add.className = "cm-slate-property-add"; add.disabled = this.readOnly;
    add.setAttribute("aria-label", "Add property"); icon.className = "cm-slate-property-plus";
    for (const [theme, src] of [["light", lightIcon], ["dark", darkIcon]]) {
      const image = document.createElement("img"); image.className = `cm-slate-property-plus-${theme}`; image.alt = ""; image.src = src!; icon.append(image);
    }
    label.textContent = "Property"; add.append(icon, label);
    add.addEventListener("click", () => {
      if (!current() || view.state.readOnly) return;
      const keys = new Set(this.model.properties.map(property => property.key));
      let name = "property", suffix = 1;
      while (keys.has(name)) name = `property${++suffix}`;
      const from = this.model.closingFrom;
      view.dispatch({ changes: { from, insert: `${name}: \n` }, selection: EditorSelection.range(from, from + name.length),
        effects: propertySource.of(true),
        annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.property")] });
      view.focus();
    });
    row.append(add);
    alignPropertyText(view, row);
    void row.ownerDocument.fonts?.ready.then(() => alignPropertyText(view, row));
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => alignPropertyText(view, row)); observer.observe(row); propertyObservers.set(row, observer);
    }
    if (relative.length) {
      const refresh = () => {
        if (retiredProperties.has(row)) return;
        if (row.isConnected) {
          for (const { property, chip, value } of relative) {
            const text = propertyValue(property, Date.now());
            if (value.textContent !== text) { value.textContent = text; chip.title = `${property.key}: ${text}`; }
          }
          alignPropertyText(view, row);
        }
        propertyTimers.set(row, setTimeout(refresh, 60_001 - Date.now() % 60_000));
      };
      propertyTimers.set(row, setTimeout(refresh, 60_001 - Date.now() % 60_000));
    }
    return row;
  }
  destroy(dom: HTMLElement) {
    retiredProperties.add(dom);
    const timer = propertyTimers.get(dom); if (timer !== undefined) clearTimeout(timer); propertyTimers.delete(dom);
    propertyObservers.get(dom)?.disconnect(); propertyObservers.delete(dom);
  }
}

function decorations(state: EditorState, header: FrontmatterHeader | undefined, editing: boolean): DecorationSet {
  const settings = state.facet(livePreviewSettings);
  if (!header?.model || settings.sourceMode || !settings.hideSyntax || editing && state.selection.ranges.some(range => range.from <= header.end)) return Decoration.none;
  return Decoration.set([Decoration.replace({ block: true, widget: new PropertiesWidget(header.model, state.readOnly), inclusive: false }).range(0, header.end)]);
}
export const frontmatterPreviewState = StateField.define<PropertiesPreview>({
  create(state) { const header = readHeader(state); return { header, focused: false, requested: false, decorations: decorations(state, header, false) }; },
  update(value, transaction) {
    const changed = transaction.docChanged && transaction.changes.touchesRange(0, value.header?.scanEnd ?? Math.min(128, transaction.startState.doc.length));
    let header = changed ? readHeader(transaction.state) : value.header;
    if (!changed && transaction.docChanged && header && !header.closed) header = { ...header, end: transaction.newDoc.length };
    let { focused, requested } = value;
    for (const effect of transaction.effects) {
      if (effect.is(propertyFocus)) { focused = effect.value; if (!focused) requested = false; }
      if (effect.is(propertySource)) requested = effect.value;
    }
    if (!header || !transaction.state.selection.ranges.some(range => range.from <= header.end)) requested = false;
    return transaction.docChanged || transaction.selection || transaction.reconfigured || focused !== value.focused || requested !== value.requested
      ? { header, focused, requested, decorations: decorations(transaction.state, header, focused || requested) } : value;
  },
  provide: field => [EditorView.decorations.from(field, value => value.decorations), EditorView.focusChangeEffect.of((_state, focused) => propertyFocus.of(focused))],
});

export function editorFrontmatter(state: EditorState): FrontmatterHeader | undefined {
  const preview = state.field(frontmatterPreviewState, false);
  return preview ? preview.header : readHeader(state);
}
