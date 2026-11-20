import type { MentionInput, MentionRead, MentionReply, MentionRequest, MentionRow, MentionSnapshot } from "./inspectorMentionProtocol";

export interface MentionWorker {
  postMessage(request: MentionRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<MentionReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export function createInspectorMentionClient(worker: MentionWorker | undefined, onSnapshot: (snapshot: MentionSnapshot) => void) {
  let active = true, failed = !worker, id = 0, inFlight: number | undefined;
  let latest: MentionRead = { sheets: [], target: undefined }, sent = new Map<string, MentionInput>();
  const rows = new Map<string, MentionRow>();
  function fail(error = "Mentions could not load. Close and reopen the Inspector to try again.") {
    if (!active) return;
    if (!failed) { failed = true; worker?.terminate(); }
    onSnapshot({ status: "unavailable", error });
  }
  function post() {
    if (!active || failed || inFlight !== undefined) return;
    const next = new Map(latest.sheets.filter(sheet => !sheet.unsupportedEncoding).map(sheet => [sheet.path, sheet]));
    const changed = [...next.values()].filter(sheet => sent.get(sheet.path)?.content !== sheet.content);
    const removed = [...sent.keys()].filter(path => !next.has(path));
    inFlight = id; sent = next;
    try { worker!.postMessage({ id, target: latest.target, changed, removed }); }
    catch { fail(); }
  }
  if (worker) {
    worker.onmessage = ({ data }) => {
      if (!active || failed || data.id !== inFlight) return;
      inFlight = undefined;
      if (data.error) { fail(data.error); return; }
      // A superseded initial reply still seeds the cache for subsequent deltas.
      if (data.reset) rows.clear();
      for (const path of data.removed) rows.delete(path);
      for (const row of data.changed) rows.set(row.path, row);
      if (data.id === id) onSnapshot({ status: "ready", review: latest, rows: [...rows.values()] });
      else post();
    };
    worker.onerror = event => { event.preventDefault(); fail(); };
  }
  return {
    read(input: MentionRead) {
      if (!active) return;
      if (failed) { fail(); return; }
      latest = { target: input.target ? { ...input.target } : undefined, sheets: input.sheets.map(sheet => ({ ...sheet })) }; id++;
      onSnapshot({ status: "pending" }); post();
    },
    close() {
      if (!active) return;
      active = false;
      if (worker) { worker.onmessage = null; worker.onerror = null; if (!failed) worker.terminate(); }
    },
  };
}
