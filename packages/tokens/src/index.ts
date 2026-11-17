export * from "./themes";

export const slateTokens = {
  fonts: {
    ui: 'Geist, system-ui, -apple-system, "Segoe UI", sans-serif',
    editor: 'Newsreader, Georgia, ui-serif, serif',
    mono: '"Geist Mono", "Cascadia Code", ui-monospace, monospace'
  },
  radius: {
    xs: "4px",
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    full: "999px"
  },
  colors: {
    background: "var(--bg-app)",
    panel: "var(--bg-panel)",
    panelMuted: "var(--bg-subtle)",
    border: "var(--border-default)",
    text: "var(--text-primary)",
    muted: "var(--text-secondary)",
    accent: "var(--accent-default)",
    accentSoft: "var(--accent-soft)",
    success: "var(--status-success)",
    warning: "var(--status-warning)"
  },
  space: [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96],
  layout: { titlebar: 40, statusbar: 28, sidebar: 248, sheetList: 300, inspector: 280, measure: 680, narrowMeasure: 560, zenMeasure: 640 },
  motion: {
    fast: "120ms cubic-bezier(0.2, 0, 0, 1)",
    standard: "180ms cubic-bezier(0.2, 0, 0, 1)",
    slow: "240ms cubic-bezier(0.2, 0, 0, 1)"
  }
} as const;

export type SlateTokens = typeof slateTokens;

