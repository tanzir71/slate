import { markdownHeadings, type MarkdownHeading, type SheetDocument } from "@slate/core";
import { sheetPreview } from "./sheetPreview";

export interface SummaryInput {
  path: string;
  content: string;
}
export interface SummaryRequest {
  id: number;
  sheets: readonly SummaryInput[];
}
export type SheetSummary = Omit<SheetDocument, "raw" | "body"> & {
  bodyOffset: number;
  preview: string;
};
export interface SummaryReply {
  id: number;
  summaries: SheetSummary[];
}

/** Return metadata only; the main thread already owns the unchanged source strings. */
export function summaryMetadata(
  documents: readonly SheetDocument[],
): SheetSummary[] {
  return documents.map((document) => {
    let preview = previews.get(document);
    if (preview === undefined) {
      preview = sheetPreview(document.body);
      previews.set(document, preview);
    }
    const { raw, body, ...metadata } = sheetWithHeadings(document);
    return { ...metadata, preview, bodyOffset: raw.length - body.length };
  });
}
const previews = new WeakMap<SheetDocument, string>();
const outlines = new WeakMap<SheetDocument, SheetDocument>();

/** Share the same immutable heading metadata in worker and startup-fallback paths. */
export function sheetWithHeadings(document: SheetDocument): SheetDocument {
  let enriched = outlines.get(document);
  if (!enriched) {
    const headings: readonly MarkdownHeading[] = document.headings ?? markdownHeadings(document.raw);
    enriched = { ...document, headings };
    outlines.set(document, enriched);
  }
  return enriched;
}

export function hydrateSummaries(
  sheets: readonly SummaryInput[],
  summaries: readonly SheetSummary[],
  previous: readonly SheetDocument[],
): SheetDocument[] {
  const sources = new Map(sheets.map((sheet) => [sheet.path, sheet.content]));
  const cached = new Map(previous.map((sheet) => [sheet.path, sheet]));
  return summaries.map(({ bodyOffset, ...metadata }) => {
    const raw = sources.get(metadata.path);
    if (raw === undefined)
      throw new Error("A sheet summary has no source file.");
    const prior = cached.get(metadata.path);
    return prior?.raw === raw && (prior.headings !== undefined || metadata.headings === undefined)
      ? prior
      : { ...metadata, raw, body: raw.slice(bodyOffset) };
  });
}
