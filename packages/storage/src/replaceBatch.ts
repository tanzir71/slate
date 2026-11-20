import { planLiteralReplacement, type LiteralSearchOptions } from "@slate/core";
import { decodeText, encodeText, safeWorkspacePath } from "./fileIO";
import type { FileSpace } from "./fileSpace";

type Status = "ready" | "unchanged" | "unmatched" | "unsupported" | "unavailable" | "failed" | "conflict" | "applied" | "undone" | "undo-failed";
export interface ReplaceBatchRow {
  readonly path: string;
  readonly status: Status;
  readonly matches: number;
  readonly replacements: number;
  readonly before?: string | undefined;
  readonly after?: string | undefined;
  readonly error?: string | undefined;
  readonly historyPath?: string | undefined;
  readonly recoveryPath?: string | undefined;
}
export interface ReplaceBatchSession {
  rows(): readonly ReplaceBatchRow[];
  hasUndo(): boolean;
  apply(paths: readonly string[]): Promise<void>;
  undo(): Promise<void>;
}
interface Plan { row: ReplaceBatchRow; base: Uint8Array | undefined; proposed: Uint8Array | undefined }
const same = (a: Uint8Array | undefined, b: Uint8Array | undefined) => a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((byte, index) => byte === b[index]));
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const undoable = (plan: Plan) => plan.row.status === "applied" || plan.row.status === "undo-failed";

/** Review current disk snapshots without writing. Only explicitly selected reviewed paths can change. */
export async function prepareReplaceBatch({ space, paths, query, replacement, options = {}, group, canWrite, onProgress }: {
  space: FileSpace;
  paths: readonly string[];
  query: string;
  replacement: string;
  options?: LiteralSearchOptions;
  group: string;
  canWrite(): boolean;
  onProgress?(done: number, total: number): void;
}): Promise<ReplaceBatchSession> {
  if (!query) throw new Error("Enter text to find before previewing replacements.");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(group)) throw new Error("Invalid replacement history group.");
  const targets = [...new Set(paths.map((path) => {
    const target = safeWorkspacePath(path);
    if (!/\.md$/i.test(target) || target.split("/").some((part) => /^(?:\.slate|\.git)$/i.test(part)))
      throw new Error("Review only ordinary Markdown sheets.");
    return target;
  }))];
  const capturedOptions = { matchCase: options.matchCase === true };
  const plans = new Map<string, Plan>();
  for (const path of targets) {
    const plan: Plan = { row: { path, status: "unavailable", matches: 0, replacements: 0 }, base: undefined, proposed: undefined };
    plans.set(path, plan); await review(plan); onProgress?.(plans.size, targets.length);
  }
  async function review(plan: Plan) {
    try {
      const bytes = await space.files.read(plan.row.path);
      if (bytes === undefined) throw new Error("This sheet no longer exists. Search again.");
      const base = bytes.slice();
      let source: string;
      try { source = decodeText(base, true); }
      catch { plan.row = { ...plan.row, status: "unsupported", error: "This sheet is not valid UTF-8. Its original bytes are preserved." }; return; }
      const result = planLiteralReplacement(source, query, replacement, capturedOptions);
      if (!result.changes.length) {
        plan.row = { ...plan.row, status: result.matches ? "unchanged" : "unmatched", matches: result.matches }; return;
      }
      const proposed = encodeText(result.output);
      if (decodeText(proposed, true) !== result.output) throw new Error("The replacement contains text that cannot be saved as UTF-8.");
      plan.base = base; plan.proposed = proposed;
      plan.row = { ...plan.row, status: "ready", matches: result.matches, replacements: result.changes.length, before: source, after: result.output };
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && "name" in cause && cause.name === "AbortError") throw cause;
      plan.row = { ...plan.row, error: message(cause) };
    }
  }
  function writable() {
    if (!canWrite()) throw new Error("This Space is read-only. Choose Use here to edit.");
  }
  async function keepOriginal(plan: Plan) {
    if (plan.row.historyPath && same(await space.files.read(plan.row.historyPath), plan.base)) return;
    const copy = await space.create(`.slate/history/${group}/${plan.row.path}`, plan.row.before!);
    plan.row = { ...plan.row, historyPath: copy.path };
  }
  async function applyOne(plan: Plan) {
    try {
      writable();
      if (!same(await space.files.read(plan.row.path), plan.base)) {
        plan.row = { ...plan.row, status: "conflict", error: "This sheet changed after preview. Search its current words again." }; return false;
      }
      writable(); await keepOriginal(plan); writable();
      const saved = await space.saveSnapshot(plan.row.path, plan.row.after!, plan.base);
      plan.row = { ...plan.row, status: saved.conflict ? "conflict" : "applied", recoveryPath: saved.conflict ? saved.path : undefined,
        error: saved.conflict ? `Newer words were kept. The reviewed replacement is in ${saved.path}.` : undefined };
      return !saved.conflict;
    } catch (cause) { plan.row = { ...plan.row, status: "failed", error: message(cause) }; return false; }
  }
  async function undoOne(plan: Plan) {
    try {
      writable(); const bytes = await space.files.read(plan.row.path);
      if (same(bytes, plan.base)) { plan.row = { ...plan.row, status: "undone", error: undefined }; return true; }
      if (!same(bytes, plan.proposed)) throw new Error(`This sheet changed after replacement. Your original is in ${plan.row.historyPath}.`);
      writable(); const restored = await space.saveSnapshot(plan.row.path, plan.row.before!, bytes);
      if (restored.conflict) throw new Error(`Newer words were kept. Your original is in ${restored.path}.`);
      plan.row = { ...plan.row, status: "undone", error: undefined }; return true;
    } catch (cause) { plan.row = { ...plan.row, status: "undo-failed", error: message(cause) }; return false; }
  }
  let pending: Promise<unknown> = Promise.resolve();
  function serialize(work: () => Promise<void>) {
    const next = pending.then(work); pending = next.catch(() => undefined); return next;
  }
  return {
    rows: () => [...plans.values()].map((plan) => ({ ...plan.row })),
    hasUndo: () => [...plans.values()].some(undoable),
    apply(selected) {
      const captured = [...new Set(selected)];
      return serialize(async () => {
        for (const path of captured) if (!plans.has(path)) throw new Error("Choose only sheets in this replacement preview.");
        writable();
        for (const path of captured) {
          const plan = plans.get(path)!;
          if ((plan.row.status === "ready" || plan.row.status === "failed") && !await applyOne(plan)) break;
        }
      });
    },
    undo() {
      return serialize(async () => { writable(); for (const plan of [...plans.values()].reverse()) if (undoable(plan) && !await undoOne(plan)) break; });
    },
  };
}
