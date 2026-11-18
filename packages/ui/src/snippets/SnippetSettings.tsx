import { useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { ScopedSnippet, SnippetActivation } from "@slate/core";
import type {
  BrowserWriteResult,
  SnippetFile,
} from "@slate/storage/browser-space";
import type { WorkspaceStore } from "../browser/workspaceStore";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import {
  builtinSnippets,
  type SnippetLibrary,
  type SnippetScope,
} from "./snippetLibrary";
import {
  editSnippetSource,
  snippetFileSource,
  type SnippetDraft,
} from "./snippetEditing";
import "./snippets.css";

type Editing = {
  scope: SnippetScope;
  base: SnippetFile;
  source: string;
  draft?: SnippetDraft;
};
export default function SnippetSettings({
  library,
  store,
  onTakeover,
  onClose,
  returnFocus,
}: {
  library: SnippetLibrary;
  store: WorkspaceStore;
  onTakeover(): Promise<void>;
  onClose(): void;
  returnFocus?: HTMLElement | undefined;
}) {
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot),
    owned = useStore(store.api, (state) => state.owned);
  const [editing, setEditing] = useState<Editing>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState<BrowserWriteResult>(),
    [all, setAll] = useState(false);
  const file = (scope: SnippetScope) => snapshot[scope];
  function open(scope: SnippetScope, definition?: ScopedSnippet, json = false) {
    const base = file(scope);
    if (!base) return;
    setError("");
    setConflict(undefined);
    setEditing({
      scope,
      base,
      source: snippetFileSource(base, scope),
      ...(!json && (base.status === "valid" || base.status === "missing")
        ? {
            draft: {
              scope,
              name: definition?.name ?? "",
              trigger: definition?.trigger ?? ";",
              body: definition?.body ?? "${1:Text}$0",
              expandOn: definition?.expandOn ?? "tab",
              enabled: definition?.enabled ?? true,
              ...(definition ? { originalTrigger: definition.trigger } : {}),
            },
          }
        : {}),
    });
  }
  function announce() {
    try {
      if (typeof BroadcastChannel === "function") {
        const channel = new BroadcastChannel("slate-snippets");
        channel.postMessage("changed");
        channel.close();
      }
    } catch {
      /* A committed file remains successful without an advisory message. */
    }
  }
  async function save() {
    if (!editing || !owned) return;
    setBusy(true);
    setError("");
    try {
      const source = editing.draft
        ? editSnippetSource(editing.base, editing.draft)
        : editing.source;
      const result = await library.save(editing.scope, editing.base, source);
      if (result.conflict) {
        setConflict(result);
        setError(
          `This file changed elsewhere. Your proposal is preserved in ${result.path}.`,
        );
      } else {
        setEditing(undefined);
        announce();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  function download(name: string, bytes: Uint8Array) {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer]));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const rows: readonly ScopedSnippet[] = all
    ? [
        ...(
          snapshot.global?.configuration ??
          (snapshot.global?.status === "missing"
            ? builtinSnippets
            : { snippets: [] })
        ).snippets.map((entry) => ({ ...entry, origin: "global" as const })),
        ...(snapshot.space?.configuration?.snippets ?? []).map((entry) => ({
          ...entry,
          origin: "space" as const,
        })),
      ]
    : snapshot.snippets;
  const blocked =
    editing?.base.status === "unsupported" ||
    editing?.base.status === "unavailable";
  return (
    <WorkspaceDialog
      title="Snippets"
      className="snippetSettings"
      returnFocus={returnFocus}
      busy={busy}
      onClose={onClose}
      headerActions={
        <span className="snippetHint">
          Type the trigger, press{" "}
          {rows.some((entry) => entry.expandOn !== "tab")
            ? "Tab or Space"
            : "Tab"}
        </span>
      }
    >
      {!owned && (
        <p role="status">
          This Space is read-only.{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onTakeover()
                .catch((cause: unknown) => setError(String(cause)))
                .finally(() => setBusy(false));
            }}
          >
            Use here
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!editing ? (
        <>
          {snapshot.errors.map((issue) => (
            <p key={issue} role="alert">
              {issue}
            </p>
          ))}
          <div className="snippetTable">
            <table>
              <thead>
                <tr>
                  <th>Trigger</th>
                  <th>Expands to</th>
                  <th>Scope</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={`${entry.origin}/${entry.trigger}`}>
                    <td>
                      <button
                        type="button"
                        onClick={() => open(entry.origin, entry)}
                        aria-label={`Edit ${entry.trigger} in ${entry.origin === "global" ? "All Spaces" : store.api.getState().record.name}`}
                      >
                        {entry.trigger}
                      </button>
                    </td>
                    <td>
                      <code>
                        {!entry.enabled ? "Disabled · " : ""}
                        {entry.body.replace(/\r?\n/g, "  ↵  ").slice(0, 200)}
                      </code>
                    </td>
                    <td>
                      {entry.origin === "global"
                        ? "All Spaces"
                        : store.api.getState().record.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p className="quiet">
              {snapshot.loading
                ? "Loading snippets…"
                : "No enabled snippets. Add one or edit a configuration."}
            </p>
          )}
          <label className="snippetCheck">
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => setAll(event.target.checked)}
            />
            Show all definitions, including disabled and overridden entries
          </label>
          <div className="snippetSettingsActions">
            <button
              type="button"
              disabled={!snapshot.space}
              onClick={() => open("space")}
            >
              Add snippet
            </button>
            <button
              type="button"
              disabled={!snapshot.space}
              onClick={() => open("space", undefined, true)}
            >
              Edit Space JSON
            </button>
            <button
              type="button"
              disabled={!snapshot.global}
              onClick={() => open("global", undefined, true)}
            >
              Edit global JSON
            </button>
          </div>
        </>
      ) : (
        <form
          className="snippetEditor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="quiet">
            {editing.scope === "global"
              ? "All Spaces on this browser"
              : store.api.getState().record.name}{" "}
            · {editing.base.path}
          </p>
          {editing.base.error && <p role="status">{editing.base.error}</p>}
          {editing.draft ? (
            <>
              {!editing.draft.originalTrigger && (
                <label>
                  Scope
                  <select
                    value={editing.scope}
                    disabled={busy}
                    onChange={(event) => {
                      const scope = event.target.value as SnippetScope,
                        base = file(scope);
                      if (base)
                        setEditing((current) =>
                          current?.draft
                            ? {
                                ...current,
                                scope,
                                base,
                                source: snippetFileSource(base, scope),
                                draft: { ...current.draft, scope },
                              }
                            : current,
                        );
                    }}
                  >
                    <option value="space">
                      {store.api.getState().record.name}
                    </option>
                    <option value="global">All Spaces</option>
                  </select>
                </label>
              )}
              <label>
                Name
                <input
                  value={editing.draft.name}
                  disabled={busy || blocked}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft!, name: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                Trigger
                <input
                  value={editing.draft.trigger}
                  disabled={busy || blocked}
                  required
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft!, trigger: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                Snippet body
                <textarea
                  rows={7}
                  value={editing.draft.body}
                  disabled={busy || blocked}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: { ...editing.draft!, body: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                Expand on
                <select
                  value={editing.draft.expandOn}
                  disabled={busy || blocked}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: {
                        ...editing.draft!,
                        expandOn: event.target.value as SnippetActivation,
                      },
                    })
                  }
                >
                  <option value="tab">Tab</option>
                  <option value="space">Space</option>
                  <option value="both">Tab or Space</option>
                </select>
              </label>
              <label className="snippetCheck">
                <input
                  type="checkbox"
                  checked={editing.draft.enabled}
                  disabled={busy || blocked}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      draft: {
                        ...editing.draft!,
                        enabled: event.target.checked,
                      },
                    })
                  }
                />
                Enable this definition
              </label>
              <p className="quiet">
                Use ${"{1:placeholder}"} for a tab stop, $0 for the final
                cursor, and template variables such as {"{{date}}"}.
              </p>
            </>
          ) : (
            <label>
              Snippet configuration
              <textarea
                className="snippetJSON"
                rows={12}
                spellCheck={false}
                value={editing.source}
                readOnly={blocked}
                disabled={busy}
                onChange={(event) =>
                  setEditing({ ...editing, source: event.target.value })
                }
              />
            </label>
          )}
          {editing.base.bytes && (
            <button
              type="button"
              onClick={() =>
                download("snippets-original.json", editing.base.bytes!)
              }
            >
              Download original file
            </button>
          )}
          {conflict && (
            <div className="snippetSettingsActions">
              <button
                type="button"
                onClick={() =>
                  download(
                    "snippets-proposal.json",
                    new TextEncoder().encode(conflict.content),
                  )
                }
              >
                Download your copy
              </button>
              <button
                type="button"
                onClick={() => open(editing.scope, undefined, true)}
              >
                Review current file
              </button>
            </div>
          )}
          <div className="dialogActions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(undefined);
                setError("");
                setConflict(undefined);
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primaryButton"
              disabled={busy || blocked || !owned || !!conflict}
            >
              {busy ? "Saving…" : "Save snippets"}
            </button>
          </div>
        </form>
      )}
    </WorkspaceDialog>
  );
}
