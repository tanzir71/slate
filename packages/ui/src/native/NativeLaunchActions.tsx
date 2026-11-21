import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorkspaceLaunchRequest, type LaunchProps } from "../browser/LaunchActions";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { parseNativeLaunchURL } from "./nativeLaunchURL";
import type { NativeLaunchRequest, NativeLaunchSnapshot, NativeLaunchSource } from "./nativeLaunchSource";

const message = (cause: unknown) => cause instanceof Error ? cause.message : "Desktop links could not be read. Your files were kept.";
type Props = LaunchProps & { source: NativeLaunchSource };

/** Backend authority keeps active/queued requests intact when a Space unmounts. */
export default function NativeLaunchActions({ source, ...props }: Props) {
  const [snapshot, setSnapshot] = useState<NativeLaunchSnapshot>();
  const [error, setError] = useState("");
  const revision = useRef(-1);
  const receive = useCallback((next: NativeLaunchSnapshot) => {
    if (next.revision < revision.current) return;
    setError(next.error ?? "");
    if (next.revision === revision.current) return;
    revision.current = next.revision; setSnapshot(next);
  }, []);
  useEffect(() => {
    let active = true, stop: (() => void) | undefined;
    revision.current = -1;
    void (async () => {
      const unlisten = await source.listen(next => { if (active) receive(next); }, failure => { if (active) setError(message(failure)); });
      if (!active) { unlisten(); return; }
      stop = unlisten;
      const next = await source.pending(); if (active) receive(next);
    })().catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; stop?.(); };
  }, [source, receive]);
  async function update(work: Promise<NativeLaunchSnapshot>) { receive(await work); }
  return <>
    {error && <div className="notice" role="alert">{error}<button onClick={() => { void update(source.pending()).catch(failure => setError(message(failure))); }}>Retry desktop links</button></div>}
    {!!snapshot?.waiting && <div className="notice" role="status">{snapshot.waiting} incoming {snapshot.waiting === 1 ? "request" : "requests"} waiting.
      <button disabled={!!snapshot.current} onClick={() => { void update(source.next()).catch(failure => setError(message(failure))); }}>Review next request</button></div>}
    {snapshot?.current && <NativeRequest key={snapshot.current.id} {...props} ticket={snapshot.current} source={source} receive={receive} />}
  </>;
}

function NativeRequest({ ticket, source, receive, ...props }: Props & { ticket: NativeLaunchRequest; receive(snapshot: NativeLaunchSnapshot): void }) {
  // Phase is captured once. Our own started/applied events must not remount a running editor operation.
  const [interrupted, setInterrupted] = useState(ticket.phase === "started");
  const [alreadyApplied] = useState(ticket.phase === "applied");
  const [claim] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""));
  const [parsed] = useState(() => parseNativeLaunchURL(ticket.url));
  async function update(work: Promise<NativeLaunchSnapshot>) { receive(await work); }
  const finish = () => update(source.complete(ticket.id));
  if (interrupted) return <InterruptedRequest onDialogChange={props.onDialogChange} onCancel={finish} onReview={async () => {
    await update(source.review(ticket.id)); setInterrupted(false);
  }} />;
  if (alreadyApplied) return <FinishRequest onDialogChange={props.onDialogChange} finish={finish} />;
  if (parsed.action && !parsed.action.space && !ticket.spaceId) return <BindRequest onDialogChange={props.onDialogChange} finish={finish}
    bind={() => update(source.bind(ticket.id, props.store.api.getState().record.id))} />;
  const request = parsed.action && ticket.spaceId && !parsed.action.space ? { ...parsed, action: { ...parsed.action, space: ticket.spaceId } } : parsed;
  return <WorkspaceLaunchRequest {...props} request={request}
    runApply={source.run} beforeApply={() => update(source.begin(ticket.id, claim))} afterApply={() => update(source.applied(ticket.id, claim))} onDone={finish} />;
}

function BindRequest({ onDialogChange, bind, finish }: { onDialogChange(open: boolean): void; bind(): Promise<void>; finish(): Promise<void> }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const started = useRef(false), locked = useRef(false), active = useRef(true);
  useLayoutEffect(() => { active.current = true; onDialogChange(true); return () => { active.current = false; onDialogChange(false); }; }, [onDialogChange]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true);
    try { await work(); } catch (cause) { if (active.current) setError(message(cause)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  useEffect(() => { if (!started.current) { started.current = true; void run(bind); } });
  return <WorkspaceDialog title="Open in Slate" busy={busy} onClose={() => { void run(finish); }}>
    <p role="status">Opening your desktop request…</p>{error && <p role="alert">{error}</p>}
    <div className="dialogActions"><button disabled={busy} onClick={() => { void run(finish); }}>Cancel</button>
      {error && <button className="primaryButton" disabled={busy} onClick={() => { void run(bind); }}>Try again</button>}</div>
  </WorkspaceDialog>;
}

function InterruptedRequest({ onDialogChange, onCancel, onReview }: {
  onDialogChange(open: boolean): void; onCancel(): Promise<void>; onReview(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const locked = useRef(false);
  useLayoutEffect(() => { onDialogChange(true); return () => onDialogChange(false); }, [onDialogChange]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true);
    try { await work(); } catch (cause) { setError(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <WorkspaceDialog title="Review interrupted request" busy={busy} onClose={() => { void run(onCancel); }}>
    <p>This request was interrupted. It may already have changed a sheet. Check your notes before applying it again.</p>
    {error && <p role="alert">{error}</p>}
    <div className="dialogActions"><button disabled={busy} onClick={() => { void run(onCancel); }}>Cancel</button>
      <button className="primaryButton" disabled={busy} onClick={() => { void run(onReview); }}>Review again</button></div>
  </WorkspaceDialog>;
}
function FinishRequest({ onDialogChange, finish }: { onDialogChange(open: boolean): void; finish(): Promise<void> }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const started = useRef(false), locked = useRef(false);
  useLayoutEffect(() => { onDialogChange(true); return () => onDialogChange(false); }, [onDialogChange]);
  async function complete() {
    if (locked.current) return; locked.current = true; setBusy(true);
    try { await finish(); } catch (cause) { setError(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  }
  useEffect(() => { if (!started.current) { started.current = true; void complete(); } });
  return <WorkspaceDialog title="Finish desktop request" busy={busy} onClose={() => { void complete(); }}>
    <p>Your changes were applied. Finishing this request…</p>
    {error && <p role="alert">{error}</p>}
    <button className="primaryButton" disabled={busy} onClick={() => { void complete(); }}>Finish request</button>
  </WorkspaceDialog>;
}
