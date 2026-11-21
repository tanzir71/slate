import type { WritingFocus } from "@slate/editor";
import type { WorkspaceWritingSnapshot } from "./workspaceWritingModes";

interface Props {
  value: WorkspaceWritingSnapshot;
  disabled: boolean;
  onFocus(value: WritingFocus): void;
  onTypewriter(): void;
  onZen(): void;
}
export function WorkspaceWritingControls({ value, disabled, onFocus, onTypewriter, onZen }: Props) {
  return <div className="workspaceWritingControls">
    <label><span>Writing focus</span><select aria-label="Writing focus" disabled={disabled} value={value.focus}
      onChange={event => { const next = event.target.value; if (next === "none" || next === "paragraph" || next === "sentence") onFocus(next); }}>
      <option value="none">Off</option><option value="paragraph">Paragraph</option><option value="sentence">Sentence</option>
    </select></label>
    <button type="button" aria-label="Typewriter mode" aria-pressed={value.typewriter} disabled={disabled} onClick={onTypewriter}>Typewriter mode</button>
    <button type="button" aria-label="Zen mode" aria-pressed={value.zen} disabled={disabled} onClick={onZen}>Zen mode</button>
  </div>;
}
