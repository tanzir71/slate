import { useRef, useState, type FormEvent } from "react";
import { useStore } from "zustand";
import type { WorkspaceStore } from "../browser/workspaceStore";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import {
  starterKit,
  starterKits,
  type StarterKitInstallation,
} from "./starterKits";
import "./starterKits.css";

export default function StarterKitDialog({
  store,
  returnFocus,
  onTakeover,
  onClose,
}: {
  store: WorkspaceStore;
  returnFocus: HTMLElement | undefined;
  onClose(root?: string): void;
  onTakeover(): Promise<void>;
}) {
  const [selected, setSelected] = useState("work");
  const [name, setName] = useState("Work");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owned = useStore(store.api, (state) => state.owned);
  const [session, setSession] = useState<StarterKitInstallation>();
  const locked = useRef(false);
  const input = useRef<HTMLSelectElement>(null);
  const kit = starterKit(selected);
  function close() {
    if (locked.current) return;
    if (session) store.cancelStarterKit(session);
    onClose();
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !owned) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const next = session ?? (await store.prepareStarterKit(selected, name));
      setSession(next);
      await store.installStarterKit(next);
      onClose(next.plan.root);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title="Starter kits"
      className="starterKitDialog"
      busy={busy}
      returnFocus={returnFocus}
      initialFocus={input}
      onClose={close}
    >
      <form onSubmit={(event) => void add(event)}>
        <p>A few useful notes and notebook defaults to get you writing.</p>
        <label>
          Starter kit
          <select
            ref={input}
            value={selected}
            disabled={busy || !!session}
            onChange={(event) => {
              setSelected(event.target.value);
              setName(starterKit(event.target.value).name);
              setError("");
            }}
          >
            {starterKits.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p>{kit.description}</p>
        <label>
          Notebook name
          <input
            value={session?.plan.root ?? name}
            required
            disabled={busy || !!session}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
          />
        </label>
        <p className="starterKitHint">
          A number is added if that notebook already exists. Your current notes
          and defaults are kept.
        </p>
        <section aria-label="Kit contents">
          <h3>3 notes · 2 notebook defaults</h3>
          <ul>
            <li>Overview — a guide to your new notebooks</li>
            {kit.notes.map((note) => (
              <li key={note.notebook}>
                <strong>{note.notebook}</strong> — {note.title}
              </li>
            ))}
          </ul>
        </section>
        {!busy && !!session && !session.complete && (
          <p role="status">
            {session.saved.length} of {session.plan.notes.length} notes saved in{" "}
            {session.plan.root}. Retry to finish. Closing keeps the saved files.
          </p>
        )}
        {!owned && (
          <p role="status">
            This Space is read-only. Choose Use here to add a kit.
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onTakeover().catch((error: unknown) =>
                  setError(
                    error instanceof Error ? error.message : String(error),
                  ),
                )
              }
            >
              Use here
            </button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialogActions">
          <button type="button" disabled={busy} onClick={close}>
            {session?.saved.length ? "Close and keep files" : "Cancel"}
          </button>
          <button
            type="submit"
            className="primaryButton"
            disabled={busy || !owned}
          >
            {busy ? "Adding…" : session ? "Retry" : "Add kit"}
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
