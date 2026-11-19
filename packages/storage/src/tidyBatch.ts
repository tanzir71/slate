import { applyTextChanges } from "@slate/core";
import { readTidyConfiguration, type TidyConfiguration } from "@slate/core/tidy/settings";
import type { TidyResult } from "@slate/core/tidy";
import { createTidyFileStore } from "./browserTidy";
import { decodeText, safeWorkspacePath } from "./fileIO";
import type { FileSpace } from "./fileSpace";

type Status = "ready" | "unchanged" | "unsupported" | "unavailable" | "failed" | "conflict" | "applied" | "undone" | "undo-failed";
export interface BatchTidyRow {
  readonly path: string;
  readonly status: Status;
  readonly fixes: number;
  readonly manual: number;
  readonly before?: string | undefined;
  readonly after?: string | undefined;
  readonly error?: string | undefined;
  readonly historyPath?: string | undefined;
  readonly recoveryPath?: string | undefined;
}
export interface BatchTidySession {
  rows(): readonly BatchTidyRow[];
  hasUndo(): boolean;
  apply(paths: readonly string[]): Promise<void>;
  undo(): Promise<void>;
}
interface Plan { row: BatchTidyRow; base: Uint8Array | undefined }
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const same = (a: Uint8Array | undefined, b: Uint8Array | undefined) => a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((byte, index) => byte === b[index]));
const undoable = (plan: Plan) => plan.row.status === "applied" || plan.row.status === "undo-failed";

/** Capture disk/configuration snapshots. Review itself creates no files. */
export async function prepareTidyBatch({ space, paths, group, fix, canWrite, onProgress }: {
  space: FileSpace;
  paths: readonly string[];
  group: string;
  fix(source: string, configuration: TidyConfiguration): Promise<TidyResult>;
  canWrite(): boolean;
  onProgress?(done: number, total: number): void;
}): Promise<BatchTidySession> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(group)) throw new Error("Invalid batch history group.");
  const targets = [...new Set(paths.map((path) => {
    const target = safeWorkspacePath(path);
    if (!/\.md$/i.test(target) || target.split("/").includes(".slate")) throw new Error("Review only ordinary Markdown sheets.");
    return target;
  }))];
  const settings = createTidyFileStore(space);
  const snapshot = await settings.read();
  if (snapshot.status !== "valid" && snapshot.status !== "missing") throw new Error(snapshot.error ?? "Review the Tidy settings before checking this batch.");
  const settingsBytes = snapshot.bytes?.slice();
  const configuration = snapshot.configuration ?? readTidyConfiguration();
  const plans = new Map<string, Plan>();
  for (const path of targets) {
    const plan: Plan = { row: { path, status: "unavailable", fixes: 0, manual: 0 }, base: undefined };
    plans.set(path, plan);
    await review(plan);
    onProgress?.(plans.size, targets.length);
  }

  async function review(plan: Plan) {
    try {
      const bytes = await space.files.read(plan.row.path);
      if (bytes === undefined) throw new Error("This sheet no longer exists. Refresh the workspace.");
      plan.base = bytes.slice();
      let source: string;
      try { source = decodeText(plan.base, true); }
      catch { plan.row = { ...plan.row, status: "unsupported", error: "This sheet is not valid UTF-8. Its original bytes are preserved." }; return; }
      const result = await fix(source, configuration);
      if (result.source !== source || applyTextChanges(source, result.changes) !== result.output) throw new Error("The Tidy result does not match this sheet snapshot.");
      plan.row = { ...plan.row, status: result.output === source ? "unchanged" : "ready", before: source, after: result.output, fixes: result.applied.length, manual: result.issues.length };
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && "name" in cause && cause.name === "AbortError") throw cause;
      plan.row = { ...plan.row, error: message(cause) };
    }
  }
  function writable() {
    if (!canWrite()) throw new Error("This Space is read-only. Choose Use here to edit.");
  }
  async function currentRules() {
    const current = await settings.read();
    if (current.status !== snapshot.status || !same(current.bytes, settingsBytes)) throw new Error("The Tidy rules changed. Review this batch again.");
  }
  async function keepOriginal(plan: Plan) {
    const existing = plan.row.historyPath;
    if (existing && same(await space.files.read(existing), plan.base)) return;
    const copy = await space.create(`.slate/history/${group}/${plan.row.path}`, plan.row.before!);
    plan.row = { ...plan.row, historyPath: copy.path };
  }
  async function applyOne(plan: Plan): Promise<boolean> {
    try {
      writable();
      await currentRules();
      if (!same(await space.files.read(plan.row.path), plan.base)) {
        plan.row = { ...plan.row, status: "conflict", error: "This sheet changed after review. Review its current words again." };
        return false;
      }
      await keepOriginal(plan);
      await currentRules();
      writable();
      const saved = await space.saveSnapshot(plan.row.path, plan.row.after!, plan.base);
      plan.row = { ...plan.row, status: saved.conflict ? "conflict" : "applied", recoveryPath: saved.conflict ? saved.path : undefined, error: saved.conflict ? `An external edit was kept. The reviewed proposal is in ${saved.path}.` : undefined };
      return !saved.conflict;
    } catch (cause) {
      plan.row = { ...plan.row, status: "failed", error: message(cause) };
      return false;
    }
  }
  async function undoOne(plan: Plan): Promise<boolean> {
    try {
      writable();
      const bytes = await space.files.read(plan.row.path);
      if (same(bytes, plan.base)) { plan.row = { ...plan.row, status: "undone", error: undefined }; return true; }
      if (bytes === undefined || decodeText(bytes, true) !== plan.row.after) throw new Error(`This sheet changed after the batch. Your original is in ${plan.row.historyPath}.`);
      const restored = await space.saveSnapshot(plan.row.path, plan.row.before!, bytes);
      if (restored.conflict) throw new Error(`Newer words were kept. Your original is in ${restored.path}.`);
      plan.row = { ...plan.row, status: "undone", error: undefined };
      return true;
    } catch (cause) {
      plan.row = { ...plan.row, status: "undo-failed", error: message(cause) };
      return false;
    }
  }
  let pending: Promise<unknown> = Promise.resolve();
  function serialize(work: () => Promise<void>) {
    const next = pending.then(work);
    pending = next.catch(() => undefined);
    return next;
  }
  return {
    rows: () => [...plans.values()].map((plan) => ({ ...plan.row })),
    hasUndo: () => [...plans.values()].some(undoable),
    apply(selected) {
      const captured = [...new Set(selected)];
      return serialize(async () => {
        for (const path of captured) if (!plans.has(path)) throw new Error("Choose only the sheets in this reviewed batch.");
        writable();
        await currentRules();
        for (const path of captured) {
          const plan = plans.get(path)!;
          if ((plan.row.status === "ready" || plan.row.status === "failed") && !await applyOne(plan)) break;
        }
      });
    },
    undo() {
      return serialize(async () => {
        writable();
        for (const plan of [...plans.values()].reverse()) if (undoable(plan) && !await undoOne(plan)) break;
      });
    },
  };
}
