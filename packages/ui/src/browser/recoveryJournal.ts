import {
  applyTextChanges,
  matchesTextChanges,
  type TextChange,
} from "@slate/core";

export interface RecoveryDraft {
  content: string;
  baseContent: string | undefined;
}
interface Chain extends RecoveryDraft {
  base: string;
  edits: TextChange[][];
}
export interface RecoveryEdit {
  path: string;
  before: string;
  changes: readonly TextChange[];
}
type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DeltaEntry = Pick<Chain, "base" | "edits">;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const draft = (value: unknown): value is RecoveryDraft =>
  record(value) &&
  typeof value.content === "string" &&
  (value.baseContent === undefined || typeof value.baseContent === "string");

/** Base snapshots are committed before the small, atomic journal entry that references them. */
export function createRecoveryJournal(
  id: string,
  storage: JournalStorage = localStorage,
) {
  const key = `slate.recovery-v2.${id}`;
  const legacyKey = `slate.recovery.${id}`;
  let legacyPresent = false;
  const prefix = `slate.recovery-base.${id}.`;
  const session = crypto.randomUUID();
  let sequence = 0;
  let chains = new Map<string, Chain>();
  const bases = new Set<string>();

  function decodeEntry(entry: unknown): RecoveryDraft | Chain | undefined {
    if (draft(entry))
      return { content: entry.content, baseContent: entry.baseContent };
    if (
      !record(entry) ||
      typeof entry.base !== "string" ||
      !entry.base.startsWith(prefix) ||
      !Array.isArray(entry.edits)
    )
      return undefined;
    const baseRaw = storage.getItem(entry.base);
    const base: unknown = baseRaw ? JSON.parse(baseRaw) : null;
    if (!draft(base))
      throw new Error(
        "Recovery snapshot is missing or invalid. Original files and recovery data were kept.",
      );
    let content = base.content;
    const edits: TextChange[][] = [];
    for (const batch of entry.edits) {
      if (
        !Array.isArray(batch) ||
        !batch.every(
          (change: unknown) =>
            record(change) &&
            typeof change.from === "number" &&
            typeof change.to === "number" &&
            typeof change.text === "string",
        )
      )
        throw new Error(
          "Invalid recovery edits. Original files and recovery data were kept.",
        );
      const changes = batch as TextChange[];
      content = applyTextChanges(content, changes);
      edits.push(changes);
    }
    bases.add(entry.base);
    return { content, baseContent: base.baseContent, base: entry.base, edits };
  }

  function entries(raw: string | null, versioned: boolean) {
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      versioned &&
      (!record(parsed) || parsed.version !== 2 || !record(parsed.drafts))
    )
      throw new Error(
        "Unsupported recovery version. Original files and recovery data were kept.",
      );
    const source = versioned && record(parsed) ? parsed.drafts : parsed;
    return record(source) ? Object.entries(source) : [];
  }

  function read(): Map<string, RecoveryDraft> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = storage.getItem(key);
      const legacy = storage.getItem(legacyKey);
      const changed = () =>
        storage.getItem(key) !== raw || storage.getItem(legacyKey) !== legacy;
      try {
        const result = new Map<string, RecoveryDraft>();
        const next = new Map<string, Chain>();
        for (const [path, entry] of [
          ...entries(raw, true),
          ...entries(legacy, false),
        ]) {
          const decoded = decodeEntry(entry);
          if (!decoded)
            throw new Error(
              "Unrecognized recovery entry. Original files and recovery data were kept.",
            );
          let target = path;
          if (
            result.has(path) &&
            result.get(path)!.content !== decoded.content
          ) {
            let suffix = 1;
            do {
              target = path.replace(
                /(\.[^/.]+)?$/,
                ` (recovered earlier app ${suffix++})$1`,
              );
            } while (
              result.has(target) &&
              result.get(target)!.content !== decoded.content
            );
          }
          if (result.has(target)) continue;
          result.set(target, {
            content: decoded.content,
            baseContent: target === path ? decoded.baseContent : undefined,
          });
          if (target === path && "base" in decoded) next.set(path, decoded);
        }
        if (changed()) continue;
        chains = next;
        legacyPresent = legacy !== null;
        return result;
      } catch (error) {
        if (!changed()) throw error;
      }
    }
    throw new Error(
      "Recovery changed while opening. Retry this Space; files and recovery data were kept.",
    );
  }

  function save(
    drafts: ReadonlyMap<string, RecoveryDraft>,
    edit?: RecoveryEdit,
  ) {
    const entries: Record<string, RecoveryDraft | DeltaEntry> = Object.create(
      null,
    ) as Record<string, RecoveryDraft | DeltaEntry>;
    const next = new Map<string, Chain>();
    for (const [path, value] of drafts) {
      const prior = chains.get(path);
      let chain =
        prior?.content === value.content &&
        prior.baseContent === value.baseContent
          ? prior
          : undefined;
      if (edit?.path === path) {
        try {
          if (matchesTextChanges(edit.before, edit.changes, value.content)) {
            let base = prior?.base;
            let edits = prior?.edits;
            if (
              !prior ||
              prior.content !== edit.before ||
              prior.baseContent !== value.baseContent ||
              prior.edits.length >= 128
            ) {
              base = `${prefix}${session}.${++sequence}`;
              storage.setItem(
                base,
                JSON.stringify({
                  content: edit.before,
                  baseContent: value.baseContent,
                }),
              );
              bases.add(base);
              edits = [];
            }
            chain = {
              ...value,
              base: base!,
              edits: [...edits!, [...edit.changes]],
            };
          }
        } catch {
          /* Full snapshots remain a safe fallback if a base cannot be stored. */
        }
      }
      entries[path] = chain ? { base: chain.base, edits: chain.edits } : value;
      if (chain) next.set(path, chain);
    }
    if (drafts.size)
      storage.setItem(key, JSON.stringify({ version: 2, drafts: entries }));
    else storage.removeItem(key);
    if (legacyPresent) {
      storage.removeItem(legacyKey);
      legacyPresent = false;
    }
    // Never delete a base until the replacement journal has committed successfully.
    const active = new Set([...next.values()].map((chain) => chain.base));
    for (const base of bases)
      if (!active.has(base)) {
        storage.removeItem(base);
        bases.delete(base);
      }
    chains = next;
  }
  return { read, save };
}
