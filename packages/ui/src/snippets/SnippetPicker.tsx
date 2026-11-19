import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ScopedSnippet } from "@slate/core";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { SnippetLibrary } from "./snippetLibrary";
import type { SnippetInvocation } from "./snippetSession";
import "./snippets.css";

export default function SnippetPicker({
  library,
  invocation,
  spaceName,
  onChoose,
  onManage,
  onClose,
}: {
  library: SnippetLibrary;
  invocation: SnippetInvocation;
  spaceName: string;
  onChoose(definition: ScopedSnippet): void;
  onManage(): void;
  onClose(): void;
}) {
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [preview, setPreview] = useState(false);
  const search = useRef<HTMLInputElement>(null),
    id = useId();
  const matches = snapshot.snippets.filter((entry) =>
    `${entry.name} ${entry.trigger}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visible = matches.slice(0, 80),
    chosen = visible[Math.min(active, Math.max(0, visible.length - 1))];
  useEffect(() => {
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [id, active, query]);
  return (
    <WorkspaceDialog
      title="Insert snippet"
      className="snippetPicker"
      returnFocus={invocation.target.element}
      initialFocus={search}
      onClose={onClose}
      headerContent={
        <header className="snippetSearch">
          <span className="snippetIcon snippetSearchIcon" aria-hidden="true" />
          <input
            ref={search}
            role="combobox"
            aria-label="Search snippets"
            aria-expanded="true"
            aria-controls={id}
            aria-activedescendant={
              chosen ? `${id}-${visible.indexOf(chosen)}` : undefined
            }
            autoComplete="off"
            value={query}
            placeholder="Search snippets…"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setPreview(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) =>
                  Math.max(
                    0,
                    Math.min(
                      visible.length - 1,
                      current + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (event.key === "Enter" && chosen) {
                event.preventDefault();
                onChoose(chosen);
              }
              if (event.key === "Tab" && !event.shiftKey && chosen) {
                event.preventDefault();
                setPreview((current) => !current);
              }
            }}
          />
          <button
            type="button"
            aria-label="Close Insert snippet"
            onClick={onClose}
          >
            <kbd>Esc</kbd>
          </button>
        </header>
      }
    >
      <div className="snippetModes">
        <span>
          <code>;</code> Snippets
        </span>
        <small>
          {snapshot.loading
            ? "Loading…"
            : `${snapshot.snippets.length} available`}
        </small>
      </div>
      {!!snapshot.errors.length && (
        <div className="snippetMessage" role="alert">
          {snapshot.errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      <div
        id={id}
        role="listbox"
        aria-label="Snippets"
        className="snippetResults"
      >
        {visible.map((entry, index) => (
          <div
            key={entry.trigger}
            id={`${id}-${index}`}
            role="option"
            aria-selected={entry === chosen}
            className={`snippetResult${entry === chosen ? " active" : ""}`}
            onPointerMove={() => setActive(index)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onChoose(entry)}
          >
            <span className="snippetTile">
              <span
                className="snippetIcon snippetFileIcon"
                aria-hidden="true"
              />
            </span>
            <span className="snippetResultText">
              <strong>{entry.name}</strong>
              <small>
                {entry.origin === "global" ? "All Spaces" : spaceName}
              </small>
            </span>
            <code>{entry.trigger}</code>
          </div>
        ))}
        {!visible.length && !snapshot.loading && (
          <p className="snippetEmpty">
            {snapshot.errors.length
              ? "Repair the configuration to enable snippets."
              : "No snippets match. Try a trigger or name."}
          </p>
        )}
        {matches.length > visible.length && (
          <p className="snippetEmpty">
            Showing the first {visible.length} matches. Type to narrow your
            search.
          </p>
        )}
      </div>
      {preview && chosen && (
        <pre className="snippetPreview" aria-label="Snippet source preview">
          {chosen.body}
        </pre>
      )}
      <footer className="snippetPickerFooter">
        <span>
          <kbd>Enter</kbd> Insert <kbd>Tab</kbd> Preview
        </span>
        <button type="button" onClick={onManage}>
          Manage snippets
        </button>
      </footer>
    </WorkspaceDialog>
  );
}
