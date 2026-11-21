export interface CaptureDraft {
  readonly id: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly text: string;
  readonly pending: boolean;
  readonly revision: number;
}
export interface CaptureCompleted {
  readonly id: string;
  readonly spaceId: string;
  readonly text: string;
  readonly path: string;
  readonly conflict: boolean;
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const captureRecoveryKey = "slate.native-capture.recovery.v1";
const MAX_TEXT = 1024 * 1024;
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw Error("Invalid Quick Capture response. Your recovery data was kept.");
  return value as Record<string, unknown>;
}
function spaceId(value: unknown): value is string { return typeof value === "string" && (value === "native-default" || uuid.test(value)); }
export function captureDraft(value: unknown): CaptureDraft {
  const draft = object(value);
  if (Object.keys(draft).some(key => !["id", "spaceId", "spaceName", "text", "pending", "revision"].includes(key)) || typeof draft.id !== "string" || !uuid.test(draft.id) || !spaceId(draft.spaceId) ||
      typeof draft.spaceName !== "string" || !draft.spaceName.trim() || typeof draft.text !== "string" ||
      new TextEncoder().encode(draft.text).length > MAX_TEXT || typeof draft.pending !== "boolean" ||
      draft.pending && !draft.text.trim() || !Number.isSafeInteger(draft.revision) || Number(draft.revision) < 0 || Number(draft.revision) >= Number.MAX_SAFE_INTEGER) throw Error("Invalid Quick Capture draft. Your recovery data was kept.");
  return { id: draft.id, spaceId: draft.spaceId, spaceName: draft.spaceName, text: draft.text, pending: draft.pending, revision: Number(draft.revision) };
}
export function captureCompleted(value: unknown): CaptureCompleted {
  const done = object(value);
  if (typeof done.id !== "string" || !uuid.test(done.id) || !spaceId(done.spaceId) || typeof done.text !== "string" ||
      !done.text.trim() || new TextEncoder().encode(done.text).length > MAX_TEXT || typeof done.conflict !== "boolean" ||
      done.path !== (done.conflict ? `Inbox/Capture (capture ${done.id}).md` : "Inbox/Capture.md")) throw Error("Invalid Quick Capture receipt. Your recovery data was kept.");
  return { id: done.id, spaceId: done.spaceId, text: done.text, path: done.path, conflict: done.conflict };
}
export function captureSnapshot(value: unknown) {
  const snapshot = object(value);
  return { activeDraft: snapshot.activeDraft === null ? null : captureDraft(snapshot.activeDraft),
    lastCompleted: snapshot.lastCompleted === null ? null : captureCompleted(snapshot.lastCompleted) };
}
export function sameCapture(a: CaptureDraft, b: CaptureCompleted) { return a.id === b.id && a.spaceId === b.spaceId && a.text === b.text; }

/** Synchronous input recovery. Compare the exact generation before replacing or clearing it. */
export function createCaptureRecovery(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  let expected: string | null | undefined;
  let revision = 0;
  function check() {
    if (expected === undefined || storage.getItem(captureRecoveryKey) !== expected) throw Error("Quick Capture recovery changed in another window. Copy your words and reopen this capture.");
  }
  return {
    read(): CaptureDraft | null {
      const raw = storage.getItem(captureRecoveryKey);
      if (raw === null) { expected = null; return null; }
      const entry = object(JSON.parse(raw) as unknown);
      if (entry.version !== 1 || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1 ||
          Number(entry.revision) >= Number.MAX_SAFE_INTEGER || Object.keys(entry).some(key => !["version", "revision", "draft"].includes(key))) {
        throw Error("Quick Capture recovery needs review or a newer Slate. Its bytes were kept.");
      }
      const draft = captureDraft(entry.draft);
      expected = raw; revision = Number(entry.revision);
      return draft;
    },
    write(draft: CaptureDraft) {
      check();
      captureDraft(draft);
      const next = JSON.stringify({ version: 1, revision: revision + 1, draft });
      storage.setItem(captureRecoveryKey, next);
      expected = next; revision++;
    },
    clear() { check(); storage.removeItem(captureRecoveryKey); expected = null; },
  };
}
export type CaptureRecovery = ReturnType<typeof createCaptureRecovery>;
