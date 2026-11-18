import { builtinBlocks } from "./blocks.js";

export interface BlockUsage {
  count: number;
  lastUsed: number;
}
export type BlockDefinition = (typeof builtinBlocks)[number];

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
function matchScore(value: string, query: string) {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  if (value.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (value.includes(query)) return 3;
  let position = 0;
  for (const character of query) {
    const next = value.indexOf(character, position);
    if (next < 0) return Infinity;
    position = next + 1;
  }
  return 4 + (position - query.length) / Math.max(1, value.length);
}

/** Prefixes win over fuzzy matches; use history only to break matching ties. */
export function searchBuiltinBlocks(
  query: string,
  usage: Readonly<Record<string, BlockUsage>> = {},
  now = 0,
): BlockDefinition[] {
  const needle = normalized(query);
  const score = (block: BlockDefinition) =>
    needle
      ? Math.min(
          ...[block.label, block.id, ...block.aliases].map((value) =>
            matchScore(normalized(value), needle),
          ),
        )
      : 0;
  const frequency = (id: string) => {
    const entry = usage[id];
    if (
      !entry ||
      !Number.isFinite(entry.count) ||
      !Number.isFinite(entry.lastUsed)
    )
      return 0;
    const age = Math.max(0, now - entry.lastUsed) / 86_400_000;
    return Math.log2(Math.max(0, entry.count) + 1) / (1 + age / 7);
  };
  return builtinBlocks
    .map((block, index) => ({
      block,
      index,
      score: score(block),
      frequency: frequency(block.id),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort(
      (left, right) =>
        left.score - right.score ||
        right.frequency - left.frequency ||
        (needle ? left.block.label.localeCompare(right.block.label, "en") : 0) ||
        left.index - right.index,
    )
    .map(({ block }) => block);
}
