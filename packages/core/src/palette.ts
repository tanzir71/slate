export type PaletteKind = "commands" | "sheets" | "tags" | "headings" | "blocks" | "snippets";
export type PaletteMode = "all" | PaletteKind;
export interface PaletteEntry {
  readonly id: string;
  readonly kind: PaletteKind;
  readonly label: string;
  readonly detail?: string;
  readonly aliases?: readonly string[];
}
export interface PaletteSearchResult {
  readonly mode: PaletteMode;
  readonly items: readonly PaletteEntry[];
  readonly total: number;
}
const prefixes: Readonly<Record<string, PaletteKind>> = {
  ">": "commands", "#": "tags", "@": "headings", "/": "blocks", ";": "snippets",
};
const order: Readonly<Record<PaletteKind, number>> = { commands: 0, sheets: 1, tags: 2, headings: 3, blocks: 4, snippets: 5 };

export function parsePaletteQuery(input: string, fallback: PaletteMode = "all") {
  const text = input.trim();
  const mode = prefixes[text[0] ?? ""];
  return { mode: mode ?? fallback, text: mode ? text.slice(1).trimStart() : text };
}
function folded(value: string) {
  // Fold Latin accents without dropping vowel/other meaningful marks in Bengali etc.
  const text = /[^\u0020-\u007e]/.test(value)
    ? value.normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC")
    : value;
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
function score(value: string, query: string) {
  if (!query || value === query) return 0;
  if (value.length < query.length) return Infinity;
  let occurrence = value.indexOf(query);
  if (occurrence === 0) return 1;
  if (occurrence > 0) {
    do {
      if (" /-_".includes(value[occurrence - 1]!)) return 2;
      occurrence = value.indexOf(query, occurrence + 1);
    } while (occurrence >= 0);
    return 3;
  }
  let position = 0;
  for (const character of query) {
    const found = value.indexOf(character, position);
    if (found < 0) return Infinity;
    position = found + character.length;
  }
  return 4 + (position - query.length) / Math.max(1, value.length);
}
interface IndexedEntry { item: PaletteEntry; label: string; other: readonly string[] }
interface Match { entry: IndexedEntry; score: number }
function entryScore(entry: IndexedEntry, query: string) {
  let rank = score(entry.label, query);
  if (rank === 0) return rank;
  for (const value of entry.other) {
    rank = Math.min(rank, score(value, query) + 0.25);
    if (rank === 0.25) break;
  }
  return rank;
}
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function compareEntries(left: IndexedEntry, right: IndexedEntry) {
  return order[left.item.kind] - order[right.item.kind] ||
    compareText(left.label, right.label) || compareText(left.item.id, right.item.id);
}
function compare(left: Match, right: Match) {
  return left.score - right.score || compareEntries(left.entry, right.entry);
}
function retainBest(matches: Match[], candidate: Match, limit: number) {
  if (!limit || (matches.length === limit && compare(candidate, matches.at(-1)!) >= 0)) return;
  let from = 0, to = matches.length;
  while (from < to) {
    const middle = (from + to) >>> 1;
    if (compare(candidate, matches[middle]!) < 0) to = middle;
    else from = middle + 1;
  }
  matches.splice(from, 0, candidate);
  if (matches.length > limit) matches.pop();
}

/** Capture metadata once; queries normalize only their input and retain bounded results.
 * IDs remain literal so two matching titles never become an ambiguous file action.
 */
export function createPaletteIndex(entries: readonly PaletteEntry[]) {
  const indexed: IndexedEntry[] = entries.map((entry) => {
    const label = folded(entry.label);
    // The label's score always beats the same field with the secondary penalty.
    const other = [...new Set([entry.id, ...(entry.detail ? [entry.detail] : []), ...(entry.aliases ?? [])].map(folded))]
      .filter((value) => value !== label);
    return { item: { ...entry, ...(entry.aliases ? { aliases: [...entry.aliases] } : {}) }, label, other };
  }).sort(compareEntries);
  const kinds = new Map<PaletteKind, IndexedEntry[]>();
  for (const entry of indexed) {
    const list = kinds.get(entry.item.kind);
    if (list) list.push(entry); else kinds.set(entry.item.kind, [entry]);
  }
  return {
    search(input: string, options: { mode?: PaletteMode; limit?: number; accept?(entry: PaletteEntry): boolean } = {}): PaletteSearchResult {
      const { mode, text } = parsePaletteQuery(input, options.mode);
      const limit = options.limit ?? 30;
      if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new RangeError("Choose a palette result limit from 0 to 100.");
      const query = folded(text);
      const candidates = mode === "all" ? indexed : kinds.get(mode) ?? [];
      if (!query) {
        if (!options.accept) return { mode, total: candidates.length, items: candidates.slice(0, limit).map((entry) => entry.item) };
        const items: PaletteEntry[] = [];
        let total = 0;
        for (const entry of candidates) {
          if (options.accept(entry.item) === false) continue;
          total++;
          if (items.length < limit) items.push(entry.item);
        }
        return { mode, total, items };
      }
      const matches: Match[] = [];
      let total = 0;
      for (const entry of candidates) {
        if (options.accept?.(entry.item) === false) continue;
        const rank = entryScore(entry, query);
        if (!Number.isFinite(rank)) continue;
        total++;
        if (limit) retainBest(matches, { entry, score: rank }, limit);
      }
      return { mode, total, items: matches.map(({ entry }) => entry.item) };
    },
  };
}
