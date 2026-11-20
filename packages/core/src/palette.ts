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
const cachedCharacterCount = 5;
const countsPerField = cachedCharacterCount * 2;
interface CharacterRequirement { offset: number; mask: number }
/** Necessary ASCII counts only. Other code points keep the existing scorer. */
function writeCharacterCounts(value: string, counts: Uint32Array, from: number) {
  for (let position = 0; position < value.length; position++) {
    const code = value.charCodeAt(position);
    const slot = code >= 97 && code <= 122 ? code - 97 : code >= 48 && code <= 57 ? code - 48 + 26 : -1;
    if (slot < 0) continue;
    const word = slot >>> 5, bit = 1 << (slot & 31);
    for (let count = 0; count < cachedCharacterCount; count++) {
      const offset = from + count * 2 + word;
      if (counts[offset]! & bit) continue;
      counts[offset] = counts[offset]! | bit; break;
    }
  }
}
function characterRequirements(query: string) {
  const counts = new Uint32Array(countsPerField), required: CharacterRequirement[] = [];
  writeCharacterCounts(query, counts, 0);
  // Rare repeated characters reject candidates before common single letters.
  for (let offset = counts.length - 1; offset >= 0; offset--)
    if (counts[offset]) required.push({ offset, mask: counts[offset]! });
  return required;
}
function hasCharacters(counts: Uint32Array, from: number, required: readonly CharacterRequirement[]) {
  for (const { offset, mask } of required) if (((counts[from + offset]! & mask) >>> 0) !== mask) return false;
  return true;
}
function score(value: string, query: string, characters: readonly string[], counts: Uint32Array, from: number, required: readonly CharacterRequirement[]) {
  if (!query || value === query) return 0;
  if (value.length < query.length || !hasCharacters(counts, from, required)) return Infinity;
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
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    const found = value.indexOf(character, position);
    if (found < 0) return Infinity;
    position = found + character.length;
  }
  return 4 + (position - query.length) / Math.max(1, value.length);
}
interface IndexedEntry { item: PaletteEntry; label: string; countsFrom: number; other: readonly string[] }
interface Match { entry: IndexedEntry; score: number }
function entryScore(entry: IndexedEntry, query: string, characters: readonly string[], counts: Uint32Array, required: readonly CharacterRequirement[]) {
  let rank = score(entry.label, query, characters, counts, entry.countsFrom, required);
  if (rank === 0) return rank;
  for (let index = 0; index < entry.other.length; index++) {
    rank = Math.min(rank, score(entry.other[index]!, query, characters, counts, entry.countsFrom + (index + 1) * countsPerField, required) + 0.25);
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
  let fieldCount = 0;
  const indexed: IndexedEntry[] = entries.map((entry) => {
    const label = folded(entry.label);
    // The label's score always beats the same field with the secondary penalty.
    const other = [...new Set([entry.id, ...(entry.detail ? [entry.detail] : []), ...(entry.aliases ?? [])].map(folded))]
      .filter((value) => value !== label);
    fieldCount += 1 + other.length;
    return { item: { ...entry, ...(entry.aliases ? { aliases: [...entry.aliases] } : {}) }, label, other, countsFrom: 0 };
  }).sort(compareEntries);
  const counts = new Uint32Array(fieldCount * countsPerField);
  let countsFrom = 0;
  const kinds = new Map<PaletteKind, IndexedEntry[]>();
  for (const entry of indexed) {
    entry.countsFrom = countsFrom;
    writeCharacterCounts(entry.label, counts, countsFrom); countsFrom += countsPerField;
    for (const value of entry.other) { writeCharacterCounts(value, counts, countsFrom); countsFrom += countsPerField; }
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
      const characters = Array.from(query);
      const required = characterRequirements(query);
      const matches: Match[] = [];
      let total = 0;
      for (const entry of candidates) {
        if (options.accept?.(entry.item) === false) continue;
        const rank = entryScore(entry, query, characters, counts, required);
        if (!Number.isFinite(rank)) continue;
        total++;
        if (limit) retainBest(matches, { entry, score: rank }, limit);
      }
      return { mode, total, items: matches.map(({ entry }) => entry.item) };
    },
  };
}
