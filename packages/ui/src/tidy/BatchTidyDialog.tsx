import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { prepareTidyBatch, type BatchTidyRow, type BatchTidySession } from "@slate/storage/tidy-batch";
import type { WorkspaceStore } from "../browser/workspaceStore";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { createTidyWorkerClient } from "./tidyWorkerClient";
import { TidyIcon } from "./TidyIcon";
import "./tidy.css";

const selectable = (row: BatchTidyRow) => row.status === "ready" || row.status === "failed";
const failure = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const sheets = (count: number) => `${count} ${count === 1 ? "sheet" : "sheets"}`;
function status(row: BatchTidyRow) {
  switch (row.status) {
    case "ready": return `${row.fixes} fixes`;
    case "unchanged": return "No automatic changes";
    case "applied": return "Applied";
    case "undone": return "Undone";
    case "undo-failed": return "Undo needs attention";
    case "unsupported": return "Unsupported text encoding";
    case "unavailable": return "Unavailable";
    case "conflict": return "Changed since review";
    case "failed": return "Not applied";
  }
}

export default function BatchTidyDialog({ store, paths, returnFocus, onClose }: {
  store: WorkspaceStore;
  paths: readonly string[];
  returnFocus?: HTMLElement | undefined;
  onClose(): void;
}) {
  const owned = useStore(store.api, (state) => state.owned);
  const captured = useRef([...paths]);
  const alive = useRef(false);
  const generation = useRef(0);
  const working = useRef(false);
  const worker = useRef<ReturnType<typeof createTidyWorkerClient> | undefined>(undefined);
  const [batch, setBatch] = useState<BatchTidySession>();
  const [rows, setRows] = useState<readonly BatchTidyRow[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [checking, setChecking] = useState(true);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [limit, setLimit] = useState(100);
  const review = useCallback(async () => {
    const current = ++generation.current;
    setChecking(true); setProgress(0); setError(""); setBatch(undefined); setRows([]); setExpanded(undefined);
    let client: ReturnType<typeof createTidyWorkerClient> | undefined;
    try {
      await store.flush();
      if (!alive.current || current !== generation.current) return;
      client = createTidyWorkerClient(new Worker(new URL("./tidy.worker.ts", import.meta.url), { type: "module" }));
      worker.current = client;
      const next = await prepareTidyBatch({
        space: store.space, paths: captured.current, group: `${Date.now()}-${crypto.randomUUID()}`, fix: client.fix,
        canWrite: () => store.api.getState().owned,
        onProgress: (done) => { if (alive.current && current === generation.current) setProgress(done); },
      });
      if (alive.current && current === generation.current) {
        setBatch(next); setRows(next.rows()); setChosen(new Set(next.rows().filter(selectable).map((row) => row.path)));
      }
    } catch (cause) {
      if (alive.current && current === generation.current) setError(failure(cause));
    } finally {
      client?.close();
      if (worker.current === client) worker.current = undefined;
      if (alive.current && current === generation.current) setChecking(false);
    }
  }, [store]);
  useEffect(() => {
    alive.current = true;
    void review();
    return () => { alive.current = false; generation.current++; worker.current?.close(); };
  }, [review]);

  async function change(undo = false) {
    if (working.current || !batch) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (undo) await store.undoTidyBatch();
      else await store.applyTidyBatch(batch, [...chosen]);
    } catch (cause) { if (alive.current) setError(failure(cause)); }
    finally {
      working.current = false;
      if (alive.current) {
        const current = batch.rows();
        setRows(current); setChosen((previous) => new Set(current.filter((row) => selectable(row) && previous.has(row.path)).map((row) => row.path)));
        setBusy(false);
      }
    }
  }
  const ready = rows.filter(selectable);
  const selected = ready.filter((row) => chosen.has(row.path));
  const applied = rows.filter((row) => row.status === "applied").length;
  return <WorkspaceDialog title="Batch Tidy" className="tidyBatchDialog" returnFocus={returnFocus} busy={busy} onClose={onClose} closeIcon={<TidyIcon name="close" />}>
    <p>Review {sheets(captured.current.length)} in {store.api.getState().record.name}. Nothing is formatted until you choose Apply.</p>
    <div className="tidyBatchActions">
      <button className="primaryButton" disabled={checking || busy || !owned || !selected.length} onClick={() => void change()}><TidyIcon name="apply" />{busy ? "Working…" : `Apply to ${sheets(selected.length)}`}</button>
      <button disabled={checking || busy} onClick={() => void review()}>Review again</button>
      <button disabled={busy || checking || !owned || !batch?.hasUndo()} onClick={() => void change(true)}>Undo batch</button>
    </div>
    {checking && <p role="status">Checking {progress} of {sheets(captured.current.length)}…</p>}
    {!checking && <p role="status">{sheets(ready.length)} with changes · {applied} applied</p>}
    {!owned && <p>This Space is read-only. You can review changes; choose Use here in the workspace to apply them.</p>}
    {error && <p className="errorNotice" role="alert">{error}</p>}
    {!!ready.length && <label className="tidyBatchChoice tidyBatchSelectAll"><input type="checkbox" aria-label="Select all Tidy changes" disabled={busy} checked={selected.length === ready.length} onChange={(event) => setChosen(new Set(event.target.checked ? ready.map((row) => row.path) : []))} />Select all changes</label>}
    <div className="tidyBatchRows" aria-label="Reviewed sheets" aria-busy={checking || busy}>
      {rows.slice(0, limit).map((row) => <article key={row.path} className="tidyFix tidyBatchRow" aria-label={row.path}>
        <div className="tidyBatchRowHeader">
          <label className="tidyBatchChoice"><input type="checkbox" aria-label={`Apply fixes to ${row.path}`} disabled={busy || !selectable(row)} checked={selectable(row) && chosen.has(row.path)} onChange={(event) => { const next = new Set(chosen); if (event.target.checked) next.add(row.path); else next.delete(row.path); setChosen(next); }} /><strong>{row.path}</strong></label>
          <span>{status(row)}</span>
        </div>
        {!!row.manual && <p>{row.manual} {row.manual === 1 ? "item still needs" : "items still need"} review.</p>}
        {row.error && <p role="alert">{row.error}</p>}
        {row.before !== undefined && row.after !== undefined && row.before !== row.after && <button className="tidyDiffButton" disabled={busy} aria-expanded={expanded === row.path} onClick={() => setExpanded(expanded === row.path ? undefined : row.path)}><TidyIcon name="diff" />{expanded === row.path ? "Hide diff" : "Review diff"}</button>}
        {expanded === row.path && <div className="tidyDiffColumns"><section><h3>Before</h3><pre className="tidyBatchBefore">{row.before}</pre></section><section><h3>After</h3><pre className="tidyBatchAfter">{row.after}</pre></section></div>}
      </article>)}
      {rows.length > limit && <button onClick={() => setLimit((value) => value + 100)}>Show more sheets ({rows.length - limit} remaining)</button>}
      {!checking && !rows.length && !error && <p>No sheets to review.</p>}
    </div>
    <p className="tidyBatchFooter">Tidy preserves your words. Originals stay in this Space. Undo batch restores the reviewed files; it is also available in Sheet actions after closing this review.</p>
  </WorkspaceDialog>;
}
