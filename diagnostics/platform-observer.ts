import type { Page, TestInfo } from "@playwright/test";

type Expect = typeof import("@playwright/test").expect;
type RecordEntry = Record<string, unknown>;
let active: RecordEntry[] | undefined;

/** Delegate every matcher unchanged; retain the already measured table object. */
export function observedExpect(original: Expect): Expect {
  return new Proxy(original, {
    apply(target, receiver: unknown, argumentsList: unknown[]) {
      const value: unknown = argumentsList[0];
      if (active && value && typeof value === "object" &&
        Object.hasOwn(value, "height") && Object.hasOwn(value, "columns") && Object.hasOwn(value, "header"))
        active.push({ kind: "table-assertion-input", value });
      return Reflect.apply(target, receiver, argumentsList);
    },
  });
}

export async function observePage(page: Page, testInfo: TestInfo): Promise<() => Promise<void>> {
  const records: RecordEntry[] = [], requests: RecordEntry[] = [];
  active = records;
  page.on("console", message => {
    if (records.length < 1200) records.push({ kind: "console", type: message.type(), text: message.text() });
  });
  page.on("pageerror", error => records.push({ kind: "pageerror", message: error.message }));
  page.context().on("requestfinished", request => {
    if (requests.length < 600) requests.push({ url: request.url(), type: request.resourceType(), outcome: "finished", timing: request.timing() });
  });
  page.context().on("requestfailed", request => {
    if (requests.length < 600) requests.push({ url: request.url(), type: request.resourceType(), outcome: request.failure()?.errorText ?? "failed" });
  });
  await page.addInitScript(() => {
    const events: Record<string, unknown>[] = [];
    Reflect.set(window, "__slatePlatformDiagnostic", events);
    const label = (element: Element | null) => element ? {
      tag: element.tagName, id: element.id,
      class: typeof element.className === "string" ? element.className : "SVG",
    } : null;
    const snapshot = () => {
      const selection = document.getSelection(), content = document.querySelector(".cm-content");
      const parent = (node: Node | null) => node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement ?? null;
      return {
        focused: document.hasFocus(), visibility: document.visibilityState, active: label(document.activeElement),
        editorText: content?.textContent?.slice(0, 350),
        selection: selection ? { ranges: selection.rangeCount, anchor: label(parent(selection.anchorNode)),
          anchorOffset: selection.anchorOffset, anchorConnected: selection.anchorNode?.isConnected,
          focus: label(parent(selection.focusNode)), focusOffset: selection.focusOffset,
          insideEditor: !!content && !!selection.anchorNode && content.contains(selection.anchorNode) } : null,
      };
    };
    const remember = (kind: string, detail: Record<string, unknown> = {}) => {
      if (events.length < 1200) events.push({ time: performance.now(), kind, ...detail, ...snapshot() });
    };
    for (const type of ["keydown", "keyup", "beforeinput", "input", "focusin", "focusout", "selectionchange"]) {
      document.addEventListener(type, event => {
        const detail = { type: event.type, defaultPrevented: event.defaultPrevented,
          ...(event instanceof KeyboardEvent ? { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, composing: event.isComposing } : {}),
          ...(event instanceof InputEvent ? { data: event.data, inputType: event.inputType, composing: event.isComposing } : {}) };
        remember("event-capture", detail);
        if (type === "keydown" || type === "beforeinput" || type === "input")
          queueMicrotask(() => remember("event-dispatched", { ...detail, defaultPrevented: event.defaultPrevented }));
      }, { capture: true, passive: true });
    }
    for (const type of ["focus", "blur"]) window.addEventListener(type, () => remember("window-" + type));
    let watched: Element | undefined, observer: MutationObserver | undefined;
    document.addEventListener("focusin", () => {
      const content = document.activeElement?.closest(".cm-content");
      if (!content || content === watched) return;
      observer?.disconnect(); watched = content;
      observer = new MutationObserver(() => remember("editor-mutation", { observedText: content.textContent?.slice(0, 350), observedConnected: content.isConnected }));
      observer.observe(content, { childList: true, characterData: true, subtree: true });
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => remember("service-worker-controller", { script: navigator.serviceWorker.controller?.scriptURL }));
      void navigator.serviceWorker.ready.then(registration => remember("service-worker-ready", { scope: registration.scope, state: registration.active?.state }));
    }
  });
  return async () => {
    let final: unknown;
    try {
      final = await page.evaluate(async () => {
        const rect = (element: Element) => {
          const r = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { x: r.x, y: r.y, width: r.width, height: r.height, text: element.textContent?.slice(0, 180),
            display: style.display, font: style.font, lineHeight: style.lineHeight, minHeight: style.minHeight,
            padding: style.padding, border: style.borderWidth, boxSizing: style.boxSizing, zoom: style.zoom };
        };
        const tables = Array.from(document.querySelectorAll(".cm-slate-table-grid"), element => ({
          grid: rect(element), rows: Array.from(element.querySelectorAll('[role="row"]'), row => ({
            row: rect(row), cells: Array.from(row.querySelectorAll('[role="cell"], [role="columnheader"]'), rect),
          })),
        }));
        const registrations = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];
        const cacheNames = "caches" in window ? await caches.keys() : [];
        const cacheEntries = await Promise.all(cacheNames.map(async name => ({ name, urls: (await (await caches.open(name)).keys()).map(request => request.url) })));
        return { events: Reflect.get(window, "__slatePlatformDiagnostic"), href: location.href,
          focused: document.hasFocus(), visibility: document.visibilityState, activeTag: document.activeElement?.tagName,
          editorText: document.querySelector(".cm-content")?.textContent?.slice(0, 500),
          dpr: devicePixelRatio, scale: visualViewport?.scale, fonts: document.fonts.status, tables,
          serviceWorker: { controller: navigator.serviceWorker?.controller?.scriptURL,
            registrations: registrations.map(r => ({ scope: r.scope, installing: r.installing?.state, waiting: r.waiting?.state, active: r.active?.state,
              script: r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL })), cacheEntries },
          resources: performance.getEntriesByType("resource").map(entry => ({ name: entry.name, start: entry.startTime, duration: entry.duration })),
        };
      });
    } catch (error) { final = { captureError: error instanceof Error ? error.message : String(error) }; }
    await testInfo.attach("platform-observations", { contentType: "application/json", body: JSON.stringify({
      platform: process.platform, project: testInfo.project.name, title: testInfo.title,
      errors: testInfo.errors.map(error => error.message), records, requests, final,
    }, null, 2) });
    active = undefined;
  };
}
