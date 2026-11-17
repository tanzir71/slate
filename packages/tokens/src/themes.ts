/** Slate / Color, Appendix E of the dated redesign handover. */
export const lightTheme = {
  "bg-app": "#F6F6F4", "bg-panel": "#FAFAF9", "bg-canvas": "#FFFFFF", "bg-raised": "#FFFFFF",
  "bg-hover": "#EFEEEB", "bg-selected": "#ECEEFB", "bg-subtle": "#F2F1EE", "bg-inverse": "#1D1C1A",
  "border-subtle": "#ECEBE7", "border-default": "#E2E1DC", "border-strong": "#CFCDC7", "border-focus": "#3550D6",
  "text-primary": "#1D1C1A", "text-secondary": "#5E5C58", "text-tertiary": "#6E6C66",
  "text-accent": "#3550D6", "text-on-accent": "#FFFFFF", "text-inverse": "#FFFFFF",
  "md-marker": "#B3B1AB", "md-code-bg": "#F3F2EF", "md-highlight": "#FFF0A8", "md-link": "#3550D6",
  "accent-default": "#3550D6", "accent-hover": "#2A43BD", "accent-soft": "#EEF0FC",
  "status-success": "#187A40", "status-warning": "#9A5B00", "status-danger": "#C93A2C",
  "space-work": "#3550D6", "space-blog": "#1F8A4C", "space-research": "#7A4FE0", "space-novel": "#C2570C",
  "icon-default": "#6B6964", "icon-muted": "#9C9A94", "icon-accent": "#3550D6"
} as const;

export type ColorToken = keyof typeof lightTheme;
export type ColorTheme = Readonly<Record<ColorToken, string>>;
export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

export const darkTheme = {
  "bg-app": "#121211", "bg-panel": "#161615", "bg-canvas": "#1B1B1A", "bg-raised": "#232322",
  "bg-hover": "#272725", "bg-selected": "#252942", "bg-subtle": "#1F1F1E", "bg-inverse": "#EDEDEA",
  "border-subtle": "#242422", "border-default": "#2E2D2B", "border-strong": "#3D3C39", "border-focus": "#7B8CFF",
  "text-primary": "#EDEDEA", "text-secondary": "#A8A6A0", "text-tertiary": "#93918B",
  "text-accent": "#8C9BFF", "text-on-accent": "#0F1020", "text-inverse": "#121211",
  "md-marker": "#5C5A56", "md-code-bg": "#242423", "md-highlight": "#5A4C12", "md-link": "#8C9BFF",
  "accent-default": "#7B8CFF", "accent-hover": "#95A3FF", "accent-soft": "#262A45",
  "status-success": "#4CC38A", "status-warning": "#F0A43A", "status-danger": "#F07167",
  "space-work": "#7B8CFF", "space-blog": "#4CC38A", "space-research": "#A98BFF", "space-novel": "#F08A4B",
  "icon-default": "#A8A6A0", "icon-muted": "#6E6C67", "icon-accent": "#8C9BFF"
} as const satisfies ColorTheme;

export const themeColors = { light: lightTheme, dark: darkTheme } as const;

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ThemeMode {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}

/** Portable CSS declarations shared by browser and desktop shells. */
export function themeDeclarations(mode: ThemeMode): string {
  return Object.entries(themeColors[mode]).map(([name, value]) => `--${name}:${value}`).join(";");
}

function luminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected a six-digit color: ${hex}`);
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export interface ContrastFailure { mode: ThemeMode; foreground: ColorToken; background: ColorToken; ratio: number }

/** Text pairs from §6.3. Marker and muted-icon tokens are decorative. */
export function checkThemeContrast(): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  const text: ColorToken[] = ["text-primary", "text-secondary", "text-tertiary", "text-accent", "md-link", "status-success", "status-warning", "status-danger"];
  const surfaces: ColorToken[] = ["bg-app", "bg-panel", "bg-canvas"];
  const pairs: [ColorToken, ColorToken][] = text.flatMap((foreground) => surfaces.map((background): [ColorToken, ColorToken] => [foreground, background]));
  pairs.push(["text-on-accent", "accent-default"], ["text-on-accent", "accent-hover"], ["text-inverse", "bg-inverse"]);
  for (const mode of ["light", "dark"] as const) {
    for (const [foreground, background] of pairs) {
      const ratio = contrastRatio(themeColors[mode][foreground], themeColors[mode][background]);
      if (ratio < 4.5) failures.push({ mode, foreground, background, ratio });
    }
  }
  return failures;
}
