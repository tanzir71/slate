import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorkspaceLaunchRequest, type LaunchProps } from "../browser/LaunchActions";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { NativeFileTarget, NativeLaunchRequest, NativeLaunchSource } from "./nativeLaunchSource";
import type { NativeSpace } from "./nativeSpaces";

type Props = LaunchProps & {
  ticket: NativeLaunchRequest;
  source: NativeLaunchSource;
  onOpenNativeSpace?(space: NativeSpace): Promise<void>;
  finish(): Promise<void>;
};
const message = (error: unknown) => error instanceof Error ? error.message : "This file could not be opened. Its original bytes were kept.";

/** OS paths remain in the host. Resolve one ticket, then use the normal Space/read flow. */
export function NativeFileRequest({ ticket, source, onOpenNativeSpace, finish, ...props }: Props) {
  const [target, setTarget] = useState<NativeFileTarget>();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const active = useRef(true), locked = useRef(false), started = useRef(false);
  useLayoutEffect(() => {
    active.current = true; props.onDialogChange(true);
    return () => { active.current = false; props.onDialogChange(false); };
  }, [props.onDialogChange]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await source.run(work); }
    catch (failure) { if (active.current) setError(message(failure)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  const open = () => run(async () => {
    const next = await source.resolveFile(ticket.id);
    if (next.space.id !== props.store.api.getState().record.id) {
      if (!onOpenNativeSpace) throw Error("This file needs its original desktop Space. Your files were kept.");
      await onOpenNativeSpace(next.space);
      // The new Space remounts this ticket and reads its already-bound target.
    } else if (active.current) setTarget(next);
  });
  useEffect(() => { if (!started.current) { started.current = true; void open(); } });
  if (target) return <WorkspaceLaunchRequest {...props} request={{ action: { kind: "open", space: target.space.id, path: target.path },
    params: new URLSearchParams([["action", "open"], ["space", target.space.id], ["path", target.path]]), files: [], error: "", id: 0 }} runApply={source.run} onDone={finish} />;
  return <WorkspaceDialog title="Open Markdown file" busy={busy} onClose={() => { void run(finish); }}>
    <p role="status">Opening {ticket.fileName}…</p>
    {error && <p role="alert">{error}</p>}
    <div className="dialogActions"><button disabled={busy} onClick={() => { void run(finish); }}>Cancel</button>
      {error && <button className="primaryButton" disabled={busy} onClick={() => { void open(); }}>Try again</button>}</div>
  </WorkspaceDialog>;
}
