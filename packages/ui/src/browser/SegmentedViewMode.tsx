import { workspaceViewModes, type WorkspaceViewMode } from "./workspaceViewModes";

interface ViewModeProps {
  value: WorkspaceViewMode;
  disabled: boolean;
  className: string;
  onChange(mode: WorkspaceViewMode): void;
}
export function SegmentedViewMode({ value, disabled, className, onChange }: ViewModeProps) {
  return <div className={`segmentedViewMode ${className}`} role="radiogroup" aria-label="Editor view">
    {workspaceViewModes.map((mode, index) => <button key={mode} type="button" role="radio"
      aria-checked={value === mode} disabled={disabled} tabIndex={value === mode ? 0 : -1}
      onClick={() => onChange(mode)} onKeyDown={(event) => {
        const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : offset ? (index + offset + 3) % 3 : undefined;
        if (next === undefined) return;
        event.preventDefault(); onChange(workspaceViewModes[next]!);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]')[next]?.focus();
      }}>{mode[0]!.toUpperCase() + mode.slice(1)}</button>)}
  </div>;
}
