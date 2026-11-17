import { useLayoutEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { resolveTheme, themeColors, type ThemePreference } from "@slate/tokens";
import "./appearance.css";

const preferenceKey = "slate.appearance";

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function storedAppearance(): ThemePreference {
  try {
    const value = localStorage.getItem(preferenceKey);
    return isPreference(value) ? value : "system";
  } catch { return "system"; }
}

export function applyAppearance(preference: ThemePreference, systemDark: boolean) {
  const mode = resolveTheme(preference, systemDark);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  for (const [name, value] of Object.entries(themeColors[mode])) root.style.setProperty(`--${name}`, value);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[mode]["bg-app"]);
}

export function useAppearance() {
  const [preference, setPreference] = useState(storedAppearance);
  useLayoutEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => applyAppearance(preference, media?.matches ?? false);
    const changedElsewhere = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) setPreference(storedAppearance());
    };
    update();
    media?.addEventListener("change", update);
    window.addEventListener("storage", changedElsewhere);
    return () => { media?.removeEventListener("change", update); window.removeEventListener("storage", changedElsewhere); };
  }, [preference]);

  function change(value: ThemePreference) {
    try { localStorage.setItem(preferenceKey, value); } catch { /* Appearance works without preference storage. */ }
    setPreference(value);
  }
  return { preference, change };
}

export function AppearanceControl({ preference, onChange }: { preference: ThemePreference; onChange: (value: ThemePreference) => void }) {
  const Icon = preference === "system" ? Monitor : preference === "dark" ? Moon : Sun;
  return <label className="appearanceControl" title="Appearance"><Icon size={15} aria-hidden="true" /><select aria-label="Appearance" value={preference} onChange={(event) => {
    if (isPreference(event.target.value)) onChange(event.target.value);
  }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;
}
