import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { NativeSpace, NativeSpaceCatalog } from "./nativeSpaces";

export function NativeSpacesDialog({ current, catalog, onOpen, onClose }: {
  current: NativeSpace;
  catalog: NativeSpaceCatalog;
  onOpen(space: NativeSpace): Promise<void>;
  onClose(): void;
}) {
  const [records, setRecords] = useState<NativeSpace[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    let active = true; alive.current = true;
    void catalog.list().then(list => { if (active) setRecords(list); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Your Spaces could not be read. Your files were kept."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; alive.current = false; };
  }, [catalog]);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await work(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "This Space could not be opened. Your current words were kept."); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const open = async (space: NativeSpace) => { await onOpen(space); onClose(); };
  return <WorkspaceDialog title="Spaces" busy={busy} onClose={onClose}>
    <p>Write in a folder on this device. Your notes stay in ordinary files.</p>
    {loading && <p role="status">Reading Spaces…</p>}
    {error && <p role="alert">{error}</p>}
    <ul className="nativeSpacesList">{records.map(space => <li key={space.id}>
      <button disabled={busy || loading} aria-current={space.id === current.id ? "true" : undefined} onClick={() => { void run(() => open(space)); }}>
        <strong>{space.name}</strong><span>{space.path ?? "On this device"}</span>{space.id === current.id && <span>Current Space</span>}
      </button>
    </li>)}</ul>
    <button className="primaryButton" disabled={busy || loading} onClick={() => { void run(async () => { const selected = await catalog.pick(); if (selected) await open(selected); }); }}>Open a folder</button>
    {busy && <p role="status">Opening your Space…</p>}
  </WorkspaceDialog>;
}
