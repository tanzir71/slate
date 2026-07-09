export const slateTokens = {
  fonts: {
    ui: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    editor: 'Georgia, "Times New Roman", ui-serif, serif',
    mono: '"SF Mono", "Cascadia Code", ui-monospace, monospace'
  },
  radius: {
    xs: "4px",
    sm: "6px",
    md: "8px"
  },
  colors: {
    background: "#f7f8fa",
    panel: "#ffffff",
    panelMuted: "#f2f5f8",
    border: "#dce2ea",
    text: "#18212f",
    muted: "#6f7b8b",
    accent: "#326bff",
    accentSoft: "#e8f0ff",
    success: "#178a4b",
    warning: "#ce6b00"
  },
  motion: {
    fast: "120ms ease-out",
    standard: "180ms ease-out"
  }
} as const;

export type SlateTokens = typeof slateTokens;

