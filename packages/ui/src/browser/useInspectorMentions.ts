import { startTransition, useEffect, useRef, useState } from "react";
import { createInspectorMentionClient } from "./inspectorMentionClient";
import { createSheetSummaryScheduler } from "./sheetSummaryScheduler";
import type { MentionRead, MentionSnapshot } from "./inspectorMentionProtocol";

/** Mounted only with the Inspector; no semantic scan or fallback parse runs on the UI thread. */
export function useInspectorMentions(input: MentionRead): MentionSnapshot {
  const [snapshot, setSnapshot] = useState<MentionSnapshot>({ status: "pending" });
  const latest = useRef(input);
  const scheduled = useRef<ReturnType<typeof createSheetSummaryScheduler> | undefined>(undefined);
  useEffect(() => {
    let worker: Worker | undefined;
    try { worker = new Worker(new URL("./inspectorMentions.worker.ts", import.meta.url), { type: "module" }); }
    catch { /* Keep the editor available without moving parsing onto its typing path. */ }
    const client = createInspectorMentionClient(worker, next => startTransition(() => setSnapshot(next)));
    const scheduler = createSheetSummaryScheduler(() => client.read(latest.current)); scheduled.current = scheduler;
    return () => { scheduled.current = undefined; scheduler.close(); client.close(); };
  }, []);
  useEffect(() => {
    latest.current = input; setSnapshot({ status: "pending" }); scheduled.current?.read(input.sheets);
  }, [input]);
  return snapshot;
}
