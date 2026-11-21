import { Pin } from "lucide-react";
import { useMemo } from "react";
import type { SheetDocument, GoalProgress } from "@slate/core";
import { sheetPreview } from "./sheetPreview";

export function GoalRing({ goal, size = 16 }: { goal: GoalProgress; size?: number }) {
  const progress = Math.max(0, Math.min(1, goal.current / goal.target));
  const units = goal.type === "readingTimeMinutes" ? "min" : goal.type;
  return (
    <span
      className={`goalRing ${goal.complete ? "complete" : ""}`}
      role="img"
      aria-label={`${goal.current.toLocaleString()} of ${goal.target.toLocaleString()} ${units}`}
    >
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
        <circle className="goalRingTrack" cx="10" cy="10" r="7" />
        <circle
          className="goalRingProgress"
          cx="10"
          cy="10"
          r="7"
          strokeDasharray={44}
          strokeDashoffset={44 * (1 - progress)}
        />
      </svg>
      <span>
        {goal.current.toLocaleString()} / {goal.target.toLocaleString()}
      </span>
    </span>
  );
}

export function SheetRow({
  sheet,
  active,
  pinned,
  onOpen,
  draggable,
  disabled = false,
}: {
  sheet: SheetDocument & { preview?: string };
  active: boolean;
  pinned: boolean;
  onOpen(): void;
  draggable: boolean;
  disabled?: boolean;
}) {
  const preview = useMemo(
    () => sheet.preview ?? sheetPreview(sheet.body),
    [sheet.preview, sheet.body],
  );
  const date = sheet.updatedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(sheet.updatedAt)
    : "";
  return (
    <button
      className={`browserSheetRow ${active ? "active" : ""}`}
      data-path={sheet.path}
      aria-current={active ? "true" : undefined}
      draggable={draggable}
      disabled={disabled}
      onDragStart={(event) =>
        event.dataTransfer.setData("slate/sheet-path", sheet.path)
      }
      onClick={onOpen}
    >
      <span className="sheetRowTitle">
        <strong>{sheet.title || "Untitled"}</strong>
        {pinned && <Pin size={11} aria-label="Pinned" />}
        <time dateTime={sheet.updatedAt?.toISOString()}>{date}</time>
      </span>
      <span className="sheetRowPreview">{preview || "Start writing…"}</span>
      <span className="sheetRowMeta">
        {sheet.tags.slice(0, 2).map((tag) => (
          <span className="sheetRowTag" key={tag.path}>
            #{tag.path}
          </span>
        ))}
        {sheet.goal && <GoalRing goal={sheet.goal} />}
        {!sheet.tags.length && !sheet.goal && (
          <small>
            {sheet.path.includes("/")
              ? sheet.path.slice(0, sheet.path.lastIndexOf("/"))
              : "Markdown"}
          </small>
        )}
      </span>
    </button>
  );
}
