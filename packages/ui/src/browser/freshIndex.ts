import type { BrowserIndex } from "./BrowserApp";

/** A cache can answer only after its latest rebuild. Files remain the fallback. */
export function createFreshIndex(cache: BrowserIndex) {
  let revision = 0, ready = false, closed = false;
  let pending: Promise<unknown> = Promise.resolve();
  function invalidate() { ready = false; revision++; }
  return {
    invalidate,
    async rebuild(sheets: Parameters<BrowserIndex["rebuild"]>[0]) {
      invalidate();
      const current = revision;
      const next = pending.then(async () => {
        if (closed) throw new Error("Space closed");
        await cache.rebuild(sheets);
      });
      pending = next.catch(() => undefined);
      await next;
      if (!closed && current === revision) ready = true;
    },
    async search(query: string) {
      if (closed || !ready) throw new Error("Search the current files until the cache is ready");
      const current = revision;
      const paths = await cache.search(query);
      if (closed || !ready || current !== revision) throw new Error("The search cache changed");
      return paths;
    },
    close() { if (!closed) { closed = true; invalidate(); cache.close(); } },
  };
}
