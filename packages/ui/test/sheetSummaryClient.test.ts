import { afterEach, expect, it, vi } from "vitest";
import { parseSheet, type SheetDocument } from "@slate/core";
import {
  createSheetSummaryClient,
  type SummaryWorker,
} from "../src/browser/sheetSummaryClient";
import {
  summaryMetadata,
  type SummaryInput,
  type SummaryReply,
} from "../src/browser/sheetSummaryProtocol";

afterEach(() => vi.useRealTimers());
function fakeWorker(): SummaryWorker {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
}
function reply(worker: SummaryWorker, id: number, sheets: SummaryInput[]) {
  worker.onmessage?.(
    new MessageEvent<SummaryReply>("message", {
      data: {
        id,
        summaries: summaryMetadata(
          sheets.map((sheet) => parseSheet(sheet.content, sheet.path)),
        ),
      },
    }),
  );
}

it("applies only the latest worker snapshot, preserves source/frontmatter/date values and reuses unchanged documents", () => {
  const worker = fakeWorker();
  const changed = vi.fn<(documents: SheetDocument[]) => void>();
  const client = createSheetSummaryClient(worker, changed);
  const old = [{ path: "A.md", content: "# Old" }];
  const latest = [
    {
      path: "B.md",
      content:
        "---\r\ntitle: New\r\nupdated: 2026-11-18\r\n---\r\n\r\nExact **words** #tag\r\n",
    },
  ];
  client.read(old);
  client.read(latest);
  reply(worker, 1, old);
  expect(changed).not.toHaveBeenCalled();
  reply(worker, 2, latest);
  expect(changed).toHaveBeenCalledTimes(1);
  const document = changed.mock.calls[0]![0][0]!;
  expect(document).toEqual({
    ...parseSheet(latest[0]!.content, "B.md"),
    preview: "Exact words #tag",
  });
  expect(document.updatedAt).toBeInstanceOf(Date);
  client.read(latest);
  reply(worker, 3, latest);
  expect(changed.mock.calls[1]![0][0]).toBe(document);
  client.close();
  client.read(old);
  expect(worker.postMessage).toHaveBeenCalledTimes(3);
  expect(worker.onmessage).toBeNull();
});

it.each(["unavailable", "startup error", "post failure"])(
  "keeps summaries available after a worker %s and cancels stale fallback work",
  (failure) => {
    vi.useFakeTimers();
    const worker = failure === "unavailable" ? undefined : fakeWorker();
    if (failure === "post failure")
      worker!.postMessage = () => {
        throw new Error("Worker stopped");
      };
    const changed = vi.fn<(documents: SheetDocument[]) => void>();
    const client = createSheetSummaryClient(worker, changed);
    client.read([{ path: "A.md", content: "Old" }]);
    if (failure === "startup error") worker!.onerror?.(new ErrorEvent("error"));
    client.read([{ path: "B.md", content: "# Current\n\nWords #keep" }]);
    expect(changed).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(
      changed.mock.calls[0]![0].map(
        (document: { path: string }) => document.path,
      ),
    ).toEqual(["B.md"]);
    client.read([{ path: "C.md", content: "Close before parsing" }]);
    client.close();
    vi.runAllTimers();
    expect(changed).toHaveBeenCalledTimes(1);
  },
);
