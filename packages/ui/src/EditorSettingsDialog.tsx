import type { EditorPreferences, SmartListPreferences } from "@slate/core";
import { WorkspaceDialog } from "./browser/WorkspaceDialog";
import "./editorSettings.css";

const rules: readonly {
  id: keyof SmartListPreferences;
  label: string;
  description: string;
}[] = [
  {
    id: "continuation",
    label: "Continue lists and quotes",
    description:
      "Enter continues Markdown markup; Backspace removes an empty marker.",
  },
  {
    id: "indent",
    label: "Indent list items",
    description:
      "Tab and Shift-Tab change a list item’s level, including its children.",
  },
  {
    id: "move",
    label: "Move list items with children",
    description:
      "Alt ↑ and Alt ↓ move whole items and keep numbered lists in order.",
  },
];

export function EditorSettingsDialog({
  preferences,
  onChange,
  onClose,
}: {
  preferences: EditorPreferences;
  onChange(rule: keyof SmartListPreferences, enabled: boolean): void;
  onClose(): void;
}) {
  return (
    <WorkspaceDialog title="Editor settings" onClose={onClose}>
      <div className="editorSettings">
        <p>
          Editor preferences apply on this device. Changes take effect
          immediately.
        </p>
        <fieldset>
          <legend>Smart input</legend>
          {rules.map((rule) => (
            <label className="smartInputRule" key={rule.id}>
              <input
                type="checkbox"
                checked={preferences.smartLists[rule.id]}
                onChange={(event) => onChange(rule.id, event.target.checked)}
                aria-describedby={`smart-input-${rule.id}`}
                aria-labelledby={`smart-input-${rule.id}-label`}
              />
              <span>
                <strong id={`smart-input-${rule.id}-label`}>{rule.label}</strong>
                <small id={`smart-input-${rule.id}`}>{rule.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p>
          Each smart edit is one undo step. Regular editor keys remain available
          when a rule is off.
        </p>
        <div className="editorSettingsActions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </WorkspaceDialog>
  );
}
