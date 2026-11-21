import type { Page, Request, TestInfo } from "@playwright/test";

const observationKey = "slateServiceWorkerObservation";

/** Stringified into the page; delegates each registration with its original promise. */
export function installServiceWorkerObservation() {
  const records: Record<string, unknown>[] = [];
  Reflect.set(window, "slateServiceWorkerObservation", records);
  const cleanups: (() => void)[] = [];
  let active = true;
  const failure = (cause: unknown) => {
    if (cause && typeof cause === "object") {
      const value = cause as { name?: unknown; message?: unknown };
      return { name: typeof value.name === "string" ? value.name : undefined,
        message: typeof value.message === "string" ? value.message : String(cause) };
    }
    return { message: String(cause) };
  };
  const remember = (kind: string, detail: Record<string, unknown> = {}) => {
    if (active && records.length < 256) records.push({ at: performance.now(), kind, readyState: document.readyState, ...detail });
  };
  const watch = (target: EventTarget, event: string, listener: EventListener) => {
    target.addEventListener(event, listener); cleanups.push(() => target.removeEventListener(event, listener));
  };
  const worker = (value: ServiceWorker | null) => value ? { url: value.scriptURL, state: value.state } : null;
  try {
    remember("initial", { supported: "serviceWorker" in navigator });
    watch(window, "load", () => remember("window-load"));
    if ("serviceWorker" in navigator) {
      const container = navigator.serviceWorker, previous = Object.getOwnPropertyDescriptor(container, "register"), original = container.register;
      remember("initial-controller", { controller: worker(container.controller) });
      const watched = new WeakSet<ServiceWorker>();
      const registration = (value: ServiceWorkerRegistration) => ({ scope: value.scope,
        installing: worker(value.installing), waiting: worker(value.waiting), active: worker(value.active) });
      const observeWorkers = (value: ServiceWorkerRegistration) => {
        for (const current of [value.installing, value.waiting, value.active]) if (current && !watched.has(current)) {
          watched.add(current);
          watch(current, "statechange", () => remember("worker-state", { ...worker(current), scope: value.scope }));
        }
      };
      watch(container, "controllerchange", () => remember("controller-change", { controller: worker(container.controller) }));
      const wrapped = function (this: ServiceWorkerContainer, ...args: Parameters<ServiceWorkerContainer["register"]>) {
        remember("registration-start", { url: String(args[0]), scope: args[1]?.scope, type: args[1]?.type });
        let pending: Promise<ServiceWorkerRegistration>;
        try { pending = Reflect.apply(original, this, args) as Promise<ServiceWorkerRegistration>; }
        catch (cause) { remember("registration-threw", failure(cause)); throw cause; }
        void pending.then(value => {
          if (!active) return;
          remember("registration-resolved", registration(value)); observeWorkers(value);
          watch(value, "updatefound", () => { remember("update-found", registration(value)); observeWorkers(value); });
        }, cause => remember("registration-rejected", failure(cause))).catch(cause => remember("observer-error", failure(cause)));
        return pending;
      };
      Object.defineProperty(container, "register", { configurable: true, writable: true, value: wrapped });
      cleanups.push(() => {
        if (container.register !== wrapped) return;
        if (previous) Object.defineProperty(container, "register", previous);
        else Reflect.deleteProperty(container, "register");
      });
    }
  } catch (cause) { remember("observer-setup-error", failure(cause)); }
  return () => { active = false; for (const cleanup of cleanups.reverse()) cleanup(); };
}

export async function observeOfflineServiceWorker(page: Page, testInfo: TestInfo): Promise<() => Promise<void>> {
  if (!testInfo.title.startsWith("local image previews fit both themes and preserve physical bytes") &&
      testInfo.title !== "reloads offline with saved files and a working editor") return async () => {};
  const failedRequests: { url: string; error: string | undefined }[] = [];
  const requestFailed = (request: Request) => {
    if (failedRequests.length < 64) failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
  };
  page.on("requestfailed", requestFailed);
  await page.addInitScript(installServiceWorkerObservation);
  return async () => {
    let snapshot: unknown;
    try {
      snapshot = await page.evaluate(async key => {
        const worker = (value: ServiceWorker | null) => value ? { url: value.scriptURL, state: value.state } : null;
        const registrations = "serviceWorker" in navigator ? await Promise.race([
          navigator.serviceWorker.getRegistrations().then(values => ({ values: values.map(value => ({ scope: value.scope,
            installing: worker(value.installing), waiting: worker(value.waiting), active: worker(value.active) })) })),
          new Promise<{ timedOut: true }>(resolve => setTimeout(() => resolve({ timedOut: true }), 500)),
        ]) : { unsupported: true };
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        return { records: Reflect.get(window, key), href: location.href, readyState: document.readyState,
          controller: "serviceWorker" in navigator ? worker(navigator.serviceWorker.controller) : null, registrations,
          navigation: navigation ? { type: navigation.type, workerStart: navigation.workerStart, fetchStart: navigation.fetchStart,
            responseStart: navigation.responseStart, responseEnd: navigation.responseEnd, domInteractive: navigation.domInteractive,
            domContentLoaded: navigation.domContentLoadedEventEnd, loadEnd: navigation.loadEventEnd } : undefined,
          resources: performance.getEntriesByType("resource").slice(-30).map(entry => ({ name: entry.name, start: entry.startTime, duration: entry.duration })) };
      }, observationKey);
    } catch (cause) { snapshot = { captureError: cause instanceof Error ? cause.message : String(cause) }; }
    finally { page.off("requestfailed", requestFailed); }
    await testInfo.attach("offline-service-worker-lifecycle", { contentType: "application/json", body: JSON.stringify({
      project: testInfo.project.name, platform: process.platform, status: testInfo.status, snapshot, failedRequests,
    }, null, 2) }).catch(() => undefined);
  };
}
