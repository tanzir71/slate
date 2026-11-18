import { startTransition, useEffect, useRef, useState } from "react";
import type { SheetDocument } from "@slate/core";
import { createSheetSummaryClient } from "./sheetSummaryClient";
import type { SummaryInput } from "./sheetSummaryProtocol";
import { createSheetSummaryScheduler } from "./sheetSummaryScheduler";

export function useSheetSummaries(sheets: readonly SummaryInput[]) {
  const [documents, setDocuments] = useState<SheetDocument[]>([]);
  const client = useRef<
    ReturnType<typeof createSheetSummaryScheduler> | undefined
  >(undefined);
  useEffect(() => {
    let worker: Worker | undefined;
    try {
      worker = new Worker(
        new URL("./sheetSummary.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      /* Editing remains available when worker startup is unavailable. */
    }
    const current = createSheetSummaryClient(worker, (next) =>
      startTransition(() => setDocuments(next)),
    );
    const scheduled = createSheetSummaryScheduler(current.read);
    client.current = scheduled;
    return () => {
      scheduled.close();
      current.close();
      client.current = undefined;
    };
  }, []);
  useEffect(() => {
    client.current?.read(sheets);
  }, [sheets]);
  return documents;
}
