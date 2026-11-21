import type { GoalProgress } from "@slate/core";
import { GoalRing } from "./SheetRow";
import type { WorkspaceWritingSnapshot } from "./workspaceWritingModes";

interface Props {
  title: string;
  goal: GoalProgress | undefined;
  writable: boolean;
  writing: WorkspaceWritingSnapshot;
  focusShortcut: string;
  onGoal(): void;
  onExit(): void;
  onFocus(): void;
}
export function WorkspaceZenHud({ title, goal, writable, writing, focusShortcut, onGoal, onExit, onFocus }: Props) {
  const progress = goal ? Math.max(0, Math.min(1, goal.current / goal.target)) : 0;
  const units = goal?.type === "readingTimeMinutes" ? "minutes" : goal?.type;
  return <>
    <div className="workspaceZenHud" role="group" aria-label="Writing session">
      <span className="zenSheetTitle">{title}</span><span aria-hidden="true">·</span>
      <button className="zenGoal" onClick={onGoal} aria-label="Writing goal">
        {goal ? <GoalRing goal={goal} size={14} /> : writable ? "Set a writing goal" : "No writing goal"}
      </button>
    </div>
    <div className="workspaceZenHints">
      <button onClick={onExit} aria-label="Exit Zen"><kbd>Esc</kbd><span>exit Zen</span></button>
      <button onClick={onFocus} aria-pressed={writing.focus !== "none"}><kbd>{focusShortcut}</kbd><span>{writing.preferredFocus} focus</span></button>
    </div>
    <div className={`workspaceSessionProgress ${goal?.complete ? "complete" : ""}`} {...(goal ? {
      role: "progressbar", "aria-label": "Writing goal progress", "aria-valuemin": 0, "aria-valuemax": 100,
      "aria-valuenow": Math.round(progress * 100), "aria-valuetext": `${goal.current} of ${goal.target} ${units}`,
    } : { "aria-hidden": true })}><span style={{ inlineSize: progress * 100 + "%" }} /></div>
  </>;
}
