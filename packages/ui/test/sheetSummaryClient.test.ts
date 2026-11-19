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
    headings: [],
  });
  expect(document.updatedAt).toBeInstanceOf(Date);
  client.read(latest);
  reply(worker, 3, latest);
  expect(changed).toHaveBeenCalledTimes(1);
  const another = [...latest, { path: "C.md", content: "# Another" }];
  client.read(another); reply(worker, 4, another);
  expect(changed.mock.calls[1]![0][0]).toBe(document);
  client.close();
  client.read(old);
  expect(worker.postMessage).toHaveBeenCalledTimes(4);
  expect(worker.onmessage).toBeNull();
});

it.each(["worker", "fallback"])("publishes only changed ordered snapshots through the %s path", (path) => {
  vi.useFakeTimers();
  const worker = path === "worker" ? fakeWorker() : undefined;
  const changed = vi.fn<(documents: SheetDocument[]) => void>();
  const client = createSheetSummaryClient(worker, changed);
  let request = 0;
  function read(sheets: SummaryInput[]) {
    client.read(sheets);
    if (worker) reply(worker, ++request, sheets);
    else vi.runAllTimers();
  }
  const first = [{ path: "A.md", content: "# First" }, { path: "B.md", content: "# Kept" }];
  read(first);
  const documents = changed.mock.calls[0]![0];
  expect(documents[0]?.headings).toMatchObject([{ label: "First" }]);
  read(first.map((sheet) => ({ ...sheet })));
  expect(changed).toHaveBeenCalledTimes(1);
  read([...first].reverse());
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed.mock.calls[1]![0]).toEqual([documents[1], documents[0]]);
  read([{ path: "A.md", content: "# Changed" }, first[1]!]);
  expect(changed).toHaveBeenCalledTimes(3);
  expect(changed.mock.calls[2]![0][0]?.headings).toMatchObject([{ label: "Changed" }]);
  expect(changed.mock.calls[2]![0][1]).toBe(documents[1]);
  read([]); expect(changed).toHaveBeenCalledTimes(4);
  read([]); expect(changed).toHaveBeenCalledTimes(4);
  client.close();
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

it("keeps one worker job in flight and replaces queued edits with the latest snapshot", () => {
  const worker = fakeWorker();
  const changed = vi.fn<(documents: SheetDocument[]) => void>();
  const client = createSheetSummaryClient(worker, changed);
  const first = [{ path: "A.md", content: "# First" }];
  const skipped = [{ path: "A.md", content: "# Intermediate" }];
  const latest = [{ path: "B.md", content: "# Latest\n\nExact words #keep" }];
  client.read(first);
  client.read(skipped);
  client.read(latest);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  reply(worker, 1, first);
  expect(changed).not.toHaveBeenCalled();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 3, sheets: latest });
  reply(worker, 1, first);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  reply(worker, 3, latest);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0]![0][0]).toMatchObject(parseSheet(latest[0]!.content, "B.md"));
  client.close();
});

it("falls back to the newest queued edit when posting the next worker job fails", () => {
  vi.useFakeTimers();
  const worker = fakeWorker();
  vi.mocked(worker.postMessage).mockImplementationOnce(() => undefined).mockImplementation(() => { throw new Error("Worker stopped"); });
  const changed = vi.fn<(documents: SheetDocument[]) => void>();
  const client = createSheetSummaryClient(worker, changed);
  const first = [{ path: "A.md", content: "# Earlier" }];
  const latest = [{ path: "B.md", content: "# Latest\n\nKeep these words" }];
  client.read(first);
  client.read(latest);
  expect(worker.terminate).not.toHaveBeenCalled();
  reply(worker, 1, first);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0]![0][0]?.path).toBe("B.md");
  client.close();
});

it("uses the latest queued snapshot after a worker error and ignores late replies", () => {
  vi.useFakeTimers();
  const worker = fakeWorker();
  const changed = vi.fn<(documents: SheetDocument[]) => void>();
  const client = createSheetSummaryClient(worker, changed);
  const first = [{ path: "A.md", content: "# Earlier" }];
  const latest = [{ path: "B.md", content: "# Current\n\nKeep these words" }];
  client.read(first);
  client.read(latest);
  worker.onerror?.(new ErrorEvent("error"));
  worker.onerror?.(new ErrorEvent("error"));
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  reply(worker, 1, first);
  vi.runAllTimers();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0]![0][0]).toMatchObject(parseSheet(latest[0]!.content, "B.md"));
  client.close();
});

it("does not send a queued job or publish a reply after closing", () => {
  const worker = fakeWorker();
  const changed = vi.fn<(documents: SheetDocument[]) => void>();
  const client = createSheetSummaryClient(worker, changed);
  const first = [{ path: "A.md", content: "# First" }];
  client.read(first);
  client.read([{ path: "B.md", content: "# Queued" }]);
  const lateReply = worker.onmessage!;
  client.close();
  lateReply(new MessageEvent<SummaryReply>("message", { data: { id: 1, summaries: summaryMetadata([parseSheet(first[0]!.content, "A.md")]) } }));
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
});
