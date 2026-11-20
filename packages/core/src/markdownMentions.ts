import { markdownTextRanges, type MarkdownTextRange as Range } from "./markdownText.js";
import { markdownBodyFrom } from "./markdownBody.js";
import { applyTextChanges, type TextChange } from "./textChanges.js";
import { wikiCompletionText, type WikiCompletionTarget } from "./wikiCompletion.js";

export interface MarkdownMentionDocument { readonly source: string; readonly ranges: readonly Range[] }
export interface MarkdownMention extends Range { readonly text: string }
export interface MarkdownMentionPlan {
  readonly source: string;
  readonly target: WikiCompletionTarget;
  readonly mentions: readonly MarkdownMention[];
  readonly changes: readonly TextChange[];
  readonly output: string;
}
/** Protect literal/unfinished wiki syntax too, including an escaped opening. */
function wikiRanges(source: string, from: number): Range[] {
  const ranges: Range[] = [], opening = /\[\[/g;
  opening.lastIndex = from;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    const start = match.index, tail = source.slice(start), line = tail.search(/[\r\n]/);
    const length = line < 0 ? tail.length : line, close = tail.slice(0, length).indexOf("]]", 2);
    const end = start + (close >= 0 ? close + 2 : length);
    ranges.push({ from: start, to: end }); opening.lastIndex = end;
  }
  return ranges;
}
function withoutWikis(ranges: readonly Range[], protectedRanges: readonly Range[]): Range[] {
  const result: Range[] = []; let first = 0;
  for (const range of ranges) {
    while (first < protectedRanges.length && protectedRanges[first]!.to <= range.from) first++;
    let cursor = range.from;
    for (let index = first; index < protectedRanges.length && protectedRanges[index]!.from < range.to; index++) {
      const protectedRange = protectedRanges[index]!;
      if (protectedRange.from > cursor) result.push({ from: cursor, to: protectedRange.from });
      cursor = Math.max(cursor, Math.min(range.to, protectedRange.to));
    }
    if (cursor < range.to) result.push({ from: cursor, to: range.to });
  }
  return result;
}

/** Cache this semantic scan off the typing path; matching another title reuses its ranges. */
export function scanMarkdownMentionText(source: string): MarkdownMentionDocument {
  const bodyFrom = markdownBodyFrom(source), ranges = markdownTextRanges(source, bodyFrom);
  return { source, ranges: withoutWikis(ranges, wikiRanges(source, bodyFrom)) };
}
const word = (text: string) => /[\p{L}\p{M}\p{N}_]/u.test(text);
const previousCharacter = (source: string, offset: number) => source.slice(Math.max(0, offset - 2), offset).match(/.$/u)?.[0] ?? "";
const nextCharacter = (source: string, offset: number) => offset < source.length ? String.fromCodePoint(source.codePointAt(offset)!) : "";

export function findMarkdownMentions(document: MarkdownMentionDocument, title: string): readonly MarkdownMention[] {
  if (!title || title !== title.trim() || /[\r\n\0]/.test(title)) return [];
  const pattern = new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), mentions: MarkdownMention[] = [];
  const startsWord = word(nextCharacter(title, 0)), endsWord = word(previousCharacter(title, title.length));
  for (const range of document.ranges) {
    pattern.lastIndex = 0;
    const text = document.source.slice(range.from, range.to);
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const from = range.from + match.index, to = from + match[0].length;
      if ((!startsWord || !word(previousCharacter(document.source, from))) && (!endsWord || !word(nextCharacter(document.source, to))))
        mentions.push({ from, to, text: match[0] });
    }
  }
  return mentions;
}

export function planMarkdownMentionLinks(document: MarkdownMentionDocument, target: WikiCompletionTarget): MarkdownMentionPlan | undefined {
  if (!wikiCompletionText(target) || !target.title || /[\r\n\0\]]/.test(target.title)) return;
  const mentions = findMarkdownMentions(document, target.title);
  const changes = mentions.map(({ from, to, text }) => ({ from, to, text: wikiCompletionText({ ...target, title: text })! }));
  return { source: document.source, target: { ...target }, mentions, changes, output: applyTextChanges(document.source, changes) };
}
