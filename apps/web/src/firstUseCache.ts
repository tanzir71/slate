type Resource = Pick<PerformanceEntry, "name" | "startTime">;
type CacheWorker = Pick<ServiceWorker, "postMessage">;
interface CacheRegistration {
  readonly installing?: CacheWorker | null;
  readonly waiting?: CacheWorker | null;
  readonly active?: CacheWorker | null;
}
const inactive = { registered(_value: CacheRegistration | undefined) {}, dispose() {} };

/** Only public resources from this app can enter the runtime cache. */
export function loadedAssetURLs(entries: readonly Resource[], baseURI: string) {
  const base = new URL("./", baseURI), prefix = base.pathname + "assets/";
  const urls = new Set<string>();
  for (const entry of entries) {
    try {
      const url = new URL(entry.name);
      if (url.origin !== base.origin || url.username || url.password) continue;
      const asset = url.pathname.startsWith(prefix) && /\.(?:js|css|woff2|wasm|svg|png|json)$/.test(url.pathname);
      if (!asset && url.pathname !== base.pathname + "diagram-preview.html") continue;
      url.search = ""; url.hash = "";
      urls.add(url.href);
    } catch { /* Resource timing may include non-URL entries. */ }
  }
  return [...urls];
}

/** Cache first-use resources that finished before the initial worker controlled the page. */
export function observeFirstUseAssets(baseURI = document.baseURI) {
  let container: ServiceWorkerContainer;
  try {
    if (!("serviceWorker" in navigator) || typeof caches === "undefined") return inactive;
    container = navigator.serviceWorker;
    if (container.controller?.scriptURL === new URL("./sw.js", baseURI).href) return inactive;
  } catch { return inactive; }
  const pending = new Set<string>(), seen = new Set<string>(), cancel = new Set<() => void>();
  let registration: CacheRegistration | undefined, observer: PerformanceObserver | undefined;
  let closed = false, flushing = false, controlledAt: number | undefined;
  function send(worker: CacheWorker, urls: string[]) {
    return new Promise<void>(resolve => {
      const channel = new MessageChannel();
      const finish = () => {
        clearTimeout(timer); cancel.delete(finish);
        channel.port1.close(); channel.port2.close(); resolve();
      };
      const timer = setTimeout(finish, 5000);
      cancel.add(finish); channel.port1.onmessage = finish;
      try { worker.postMessage({ type: "CACHE_URLS", payload: { urlsToCache: urls } }, [channel.port2]); }
      catch { finish(); }
    });
  }
  async function flush() {
    const worker = registration?.installing ?? registration?.waiting ?? registration?.active;
    if (closed || flushing || !worker || !pending.size) return;
    flushing = true;
    const urls = [...pending]; pending.clear();
    try {
      const found = await Promise.all(urls.map(url => caches.match(url)));
      const missing = urls.filter((_url, index) => !found[index]);
      if (!closed && missing.length) await send(worker, missing);
    } catch { /* A failed optional cache must not interrupt writing or preview rendering. */ }
    finally { flushing = false; if (!closed && pending.size) void flush(); }
  }
  function collect(entries: readonly Resource[]) {
    if (closed) return;
    const beforeControl = entries.filter(entry => controlledAt === undefined || entry.startTime <= controlledAt);
    for (const url of loadedAssetURLs(beforeControl, baseURI))
      if (!seen.has(url)) { seen.add(url); pending.add(url); }
    void flush();
  }
  const existing = () => {
    try { collect(performance.getEntriesByType("resource")); } catch { /* Optional in older browsers. */ }
  };
  const controlled = () => {
    controlledAt = performance.now(); seen.clear(); existing();
  };
  container.addEventListener("controllerchange", controlled);
  try {
    observer = new PerformanceObserver(list => collect(list.getEntries()));
    observer.observe({ type: "resource", buffered: true });
  } catch { /* Registration and controller events still collect existing entries. */ }
  existing();
  return {
    registered(value: CacheRegistration | undefined) {
      if (closed) return;
      registration = value; existing();
    },
    dispose() {
      closed = true; observer?.disconnect();
      container.removeEventListener("controllerchange", controlled);
      for (const stop of [...cancel]) stop();
      pending.clear(); seen.clear();
    },
  };
}
