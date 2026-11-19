import { useEffect, useMemo, useRef, useState } from "react";
import {
  writeTidyConfiguration,
  type TidyPreset,
} from "@slate/core/tidy/settings";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { useTidyReview } from "./useTidyReview";
import type { TidyFile } from "@slate/storage/browser-tidy";
import { TidyIcon } from "./TidyIcon";
import { tidyPreviews } from "./tidyPreviews";
import "./tidy.css";

export default function TidyPanel({
  review,
  readOnly,
  onClose,
  onJump,
}: {
  review: ReturnType<typeof useTidyReview>;
  readOnly: boolean;
  onClose(): void;
  onJump(line: number): void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [limit, setLimit] = useState(100);
  const [settings, setSettings] = useState<string>();
  const settingsSnapshot = useRef<TidyFile | undefined>(undefined);
  function openSettings(source: string) {
    settingsSnapshot.current = review.file;
    setSettings(source);
  }
  const report = review.report;
  const fixes = useMemo(
    () => report?.issues.filter((issue) => issue.changes.length).length ?? 0,
    [report],
  );
  const previews = useMemo(
    () => (report ? tidyPreviews(report, limit) : []),
    [report, limit],
  );
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const disabled = readOnly || review.busy || review.saving || !report;
  const editableSettings =
    review.file && ["valid", "invalid", "missing"].includes(review.file.status);
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="tidyPanel"
      aria-label="Tidy review"
      onKeyDown={(event) => {
        if (event.key === "Escape" && settings === undefined && !review.diff) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="tidyPanelHeader">
        <TidyIcon name="wand" />
        <h2>Tidy</h2>
        <span className="tidyCount">
          {review.pending ? "Checking…" : `${fixes} fixes`}
        </span>
        <button title="Close Tidy" aria-label="Close Tidy" onClick={onClose}>
          <TidyIcon name="close" />
        </button>
      </header>
      <div className="tidyPanelControls">
        <div className="tidyActions">
          <button
            className="tidyApplyAll"
            disabled={disabled || !fixes}
            onClick={() => void review.apply()}
          >
            <TidyIcon name="apply" />
            Apply all {fixes}
          </button>
          <button
            className="tidyDiffButton"
            disabled={!report || review.busy}
            onClick={() => void review.preview()}
          >
            <TidyIcon name="diff" />
            Diff
          </button>
        </div>
        <div className="tidySettingRow">
          <span>Tidy on save</span>
          <button
            type="button"
            role="switch"
            aria-label="Tidy on save"
            aria-checked={review.configuration.onSave}
            disabled={readOnly || review.saving || !editableSettings}
            className={`tidyToggle ${review.configuration.onSave ? "on" : "off"}`}
            onClick={() =>
              void review.changeConfiguration({
                onSave: !review.configuration.onSave,
              })
            }
          />
        </div>
        <label className="tidySettingRow">
          <span>Rules</span>
          <select
            aria-label="Tidy rules preset"
            value={review.configuration.preset}
            disabled={readOnly || review.saving || !editableSettings}
            onChange={(event) =>
              void review.changeConfiguration({
                preset: event.target.value as TidyPreset,
              })
            }
          >
            <option value="slate">Slate default · markdownlint</option>
            <option value="github">GitHub</option>
            <option value="minimal">Minimal</option>
          </select>
          <TidyIcon name="chevron" />
        </label>
      </div>
      <div className="tidyFixes">
        {review.error && (
          <div className="tidyMessage" role="alert">
            <p>{review.error}</p>
            <button onClick={review.retry}>Retry</button>
            <button onClick={() => openSettings(review.file?.source ?? "")}>
              Review settings
            </button>
          </div>
        )}
        {review.notice && (
          <p className="tidyMessage" role="status">
            {review.notice}
          </p>
        )}
        {readOnly && (
          <p className="tidyMessage">
            This Space is read-only. Choose Use here to apply changes.
          </p>
        )}
        {review.pending && !report && (
          <p role="status" className="tidyMessage">
            Checking Markdown…
          </p>
        )}
        {!review.pending && report && !report.issues.length && (
          <p role="status" className="tidyMessage">
            Your Markdown is tidy.
          </p>
        )}
        {previews.map(({ issue, before, after }) => (
          <article className="tidyFix" key={issue.id}>
            <div className="tidyFixHeading">
              <h3>{issue.message}</h3>
              <button
                title={`Go to line ${issue.line}`}
                onClick={() => onJump(issue.line)}
              >
                Ln {issue.line}
              </button>
            </div>
            {after !== undefined && before !== after && (
              <div className="tidyFixPreview">
                <code className="tidyRemoved">
                  − {before || "(empty line)"}
                </code>
                <code className="tidyAdded">+ {after || "(empty line)"}</code>
              </div>
            )}
            <div className="tidyFixActions">
              <code>{issue.rule}</code>
              <button
                disabled={disabled}
                onClick={() =>
                  void review.changeConfiguration({
                    rules: { [issue.rule]: false },
                  })
                }
              >
                Ignore
              </button>
              <button
                className="tidyApplyOne"
                disabled={disabled || !issue.changes.length}
                title={
                  issue.changes.length
                    ? "Apply this fix"
                    : "This warning requires a manual edit"
                }
                onClick={() => void review.apply([issue.id])}
              >
                {issue.changes.length ? "Apply" : "Manual"}
              </button>
            </div>
          </article>
        ))}
        {report && report.issues.length > limit && (
          <button
            className="tidyMore"
            onClick={() => setLimit((count) => count + 100)}
          >
            Show more fixes ({limit} of {report.issues.length})
          </button>
        )}
      </div>
      <footer className="tidyPanelFooter">
        <p>
          Tidy only changes Markdown syntax and whitespace — never your words.
          Every apply is one undo step.
        </p>
        <button
          disabled={!review.file}
          onClick={() =>
            openSettings(
              review.file?.source ??
                (editableSettings
                  ? writeTidyConfiguration(review.configuration)
                  : ""),
            )
          }
        >
          Edit rules JSON
        </button>
      </footer>
      {review.diff && (
        <WorkspaceDialog
          title="Tidy diff"
          className="tidyDiffDialog"
          busy={review.busy}
          onClose={review.closeDiff}
          closeIcon={<TidyIcon name="close" />}
        >
          <div className="tidyDiffColumns">
            <section>
              <h3>Before</h3>
              <pre>{review.diff.source}</pre>
            </section>
            <section>
              <h3>After</h3>
              <pre>{review.diff.output}</pre>
            </section>
          </div>
          {!!review.diff.rejected.length && (
            <p role="status">Unsafe proposals were kept unchanged.</p>
          )}
          <div className="dialogActions">
            <button onClick={review.closeDiff}>Close</button>
            <button
              className="primaryButton"
              disabled={disabled || !review.diff.changes.length}
              onClick={() => void review.apply()}
            >
              Apply changes
            </button>
          </div>
        </WorkspaceDialog>
      )}
      {settings !== undefined && (
        <WorkspaceDialog
          title="Tidy settings"
          className="tidySettingsDialog"
          busy={review.saving}
          onClose={() => setSettings(undefined)}
          closeIcon={<TidyIcon name="close" />}
        >
          <p>These rules are saved in .slate/tidy.json for this Space.</p>
          {review.error && <p role="alert">{review.error}</p>}
          <label>
            JSON
            <textarea
              aria-label="Tidy settings JSON"
              value={settings}
              readOnly={readOnly || !editableSettings}
              spellCheck={false}
              onChange={(event) => setSettings(event.target.value)}
            />
          </label>
          <div className="dialogActions">
            <button
              disabled={review.saving}
              onClick={() => setSettings(undefined)}
            >
              Cancel
            </button>
            <button
              className="primaryButton"
              disabled={readOnly || review.saving || !editableSettings}
              onClick={() =>
                void review
                  .saveSettings(settings, settingsSnapshot.current)
                  .then((saved) => {
                    if (saved) setSettings(undefined);
                  })
              }
            >
              {review.saving ? "Saving…" : "Save rules"}
            </button>
          </div>
        </WorkspaceDialog>
      )}
    </aside>
  );
}
