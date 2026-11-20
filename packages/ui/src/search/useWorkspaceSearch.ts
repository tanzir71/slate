import { useEffect, useRef, useState } from "react";
import { createSearchWorkerClient } from "./searchWorkerClient";
import type { SearchSheet, WorkspaceSearchResult } from "./searchResults";

interface Snapshot {
  sheets: readonly SearchSheet[]; query: string; matchCase: boolean; retry: number;
  result?: WorkspaceSearchResult; sources?: ReadonlyMap<string, string>; error?: string;
}
export function useWorkspaceSearch(sheets: readonly SearchSheet[], query: string, matchCase: boolean, retry: number) {
  const client = useRef<ReturnType<typeof createSearchWorkerClient> | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => () => { client.current?.close(); client.current = undefined; }, []);
  useEffect(() => {
    if (!query) return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        let requested: ReturnType<typeof createSearchWorkerClient> | undefined;
        try {
          client.current ??= createSearchWorkerClient(new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" }));
          requested = client.current;
          const result = await requested.search(sheets, query, { matchCase });
          if (alive) setSnapshot({ sheets, query, matchCase, retry, result, sources: new Map(sheets.map((sheet) => [sheet.path, sheet.content])) });
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          if (client.current === requested) { client.current?.close(); client.current = undefined; }
          if (!alive) return;
          setSnapshot({ sheets, query, matchCase, retry, error: cause instanceof Error ? cause.message : "Search could not finish. Try again." });
        }
      })();
    }, 150);
    return () => { alive = false; clearTimeout(timer); };
  }, [sheets, query, matchCase, retry]);
  const current = snapshot?.sheets === sheets && snapshot.query === query && snapshot.matchCase === matchCase && snapshot.retry === retry ? snapshot : undefined;
  return { result: query ? current?.result : undefined, sources: current?.sources, error: query ? current?.error : undefined,
    pending: !!query && !current };
}
