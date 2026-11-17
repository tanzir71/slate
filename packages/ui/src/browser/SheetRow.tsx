import { Pin } from "lucide-react";
import type { SheetDocument, GoalProgress } from "@slate/core";

export function GoalRing({ goal }: { goal: GoalProgress }) {
  const progress = Math.max(0, Math.min(1, goal.current / goal.target));
  const units = goal.type === "readingTimeMinutes" ? "min" : goal.type;
  return (
    <span
      className={`goalRing ${goal.complete ? "complete" : ""}`}
      role="img"
      aria-label={`${goal.current.toLocaleString()} of ${goal.target.toLocaleString()} ${units}`}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
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
}: {
  sheet: SheetDocument;
  active: boolean;
  pinned: boolean;
  onOpen(): void;
  draggable: boolean;
}) {
  const preview = sheet.body
    .replace(/^#+\s.*$/gm, "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match: string, target: string, label: string | undefined) =>
        label ?? target,
    )
    .replace(/[*_`~]/g, "")
    .trim()
    .slice(0, 115);
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
