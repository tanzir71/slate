import { applyTextChanges, type TextChange } from "../textChanges.js";
import { preservesContent } from "./projection.js";

export type GuardedTidyFix =
  | { readonly kind: "unchanged"; readonly source: string }
  | {
      readonly kind: "applied";
      readonly source: string;
      readonly changes: readonly Readonly<TextChange>[];
    }
  | {
      readonly kind: "rejected";
      readonly source: string;
      readonly reason: "invalid-changes" | "content-change";
    };

/** Every proposal uses original UTF-16 offsets and is applied atomically or rejected intact. */
export function guardFix(
  source: string,
  changes: readonly TextChange[],
): GuardedTidyFix {
  // Snapshot caller-owned proposals before validation, so accepted editor changes match the proof.
  const snapshot = changes.map(({ from, to, text }) => ({ from, to, text }));
  let candidate: string;
  try {
    candidate = applyTextChanges(source, snapshot);
  } catch {
    return { kind: "rejected", source, reason: "invalid-changes" };
  }
  if (candidate === source) return { kind: "unchanged", source };
  if (!preservesContent(source, candidate))
    return { kind: "rejected", source, reason: "content-change" };
  return { kind: "applied", source: candidate, changes: snapshot };
}
