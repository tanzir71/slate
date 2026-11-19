import { expect, it, vi } from "vitest";
import { parseSheet, type SheetDocument } from "@slate/core";
import { hydrateSummaries, summaryMetadata } from "../src/browser/sheetSummaryProtocol";
import { createSheetSummaryCache } from "../src/browser/sheetSummaries";
import { createSheetSummaryClient } from "../src/browser/sheetSummaryClient";

it("adds semantic source positions to worker metadata without changing the input document", () => {
  const raw = "\uFEFF---\r\ntitle: Kept\r\n---\r\n\r\n## Goals\r\n\r\n```md\r\n# Hidden\r\n```\r\n";
  const document = parseSheet(raw, "Plan.md");
  const metadata = summaryMetadata([document]);
  expect(metadata[0]?.headings).toEqual([{ label: "Goals", depth: 2, from: raw.indexOf("##"), to: raw.indexOf("##") + 8, line: 5, root: true }]);
  expect(document.headings).toBeUndefined();
  expect(metadata[0]).not.toHaveProperty("raw"); expect(metadata[0]).not.toHaveProperty("body");
});
it("upgrades an existing raw-identical document once and preserves identities across cloned worker replies", () => {
  const raw = "# Goals\n\nWords kept.\n", path = "Plan.md";
  const document = parseSheet(raw, path), metadata = summaryMetadata([document]);
  const inputs = [{ path, content: raw }];
  const first = hydrateSummaries(inputs, metadata, [document]);
  expect(first[0]).not.toBe(document);
  expect(first[0]?.headings).toMatchObject([{ label: "Goals", from: 0, line: 1 }]);
  const cloned = metadata.map((row) => row.headings ? { ...row, headings: row.headings.map((heading) => ({ ...heading })) } : { ...row });
  expect(hydrateSummaries(inputs, cloned, first)[0]).toBe(first[0]);
});
it("recomputes moved heading positions after a file edit while retaining other cached documents", () => {
  const cache = createSheetSummaryCache();
  const before = [{ path: "One.md", content: "# Goals\n" }, { path: "Two.md", content: "# Unchanged\n" }];
  const first = cache(before), firstMetadata = summaryMetadata(first);
  const changed = [{ path: "One.md", content: "\r\n\r\n# Goals\r\n" }, before[1]!];
  const next = cache(changed), nextMetadata = summaryMetadata(next);
  expect(next[1]).toBe(first[1]);
  expect(firstMetadata[0]?.headings).toMatchObject([{ from: 0, line: 1 }]);
  expect(nextMetadata[0]?.headings).toMatchObject([{ from: 4, line: 3 }]);
  expect(nextMetadata[1]?.headings).toBe(firstMetadata[1]?.headings);
});
it("keeps heading navigation available when workers cannot start, with stable unchanged document identities", async () => {
  vi.useFakeTimers();
  const changed = vi.fn<(documents: SheetDocument[]) => void>();
  const client = createSheetSummaryClient(undefined, changed);
  try {
    const files = [{ path: "Plan.md", content: "# Goals\r\n\r\nWords kept.\r\n" }];
    client.read(files); await vi.runAllTimersAsync();
    const first = changed.mock.calls[0]![0][0]!;
    expect(first.headings).toMatchObject([{ label: "Goals", from: 0, line: 1 }]);
    expect(first.raw).toBe(files[0]!.content);
    client.read(files); await vi.runAllTimersAsync();
    expect(changed).toHaveBeenCalledTimes(1);
    client.read([...files, { path: "Other.md", content: "# Other" }]); await vi.runAllTimersAsync();
    expect(changed.mock.calls[1]![0][0]).toBe(first);
  } finally { client.close(); vi.useRealTimers(); }
});
