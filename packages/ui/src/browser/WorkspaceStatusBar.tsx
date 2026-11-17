import { useState, useSyncExternalStore } from "react";
import type { GoalProgress, SheetStats } from "@slate/core";
import type { createCursorStore } from "../commands";
import { GoalRing } from "./SheetRow";
import { WorkspaceDialog } from "./WorkspaceDialog";

interface StatusBarProps {
  saveState: string;
  path: string;
  content: string;
  unsupported: boolean;
  stats: SheetStats | undefined;
  goal: GoalProgress | undefined;
  cursor: ReturnType<typeof createCursorStore>;
  onSave(): void;
  onGoal(): void;
  onJump(line: number): void;
}
export function WorkspaceStatusBar({
  saveState,
  path,
  content,
  unsupported,
  stats,
  goal,
  cursor,
  onSave,
  onGoal,
  onJump,
}: StatusBarProps) {
  const position = useSyncExternalStore(
    cursor.subscribe,
    cursor.getSnapshot,
    cursor.getSnapshot,
  );
  const [info, setInfo] = useState<"stats" | "file" | "line">();
  const [line, setLine] = useState(1);
  const lineEnding = /\r\n/.test(content)
    ? /(^|[^\r])\n/.test(content)
      ? "Mixed"
      : "CRLF"
    : /\r/.test(content)
      ? "CR"
      : "LF";
  return (
    <>
      <footer className="workspaceStatus">
        <button
          className="saveStateControl"
          title={
            unsupported || saveState === "Read-only"
              ? "File information"
              : "Save current changes"
          }
          onClick={() => {
            if (unsupported || saveState === "Read-only") setInfo("file");
            else onSave();
          }}
        >
          <span
            className={`saveDot ${saveState === "Saved" ? "saved" : "pending"}`}
            aria-hidden="true"
          />
          <span role="status">{unsupported ? "Read-only" : saveState}</span>
        </button>
        <button
          className="fileFormatControl"
          title="File information"
          onClick={() => setInfo("file")}
        >
          {unsupported ? "Original bytes" : `Markdown · UTF-8 · ${lineEnding}`}
        </button>
        <span className="statusSpacer" />
        {goal && (
          <button
            className="goalStatusControl"
            title="Writing goal"
            onClick={onGoal}
          >
            <GoalRing goal={goal} />
            <span>
              {goal.type === "readingTimeMinutes" ? "min" : goal.type}
            </span>
          </button>
        )}
        <button
          title="Writing statistics"
          aria-label="Writing statistics"
          onClick={() => setInfo("stats")}
        >
          {unsupported ? "—" : (stats?.words ?? 0).toLocaleString()} words
        </button>
        <button
          className="readingTimeControl"
          title="Reading time"
          onClick={() => setInfo("stats")}
        >
          {unsupported ? "—" : (stats?.readingTimeMinutes ?? 0)} min read
        </button>
        <button
          className="cursorControl"
          title="Go to line"
          aria-label="Go to line"
          onClick={() => {
            setLine(position.line);
            setInfo("line");
          }}
        >
          Ln {position.line}, Col {position.column}
        </button>
      </footer>
      {info && (
        <WorkspaceDialog
          title={
            info === "stats"
              ? "Writing statistics"
              : info === "file"
                ? "File information"
                : "Go to line"
          }
          onClose={() => setInfo(undefined)}
        >
          {info === "line" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const destination = line;
                setInfo(undefined);
                requestAnimationFrame(() => onJump(destination));
              }}
            >
              <label>
                Line number
                <input
                  autoFocus
                  type="number"
                  min={1}
                  max={position.lines}
                  value={line}
                  required
                  onChange={(event) => setLine(Number(event.target.value))}
                />
              </label>
              <div className="dialogActions">
                <button type="submit" className="primaryButton">
                  Go
                </button>
              </div>
            </form>
          ) : (
            <dl className="workspaceInfoGrid">
              {info === "stats" ? (
                <>
                  <dt>Words</dt>
                  <dd>{stats?.words.toLocaleString() ?? "—"}</dd>
                  <dt>Characters</dt>
                  <dd>{stats?.characters.toLocaleString() ?? "—"}</dd>
                  <dt>Lines</dt>
                  <dd>{position.lines.toLocaleString()}</dd>
                  <dt>Reading time</dt>
                  <dd>{stats?.readingTimeMinutes ?? "—"} min</dd>
                </>
              ) : (
                <>
                  <dt>File</dt>
                  <dd>{path || "No sheet selected"}</dd>
                  <dt>Format</dt>
                  <dd>Markdown</dd>
                  <dt>Encoding</dt>
                  <dd>
                    {unsupported ? "Convert a copy to UTF-8 to edit" : "UTF-8"}
                  </dd>
                  <dt>Line endings</dt>
                  <dd>{unsupported ? "—" : lineEnding}</dd>
                </>
              )}
            </dl>
          )}
        </WorkspaceDialog>
      )}
    </>
  );
}
