import { EditorView } from "@codemirror/view";

export const livePreviewTheme = EditorView.baseTheme({
  ".cm-content .cm-slate-source-marker": {
    color: "var(--md-marker)",
    textDecoration: "none",
  },
  ".cm-content .cm-slate-high-contrast-marker": {
    color: "var(--text-secondary)",
  },
  ".cm-content .cm-slate-heading": {
    fontWeight: "600",
    lineHeight: "1.3",
    textDecoration: "none",
    paddingBlock: "8px",
  },
  ".cm-content .cm-slate-heading-1": { fontSize: "2em", paddingBlock: "12px" },
  ".cm-content .cm-slate-heading-2": { fontSize: "1.4em" },
  ".cm-content .cm-slate-heading-3": { fontSize: "1.17em" },
  ".cm-content .cm-slate-heading-4, .cm-content .cm-slate-heading-5, .cm-content .cm-slate-heading-6":
    { fontSize: "1em" },
  ".cm-content .cm-slate-strong": { fontWeight: "700" },
  ".cm-content .cm-slate-emphasis": { fontStyle: "italic" },
  ".cm-content .cm-slate-strike": { textDecoration: "line-through" },
  ".cm-content .cm-slate-highlight": {
    backgroundColor: "var(--md-highlight)",
    borderRadius: "2px",
  },
  ".cm-content .cm-slate-inline-code": {
    fontFamily: '"Geist Mono", monospace',
    fontSize: ".82em",
    backgroundColor: "var(--md-code-bg)",
    borderRadius: "3px",
    paddingInline: "3px",
  },
  ".cm-content .cm-slate-link, .cm-content .cm-slate-wiki-link": {
    color: "var(--md-link)",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-content .cm-slate-unresolved-link": { textDecorationStyle: "dashed" },
  ".cm-content .cm-slate-tag": {
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-subtle)",
    font: "12px/1.4 Geist, sans-serif",
    borderRadius: "4px",
    padding: "2px 5px",
  },
  ".cm-content .cm-slate-task-done": {
    color: "var(--text-tertiary)",
    textDecoration: "line-through",
  },
  ".cm-content .cm-slate-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    width: "17px",
    height: "17px",
    minHeight: "17px",
    padding: "0",
    marginInlineEnd: "6px",
    border: "0",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--text-on-accent)",
    cursor: "pointer",
    font: "12px/1 Geist, sans-serif",
  },
  ".cm-content .cm-slate-checkbox-glyph": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "17px",
    height: "17px",
    border: "1px solid var(--border-strong)",
    borderRadius: "4px",
    background: "var(--bg-canvas)",
  },
  '.cm-content .cm-slate-checkbox[aria-checked="true"] .cm-slate-checkbox-glyph':
    {
      background: "var(--accent-default)",
      borderColor: "var(--accent-default)",
    },
  ".cm-content .cm-slate-checkbox:focus-visible": {
    outline: "2px solid var(--accent-default)",
    outlineOffset: "3px",
  },
  ".cm-content .cm-slate-checkbox:disabled": { cursor: "default" },
  ".cm-content .cm-slate-bullet": {
    display: "inline-block",
    width: ".6em",
    color: "var(--text-secondary)",
    textAlign: "center",
  },
  ".cm-content .cm-slate-ordered-marker": {
    color: "var(--text-secondary)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-content .cm-slate-quote-line": {
    borderInlineStart: "2px solid var(--border-strong)",
    paddingInlineStart: "14px",
    color: "var(--text-secondary)",
  },
  ".cm-content .cm-slate-rule": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    backgroundColor: "var(--border-default)",
    verticalAlign: "middle",
  },
  ".cm-content .cm-slate-frontmatter": {
    color: "var(--text-secondary)",
    font: '12px/1.6 "Geist Mono", monospace',
    background: "var(--bg-app)",
  },
  "@media (pointer: coarse)": {
    ".cm-content .cm-slate-checkbox": {
      width: "44px",
      height: "44px",
      minHeight: "44px",
    },
  },
});
