import { useEffect, useRef, useState, type FormEvent } from "react";
import { readSpaceTemplates } from "@slate/storage/browser-space";
import type { WorkspaceStore } from "../browser/workspaceStore";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { builtinTemplates, type TemplateCatalogItem } from "./builtinTemplates";

export default function NotebookTemplateDialog({
  store,
  notebook,
  returnFocus,
  onClose,
}: {
  store: WorkspaceStore;
  notebook: string;
  returnFocus: HTMLElement | undefined;
  onClose(): void;
}) {
  const [templates, setTemplates] =
    useState<readonly TemplateCatalogItem[]>(builtinTemplates);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(0);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const input = useRef<HTMLSelectElement>(null);
  const missing =
    !!selectedId && !templates.some((template) => template.id === selectedId);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void Promise.all([
      readSpaceTemplates(store.space),
      store.readNotebookTemplate(notebook),
    ])
      .then(([records, reference]) => {
        if (!active) return;
        setTemplates([
          ...builtinTemplates,
          ...records.flatMap((record): TemplateCatalogItem[] =>
            record.template
              ? [
                  {
                    id: record.path,
                    path: record.path,
                    origin: "space",
                    template: record.template,
                  },
                ]
              : [],
          ),
        ]);
        setInvalid(records.filter((record) => record.error).length);
        setSelectedId(reference ?? "");
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [store, notebook, retry]);
  useEffect(() => {
    if (!loading && !loadError) input.current?.focus();
  }, [loading, loadError]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked.current || loading || loadError || missing) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await store.setNotebookTemplate(notebook, selectedId || undefined);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title="Notebook default template"
      returnFocus={returnFocus}
      onClose={onClose}
      busy={busy}
    >
      <p>
        New sheets in <strong>{notebook || "Space root"}</strong> start with
        this template. You can fill in its title and prompts before creating the
        file.
      </p>
      <form onSubmit={(event) => void save(event)}>
        {loading && (
          <p role="status">Reading templates and notebook preferences…</p>
        )}
        {loadError && (
          <p role="alert">
            Notebook defaults could not be read: {loadError}{" "}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </p>
        )}
        <label>
          Default template
          <select
            ref={input}
            value={selectedId}
            disabled={loading || busy || !!loadError}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Blank sheet</option>
            {missing && (
              <option value={selectedId} disabled>
                Unavailable: {selectedId}
              </option>
            )}
            <optgroup label="Built-in">
              {templates
                .filter((template) => template.origin === "built-in")
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.template.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="This Space">
              {templates
                .filter((template) => template.origin === "space")
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.template.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        {missing && !loading && (
          <p role="alert">
            This default template is unavailable. Choose another template or
            Blank sheet.
          </p>
        )}
        {!!invalid && (
          <p>
            {invalid} Space{" "}
            {invalid === 1 ? "template needs" : "templates need"} repair in the
            template gallery.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialogActions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primaryButton"
            disabled={loading || busy || !!loadError || missing}
          >
            {busy ? "Saving…" : "Save default"}
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
