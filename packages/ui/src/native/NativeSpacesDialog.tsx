import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { defaultNativeSpace, type NativeSpace, type NativeSpaceCatalog } from "./nativeSpaces";
import { shortcutOS } from "../commands";
import { nativeWelcome } from "./nativeWelcome";
import { NativeNewSpaceForm } from "./NativeNewSpaceForm";

export function NativeSpacesDialog({ current, catalog, onOpen, onClose }: {
  current?: NativeSpace;
  catalog: Pick<NativeSpaceCatalog, "list" | "pick" | "create">;
  onOpen(space: NativeSpace): Promise<void>;
  onClose(): void;
}) {
  const [records, setRecords] = useState<NativeSpace[]>([defaultNativeSpace]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<NativeSpace>();
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
  const start = (name: string) => { void run(async () => {
    const space = created ?? await catalog.create(name, nativeWelcome(shortcutOS()));
    if (!alive.current) return;
    setCreated(space);
    setRecords(records => records.some(record => record.id === space.id) ? records : [...records, space]);
    await open(space);
  }); };
  return <WorkspaceDialog title={creating ? "Start a new Space" : "Spaces"} busy={busy} onClose={onClose}>
    {error && <p role="alert">{error}</p>}
    {creating ? <NativeNewSpaceForm busy={busy} created={created} onCreate={start} onBack={() => { setCreating(false); setCreated(undefined); setError(""); }} /> : <>
    <p>Write in a folder on this device. Your notes stay in ordinary files.</p>
    {loading && <p role="status">Reading Spaces…</p>}
    <ul className="nativeSpacesList">{records.map(space => <li key={space.id}>
      <button disabled={busy || loading} aria-current={space.id === current?.id ? "true" : undefined} onClick={() => { void run(() => open(space)); }}>
        <strong>{space.name}</strong><span>{space.path ?? "On this device"}</span>{space.id === current?.id && <span>Current Space</span>}
      </button>
    </li>)}</ul>
    <div className="dialogActions"><button disabled={busy || loading} onClick={() => { setCreating(true); setError(""); }}>Start a new Space</button>
    <button className="primaryButton" disabled={busy || loading} onClick={() => { void run(async () => { const selected = await catalog.pick(); if (selected) await open(selected); }); }}>Open a folder</button></div>
    </>}
    {busy && <p role="status">{creating && !created ? "Creating your Space…" : "Opening your Space…"}</p>}
  </WorkspaceDialog>;
}
