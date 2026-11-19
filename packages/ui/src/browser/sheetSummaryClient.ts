import type { SheetDocument } from "@slate/core";
import { createSheetSummaryCache } from "./sheetSummaries";
import {
  hydrateSummaries,
  sheetWithHeadings,
  type SummaryInput,
  type SummaryReply,
  type SummaryRequest,
} from "./sheetSummaryProtocol";

export interface SummaryWorker {
  postMessage(message: SummaryRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SummaryReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export function createSheetSummaryClient(
  worker: SummaryWorker | undefined,
  onDocuments: (documents: SheetDocument[]) => void,
) {
  let id = 0;
  let active = true;
  let fallback = !worker;
  let latest: readonly SummaryInput[] = [];
  let documents: SheetDocument[] = [];
  let published = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: number | undefined;
  let completed = 0;
  const summarize = createSheetSummaryCache();
  function publish(next: SheetDocument[]) {
    if (published && next.length === documents.length && next.every((document, index) => document === documents[index])) return;
    documents = next;
    published = true;
    onDocuments(documents);
  }
  function readOnMainThread() {
    clearTimeout(timer);
    const requested = id;
    timer = setTimeout(() => {
      if (active && requested === id) {
        publish(summarize(latest).map(sheetWithHeadings));
      }
    }, 0);
  }
  function useFallback() {
    if (!active || fallback) return;
    fallback = true;
    inFlight = undefined;
    worker?.terminate();
    readOnMainThread();
  }
  function postLatest() {
    if (!active || fallback || inFlight !== undefined || completed === id) return;
    inFlight = id;
    try {
      worker!.postMessage({ id, sheets: latest });
    } catch {
      useFallback();
    }
  }
  if (worker) {
    worker.onmessage = (event) => {
      if (!active || fallback || event.data.id !== inFlight) return;
      inFlight = undefined;
      completed = event.data.id;
      if (completed === id) {
        publish(hydrateSummaries(latest, event.data.summaries, documents));
      }
      postLatest();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      useFallback();
    };
  }
  return {
    read(sheets: readonly SummaryInput[]) {
      if (!active) return;
      latest = sheets;
      id++;
      if (fallback) readOnMainThread();
      else postLatest();
    },
    close() {
      active = false;
      clearTimeout(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
    },
  };
}
