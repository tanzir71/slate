import { startTransition, useEffect, useRef, useState } from "react";
import type { SheetDocument } from "@slate/core";
import { createSheetSummaryClient } from "./sheetSummaryClient";
import type { SummaryInput } from "./sheetSummaryProtocol";

export function useSheetSummaries(sheets: readonly SummaryInput[]) {
  const [documents, setDocuments] = useState<SheetDocument[]>([]);
  const client = useRef<
    ReturnType<typeof createSheetSummaryClient> | undefined
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
    client.current = current;
    return () => {
      current.close();
      client.current = undefined;
    };
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Clone large source strings for the worker after the editor's next paint.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => client.current?.read(sheets), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [sheets]);
  return documents;
}
