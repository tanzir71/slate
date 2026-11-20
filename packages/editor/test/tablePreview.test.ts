import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { afterEach, expect, it, vi } from "vitest";
import { buildLivePreviewDecorations, createSlateMarkdownExtensions, findEditorWikiLink, knownWikiTargets, livePreviewSettings } from "../src/index";

const source = "| Phase | Scope | Target |\n|---|---|---|\n| Foundation | Blocks, templates, Tidy | Weeks 1–4 |\n| Beta | Snippets, automations, CLI | Weeks 5–8 |\n| Launch | Landing, docs, export presets | Week 9 |";
const views: EditorView[] = [];
const settings = new Compartment();
function editor(markdown: string, readOnly = false) {
  const doc = markdown + "\n\nActive";
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [
      createSlateMarkdownExtensions(), settings.of([]), EditorState.readOnly.of(readOnly),
    ] }),
  });
  views.push(view);
  expect(forceParsing(view, view.state.doc.length, 1_000)).toBe(true);
  return view;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const view of views.splice(0)) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); }
});

it("renders the actual A1 table as four semantic rows and three columns without changing its source", () => {
  const view = editor(source), original = view.state.doc;
  const table = view.dom.querySelector('.cm-slate-table-grid[role="table"]');
  expect(table).not.toBeNull();
  expect(table?.getAttribute("tabindex")).toBe("0");
  expect(table?.getAttribute("aria-label")).toBe("Markdown table");
  expect(table?.querySelectorAll('[role="row"]')).toHaveLength(4);
  expect(Array.from(table!.querySelectorAll('[role="columnheader"]'), cell => cell.textContent)).toEqual(["Phase", "Scope", "Target"]);
  expect(Array.from(table!.querySelectorAll('[role="cell"]'), cell => cell.textContent)).toEqual([
    "Foundation", "Blocks, templates, Tidy", "Weeks 1–4", "Beta", "Snippets, automations, CLI", "Weeks 5–8", "Launch", "Landing, docs, export presets", "Week 9",
  ]);
  expect(view.state.doc).toBe(original);
  expect(view.state.doc.toString()).toBe(source + "\n\nActive");
  expect(undo(view)).toBe(false);
});

it("keeps native DOM positions mapped to the original cell text", () => {
  const view = editor(source);
  const cell = view.dom.querySelector('[role="cell"]');
  expect(cell).not.toBeNull();
  const walker = document.createTreeWalker(cell!, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode()!;
  expect(text.textContent).toBe("Foundation");
  expect(view.posAtDOM(text, 0)).toBe(source.indexOf("Foundation"));
});

it("shows the entire table source when the caret enters any cell and restores its grid without history", () => {
  const raw = "| **Header** |\n|---|\n| *Body* |", view = editor(raw), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-table-grid")).not.toBeNull();
  view.dispatch({ selection: { anchor: raw.indexOf("Body") } });
  expect(view.dom.querySelector(".cm-slate-table-grid")).toBeNull();
  expect(view.contentDOM.textContent).toContain("| **Header** |");
  expect(view.contentDOM.textContent).toContain("| *Body* |");
  view.dispatch({ selection: { anchor: original.length } });
  expect(view.dom.querySelector(".cm-slate-table-grid")).not.toBeNull();
  expect(view.state.doc).toBe(original);
  expect(undo(view)).toBe(false);
});

it.each([true, false])("honors Source mode or visible syntax (sourceMode %s)", sourceMode => {
  const view = editor(source), original = view.state.doc;
  expect(view.dom.querySelector(".cm-slate-table-grid")).not.toBeNull();
  view.dispatch({ effects: settings.reconfigure(livePreviewSettings.of({ sourceMode, hideSyntax: sourceMode, highContrastMarkers: true })) });
  expect(view.dom.querySelector(".cm-slate-table-grid")).toBeNull();
  expect(view.contentDOM.textContent).toContain("| Phase | Scope | Target |");
  view.dispatch({ effects: settings.reconfigure([]) });
  expect(view.dom.querySelector(".cm-slate-table-grid")).not.toBeNull();
  expect(view.state.doc).toBe(original);
});

it("retains inline Markdown, wiki aliases, escaped pipes and entities in cells", () => {
  const raw = "| Value |\n|---|\n| **Bold** *em* ~~gone~~ ==mark== `code` [site](https://example.test) [[Target\\|alias]] #work/project one\\|two &amp; |";
  const view = editor(raw), cell = view.dom.querySelector('[role="cell"]');
  expect(cell).not.toBeNull();
  for (const [kind, text] of [["strong", "Bold"], ["emphasis", "em"], ["strike", "gone"], ["highlight", "mark"], ["inline-code", "code"], ["link", "site"], ["wiki-link", "alias"], ["tag", "#work/project"]]) {
    expect(cell!.querySelector(`.cm-slate-${kind}`)?.textContent).toBe(text);
  }
  expect(cell?.textContent).toContain("one|two &");
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it.each(["Target", "id:01J22222222222222222222222"])("resolves an escaped table alias to its real %s target with original source ranges", target => {
  const raw = `| Link |\n|---|\n| [[${target}\\|alias]] |`, view = editor(raw);
  const expected = target.replace(/^id:/, "");
  view.dispatch({ effects: settings.reconfigure(knownWikiTargets.of(new Set([expected.toLowerCase()]))) });
  const link = view.dom.querySelector(".cm-slate-wiki-link")!;
  expect(link.className).not.toContain("unresolved");
  const from = raw.indexOf("[["), to = raw.indexOf("]]", from) + 2;
  expect(findEditorWikiLink(view, raw.indexOf("alias"))).toMatchObject({ from, to, raw: raw.slice(from, to), target: expected, display: "alias", targetId: target.startsWith("id:") ? expected : undefined });
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it("keeps ordinary wiki-link target backslashes literal outside a table", () => {
  const raw = "[[Target\\|alias]]", view = editor(raw);
  expect(findEditorWikiLink(view, raw.indexOf("alias"))?.target).toBe("Target\\");
});

it("scrolls a focused table with arrow keys without moving the source caret", () => {
  const view = editor(source), grid = view.dom.querySelector<HTMLElement>(".cm-slate-table-grid")!;
  const selection = view.state.selection, original = view.state.doc;
  grid.focus(); grid.scrollLeft = 40;
  grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  expect(grid.scrollLeft).toBe(0);
  expect(view.state.selection).toBe(selection);
  expect(view.state.doc).toBe(original);
});

it("opens the focused table source with Enter without adding history", () => {
  const view = editor(source), original = view.state.doc;
  const grid = view.dom.querySelector<HTMLElement>(".cm-slate-table-grid")!;
  grid.focus(); grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(view.dom.querySelector(".cm-slate-table-grid")).toBeNull();
  expect(document.activeElement).toBe(view.contentDOM);
  expect(view.state.doc).toBe(original);
  expect(undo(view)).toBe(false);
});

it("lets Tab leave the table and requires Enter before text editing", () => {
  const view = editor(source), original = view.state.doc;
  const grid = view.dom.querySelector<HTMLElement>(".cm-slate-table-grid")!;
  grid.focus();
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  grid.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false);
  const typing = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
  grid.dispatchEvent(typing); expect(typing.defaultPrevented).toBe(true);
  expect(view.state.doc).toBe(original);
});

it("pads missing cells, preserves empty cells and keeps extra source cells without displaying them", () => {
  const raw = "| A | B | C |\n|:---|:---:|---:|\n| | x |\n| a | b | c | ignored |", view = editor(raw);
  const cells = Array.from(view.dom.querySelectorAll('[role="cell"]'));
  expect(cells).toHaveLength(6);
  expect(Array.from(view.dom.querySelectorAll('[role="row"]')).slice(1).map(row => Array.from(row.children).filter(cell => cell.getAttribute("role") === "cell").length)).toEqual([3, 3]);
  expect(cells.map(cell => cell.textContent)).toEqual(["", "x", "", "a", "b", "c"]);
  expect(cells[0]?.className).toContain("align-left");
  expect(cells[1]?.className).toContain("align-center");
  expect(cells[2]?.className).toContain("align-right");
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it("keeps adjacent empty cells as independent source-preserving grid cells", () => {
  const raw = "| A | B |\n|---|---|\n|| |", view = editor(raw);
  expect(Array.from(view.dom.querySelectorAll('[role="cell"]'), cell => cell.textContent)).toEqual(["", ""]);
  expect(Array.from(view.dom.querySelectorAll('[role="row"]')).at(-1)?.querySelectorAll(':scope > [role="cell"]')).toHaveLength(2);
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it("renders entity text safely without creating document HTML", () => {
  const raw = "| Value |\n|---|\n| &lt;img onerror=alert(1)&gt; &quot;text&quot; &#128578; |", view = editor(raw);
  expect(view.dom.querySelector('[role="cell"]')?.textContent).toBe('<img onerror=alert(1)> "text" 🙂');
  expect(view.dom.querySelector("img[onerror], script, iframe")).toBeNull();
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it.each(["> ", "- "])("renders a table inside the parsed %j container without losing its prefixes", prefix => {
  const raw = prefix + "| A | B |\n" + (prefix === "- " ? "  " : prefix) + "|---|---|\n" + (prefix === "- " ? "  " : prefix) + "| one | two |";
  const view = editor(raw);
  expect(Array.from(view.dom.querySelectorAll('[role="cell"]'), cell => cell.textContent)).toEqual(["one", "two"]);
  expect(view.dom.querySelector(".cm-slate-table-grid")?.textContent).not.toContain("•");
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it("keeps a nested table inside its callout frame", () => {
  const raw = "> [!NOTE] Nested\n>\n> | A | B |\n> |---|---|\n> | one | two |";
  const view = editor(raw);
  expect(view.dom.querySelector(".cm-slate-callout-container .cm-slate-table-grid")).not.toBeNull();
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it.each([
  "```md\n" + source + "\n```", "<div>\n" + source + "\n</div>", source.split("\n").map(line => "    " + line).join("\n"),
  "---\n" + source + "\n---", "\uFEFF---\n" + source + "\n---", "| Not | a table |\n| words | only |",
])("leaves parser-excluded table-looking source literal: %j", raw => {
  const view = editor(raw);
  expect(view.dom.querySelector(".cm-slate-table-grid")).toBeNull();
  expect(view.state.doc.toString()).toBe(raw + "\n\nActive");
});

it("renders the same grid in a read-only view without adding an undo entry", () => {
  const view = editor(source, true);
  expect(view.dom.querySelector(".cm-slate-table-grid")).not.toBeNull();
  expect(undo(view)).toBe(false);
  expect(view.state.doc.toString()).toBe(source + "\n\nActive");
});

it("decorates only visible table rows without serializing an offscreen body", () => {
  const raw = "| A | B |\n|---|---|\n" + Array.from({ length: 500 }, (_, index) => `| row${index} | data${index} |`).join("\n");
  const view = editor(raw), doc = view.state.doc;
  const from = doc.line(152).from, to = doc.line(153).to;
  vi.spyOn(view, "visibleRanges", "get").mockReturnValue([{ from, to }]);
  vi.spyOn(doc, "toString").mockImplementation(() => { throw new Error("Do not serialize the table body for preview"); });
  const read = doc.sliceString.bind(doc), reads: number[] = [];
  vi.spyOn(doc, "sliceString").mockImplementation((start, end, separator) => {
    reads.push((end ?? doc.length) - start);
    return read(start, end, separator);
  });
  const decorations = buildLivePreviewDecorations(view);
  let cells = 0;
  decorations.between(0, doc.length, (start, end, decoration) => {
    if ((decoration.spec.attributes as Record<string, string> | undefined)?.role !== "cell") return;
    cells++;
    expect(start).toBeGreaterThanOrEqual(from);
    expect(end).toBeLessThanOrEqual(to);
  });
  expect(cells).toBe(4);
  expect(Math.max(...reads)).toBeLessThan(128);
});
