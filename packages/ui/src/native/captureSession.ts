import { captureCompleted, captureSnapshot, sameCapture, type CaptureCompleted, type CaptureDraft, type CaptureRecovery } from "./captureRecovery";

export interface CaptureAPI {
  snapshot(): Promise<unknown>;
  stash(draft: CaptureDraft): Promise<void>;
  save(draft: CaptureDraft): Promise<unknown>;
  onClose(listener: (event: { preventDefault(): void }) => void): Promise<() => void>;
  requestClose(): Promise<void>;
  destroy(): Promise<void>;
  showMain(): Promise<void>;
}
export interface CaptureState {
  readonly ready: boolean;
  readonly draft: CaptureDraft | undefined;
  readonly completed: CaptureCompleted | undefined;
  readonly saving: boolean;
  readonly closing: boolean;
  readonly recoveryFailed: boolean;
  readonly error: string;
}

export function createCaptureSession(api: CaptureAPI, recovery: CaptureRecovery) {
  let state: CaptureState = { ready: false, draft: undefined, completed: undefined, saving: false, closing: false, recoveryFailed: false, error: "" };
  let active = true, stop: (() => void) | undefined;
  let starting: Promise<void> | undefined, saving: Promise<boolean> | undefined, closing: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  function update(next: Partial<CaptureState>) { state = { ...state, ...next }; if (active) for (const listener of listeners) listener(); }
  function failed(error: unknown) { update({ error: error instanceof Error ? error.message : "Quick Capture could not finish. Keep this window open or copy your words." }); }

  async function open() {
    const unlisten = await api.onClose(event => { event.preventDefault(); void close(); });
    if (!active) { unlisten(); return; }
    stop = unlisten;
    const snapshot = captureSnapshot(await api.snapshot());
    if (!active) return;
    let local = recovery.read();
    if (local && snapshot.lastCompleted && sameCapture(local, snapshot.lastCompleted)) { recovery.clear(); local = null; }
    const server = snapshot.activeDraft;
    if (!server) {
      if (local || !snapshot.lastCompleted) throw Error("This capture has no matching saved session. Your recovery data was kept; reopen Quick Capture from Slate.");
      update({ completed: snapshot.lastCompleted, ready: true }); return;
    }
    if (local && (local.id !== server.id || local.spaceId !== server.spaceId ||
        local.revision === server.revision && (local.text !== server.text || local.pending !== server.pending) ||
        server.pending && local.revision > server.revision && (local.text !== server.text || !local.pending))) {
      update({ draft: local });
      throw Error("The recovered words belong to a different capture. Copy them before reopening; neither draft was replaced.");
    }
    const draft = local && local.revision > server.revision ? { ...server, text: local.text, pending: local.pending, revision: local.revision } : server;
    update({ draft });
    recovery.write(draft);
    update({ ready: true });
  }
  function start() {
    starting ??= Promise.resolve().then(open).catch(error => { failed(error); throw error; });
    return starting;
  }
  function save(): Promise<boolean> {
    if (saving) return saving;
    const current = state.draft;
    if (!active || !state.ready || state.closing || state.completed || !current?.text.trim()) return Promise.resolve(false);
    const draft = { ...current, pending: true, revision: current.revision + (current.pending ? 0 : 1) };
    update({ draft, saving: true, error: "" });
    saving = Promise.resolve().then(async () => {
      try {
        recovery.write(draft);
        const done = captureCompleted(await api.save(draft));
        if (!sameCapture(draft, done)) throw Error("The save reply belongs to another capture. Retry this exact text; your draft was kept.");
        // Once acknowledged, a failed recovery cleanup must never restash this text.
        update({ completed: done });
        recovery.clear();
        update({ recoveryFailed: false });
        return true;
      } catch (error) { failed(error); return false; }
    }).finally(() => { saving = undefined; update({ saving: false }); });
    return saving;
  }
  function close(): Promise<void> {
    if (closing) return closing;
    update({ closing: true });
    closing = (async () => {
      try {
        await start();
        await saving;
        if (!state.ready) throw Error("Your capture could not be recovered. Copy its words before closing.");
        if (!state.completed && state.draft) {
          await api.stash(state.draft);
          // The durable backend now holds the latest text. An older local
          // generation (for example after a quota error) must not shadow it.
          recovery.clear();
        }
        await api.destroy();
      } catch (error) { failed(error); }
      finally { closing = undefined; update({ closing: false }); }
    })();
    return closing;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start, save,
    change(text: string) {
      const draft = state.draft;
      if (!active || !state.ready || !draft || draft.pending || state.saving || state.closing || state.completed || state.recoveryFailed) return;
      const next = { ...draft, text, revision: draft.revision + 1 };
      update({ draft: next, error: "" });
      try { recovery.write(next); } catch (error) { update({ recoveryFailed: true }); failed(error); }
    },
    async requestClose() { if (active) try { await api.requestClose(); } catch (error) { failed(error); } },
    async showMain() { if (active) try { await api.showMain(); } catch (error) { failed(error); } },
    failed,
    dispose() { active = false; stop?.(); stop = undefined; listeners.clear(); },
  };
}
export type CaptureSession = ReturnType<typeof createCaptureSession>;
