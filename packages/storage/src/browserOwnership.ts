export interface BrowserOwnership {
  acquire(takeover?: boolean): Promise<boolean>;
  release(): Promise<void>;
  notify(): void;
  close(): Promise<void>;
}

/** One write owner per Space. A takeover asks the owner to flush before releasing its lock. */
export function createBrowserOwnership(
  spaceId: string,
  onChange: (owned: boolean) => void,
  beforeRelease: () => Promise<void>,
  onSaved: () => void
): BrowserOwnership {
  const name = `slate-space-${spaceId}`;
  const channel = new BroadcastChannel(name);
  let releaseLock: (() => void) | undefined;
  let lockFinished: Promise<unknown> = Promise.resolve();
  let closed = false;
  let releasing = false;

  async function release() {
    if (!releaseLock || releasing) return;
    releasing = true;
    try {
      // Failed flush retains ownership: another tab must not write over unsaved words.
      await beforeRelease();
      onChange(false);
      releaseLock();
      await lockFinished;
      channel.postMessage({ type: "released" });
    } finally { releasing = false; }
  }

  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (typeof message !== "object" || message === null || !("type" in message)) return;
    if (message.type === "takeover") void release().catch(() => undefined);
    if (message.type === "saved") onSaved();
  };

  return {
    async acquire(takeover = false) {
      if (closed) return false;
      if (releaseLock) return true;
      if (!navigator.locks) {
        // Fail closed on unsupported engines; don't pretend to provide safe multi-tab writes.
        onChange(false);
        return false;
      }
      if (takeover) channel.postMessage({ type: "takeover" });
      return new Promise<boolean>((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        lockFinished = navigator.locks.request(name, takeover ? { signal: controller.signal } : { ifAvailable: true }, async (lock) => {
          clearTimeout(timer);
          if (!lock || closed) { resolve(false); return; }
          const held = new Promise<void>((done) => { releaseLock = done; });
          onChange(true);
          resolve(true);
          await held;
          releaseLock = undefined;
        }).catch((error: unknown) => { clearTimeout(timer); reject(error); });
      });
    },
    release,
    notify() { if (!closed) channel.postMessage({ type: "saved" }); },
    async close() {
      await release();
      closed = true;
      channel.close();
    }
  };
}
