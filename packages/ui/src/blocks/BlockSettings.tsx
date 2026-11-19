import { useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type {
  BrowserWriteResult,
  SpaceBlockFile,
} from "@slate/storage/browser-space";
import type { WorkspaceStore } from "../browser/workspaceStore";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { BlockLibrary } from "./blockLibrary";
import "../snippets/snippets.css";
import "./blocks.css";

type Editing = { base?: SpaceBlockFile; name: string; source: string };
const relative = (path: string) => path.replace(/^\.slate\/blocks\//, "");
export default function BlockSettings({
  library,
  store,
  onTakeover,
  onClose,
  returnFocus,
}: {
  library: BlockLibrary;
  store: WorkspaceStore;
  onTakeover(): Promise<void>;
  onClose(): void;
  returnFocus?: HTMLElement | undefined;
}) {
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot),
    owned = useStore(store.api, (state) => state.owned);
  const [editing, setEditing] = useState<Editing>(),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState<BrowserWriteResult>(),
    [busy, setBusy] = useState(false);
  const working = useRef(false);
  const blocked =
    editing?.base?.status === "unsupported" ||
    editing?.base?.status === "unavailable";
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function open(file?: SpaceBlockFile) {
    setConflict(undefined);
    setError("");
    setEditing({
      ...(file ? { base: file } : {}),
      name: file ? relative(file.path) : "New block",
      source: file?.source ?? (file ? "" : "> Quote\n"),
    });
  }
  async function save() {
    if (!editing || !store.api.getState().owned) return;
    const result = editing.base
      ? await library.save(editing.base, editing.source)
      : await library.create(editing.name, editing.source);
    if (result.conflict) {
      setConflict(result);
      setError(
        `This file changed elsewhere. Your proposal is preserved in ${relative(result.path)}.`,
      );
    } else setEditing(undefined);
  }
  function download(name: string, bytes: Uint8Array) {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer])),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <WorkspaceDialog
      title="Custom blocks"
      className="snippetSettings customBlockSettings"
      busy={busy}
      returnFocus={returnFocus}
      onClose={onClose}
    >
      <p className="quiet">Reusable Markdown fragments in this Space.</p>
      {!owned && (
        <p role="status">
          This Space is read-only.{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(onTakeover);
            }}
          >
            Use here
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {snapshot.error && (
        <p role="alert">
          {snapshot.error}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(library.refresh);
            }}
          >
            Refresh blocks
          </button>
        </p>
      )}
      {!editing ? (
        <>
          <div className="snippetTable">
            <table>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Markdown</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.files.map((file) => (
                  <tr key={file.path}>
                    <td>
                      <button
                        type="button"
                        aria-label={`Edit ${relative(file.path)}`}
                        onClick={() => open(file)}
                      >
                        {file.block?.label ?? relative(file.path)}
                        <small className="customBlockPath">
                          {relative(file.path)}
                        </small>
                      </button>
                    </td>
                    <td>
                      {file.error ? (
                        <span>{file.error}</span>
                      ) : (
                        <code>
                          {file.source
                            ?.replace(/^\uFEFF/, "")
                            .replace(/\r?\n/g, " ↵ ")
                            .slice(0, 160) || "Empty fragment"}
                        </code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!snapshot.files.length && (
            <p className="quiet">
              {snapshot.loading
                ? "Loading custom blocks…"
                : snapshot.error
                  ? "Refresh the file list to continue."
                  : "Add a fragment to find it in the slash menu."}
            </p>
          )}
          <div className="snippetSettingsActions">
            <button
              type="button"
              disabled={snapshot.loading || !!snapshot.error}
              onClick={() => open()}
            >
              Add custom block
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(library.refresh);
              }}
            >
              Refresh blocks
            </button>
          </div>
        </>
      ) : (
        <form
          className="snippetEditor"
          onSubmit={(event) => {
            event.preventDefault();
            void run(save);
          }}
        >
          {editing.base ? (
            <p className="quiet">{editing.base.path}</p>
          ) : (
            <label>
              Block name
              <input
                required
                value={editing.name}
                disabled={busy}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </label>
          )}
          {editing.base?.error && <p role="status">{editing.base.error}</p>}
          <label>
            Block Markdown
            <textarea
              rows={10}
              spellCheck={false}
              value={editing.source}
              readOnly={blocked}
              disabled={busy}
              onChange={(event) =>
                setEditing({ ...editing, source: event.target.value })
              }
            />
          </label>
          <p className="quiet">
            The fragment inserts as literal Markdown. Templates and snippets
            provide prompts and tab stops.
          </p>
          {editing.base?.bytes && (
            <button
              type="button"
              onClick={() =>
                download(
                  editing.base!.path.split("/").at(-1)!,
                  editing.base!.bytes!,
                )
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
                    conflict.path.split("/").at(-1)!,
                    new TextEncoder().encode(conflict.content),
                  )
                }
              >
                Download your copy
              </button>
              <button
                type="button"
                onClick={() => {
                  void run(async () => {
                    await library.refresh();
                    const current = library
                      .getSnapshot()
                      .files.find((file) => file.path === editing.base?.path);
                    if (!current)
                      throw new Error(
                        "The original file was removed. Your conflict copy is kept in the block list.",
                      );
                    open(current);
                  });
                }}
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
                setConflict(undefined);
                setError("");
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primaryButton"
              disabled={busy || blocked || !owned || !!conflict}
            >
              {busy ? "Saving…" : "Save block"}
            </button>
          </div>
        </form>
      )}
    </WorkspaceDialog>
  );
}
