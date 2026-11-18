import { useEffect, useRef, useState } from "react";
import {
  defaultEditorPreferences,
  parseEditorPreferences,
  type EditorPreferences,
  type SmartListPreferences,
} from "@slate/core";

export const editorPreferenceKey = "slate.editor-preferences";

function readPreferences(): EditorPreferences {
  try {
    return parseEditorPreferences(
      JSON.parse(localStorage.getItem(editorPreferenceKey) ?? "null"),
    );
  } catch {
    return defaultEditorPreferences;
  }
}

export function useEditorPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const current = useRef(preferences);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === editorPreferenceKey || event.key === null) {
        current.current = readPreferences();
        setPreferences(current.current);
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  function change(rule: keyof SmartListPreferences, enabled: boolean) {
    const next: EditorPreferences = {
      version: 1,
      smartLists: { ...current.current.smartLists, [rule]: enabled },
    };
    current.current = next;
    try {
      localStorage.setItem(editorPreferenceKey, JSON.stringify(next));
    } catch {
      /* Editing works without optional preference storage. */
    }
    setPreferences(next);
  }
  return { preferences, change };
}
