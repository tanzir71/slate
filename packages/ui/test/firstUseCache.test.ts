import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadedAssetURLs, observeFirstUseAssets } from "../../../apps/web/src/firstUseCache";

const base = "https://slate.test/slate/app/";
const resource = (name: string, startTime = 0) => ({ name, startTime });
let entries: ReturnType<typeof resource>[];
let callback: PerformanceObserverCallback;
const disconnect = vi.fn(), observe = vi.fn();
const channels: FakeChannel[] = [];
const cleanups: (() => void)[] = [];
let container: EventTarget & { controller: { scriptURL: string } | null };
let navigatorDescriptor: PropertyDescriptor | undefined;
let timingDescriptor: PropertyDescriptor | undefined;
class FakeChannel {
  port1 = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() };
  port2 = { postMessage: () => queueMicrotask(() => this.port1.onmessage?.(new MessageEvent("message", { data: true }))), close: vi.fn() };
  constructor() { channels.push(this); }
}
function worker(reply = true) {
  return { postMessage: vi.fn((message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => {
    if (reply && Array.isArray(transfer)) (transfer[0] as unknown as FakeChannel["port2"]).postMessage();
    void message;
  }) };
}
function start() {
  const value = observeFirstUseAssets(base); cleanups.push(value.dispose); return value;
}
function emit(value: ReturnType<typeof resource>[]) {
  callback({ getEntries: () => value } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
}
beforeEach(() => {
  entries = []; channels.length = 0; observe.mockClear(); disconnect.mockClear();
  container = Object.assign(new window.EventTarget(), { controller: null });
  navigatorDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  timingDescriptor = Object.getOwnPropertyDescriptor(performance, "getEntriesByType");
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  Object.defineProperty(performance, "getEntriesByType", { configurable: true, value: () => entries });
  vi.stubGlobal("caches", { match: vi.fn().mockResolvedValue(undefined) });
  vi.stubGlobal("MessageChannel", FakeChannel);
  vi.stubGlobal("PerformanceObserver", class {
    constructor(listener: PerformanceObserverCallback) { callback = listener; }
    observe = observe; disconnect = disconnect;
  });
});
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
  if (navigatorDescriptor) Object.defineProperty(navigator, "serviceWorker", navigatorDescriptor);
  else Reflect.deleteProperty(navigator, "serviceWorker");
  if (timingDescriptor) Object.defineProperty(performance, "getEntriesByType", timingDescriptor);
  else Reflect.deleteProperty(performance, "getEntriesByType");
  vi.unstubAllGlobals(); vi.useRealTimers();
});

it("limits cache messages to deduplicated public app assets and the diagram document", () => {
  expect(loadedAssetURLs([
    resource(base + "assets/math.worker-hash.js?cache=bust#part"),
    resource(base + "assets/math.worker-hash.js"), resource(base + "diagram-preview.html"),
    resource("https://external.test/assets/other.js"), resource("https://slate.test/other/assets/app.js"),
    resource(base + "Notes/private.md"), resource("blob:https://slate.test/id"),
    resource("https://user:password@slate.test/slate/app/assets/private.js"), resource("invalid"),
  ], base)).toEqual([base + "assets/math.worker-hash.js", base + "diagram-preview.html"]);
});
it("queues resources loaded before registration and asks the installing worker to cache them", async () => {
  entries = [resource(base + "assets/math.worker-hash.js")];
  const value = start(), target = worker();
  expect(target.postMessage).not.toHaveBeenCalled();
  value.registered({ installing: target });
  await vi.waitFor(() => expect(target.postMessage).toHaveBeenCalledOnce());
  expect(target.postMessage.mock.calls[0]?.[0]).toEqual({ type: "CACHE_URLS", payload: { urlsToCache: [entries[0]!.name] } });
  await vi.waitFor(() => expect(channels[0]?.port1.close).toHaveBeenCalled());
});
it("skips existing cached resources and sends only newly observed first-use URLs", async () => {
  entries = [resource(base + "assets/app.js")];
  vi.mocked(caches.match).mockResolvedValue({} as Response);
  const value = start(), target = worker(); value.registered({ active: target });
  await vi.waitFor(() => expect(caches.match).toHaveBeenCalled());
  expect(target.postMessage).not.toHaveBeenCalled();
  vi.mocked(caches.match).mockResolvedValue(undefined);
  emit([resource(base + "assets/math.worker.js"), resource(base + "assets/math.worker.js")]);
  await vi.waitFor(() => expect(target.postMessage).toHaveBeenCalledOnce());
  expect(target.postMessage.mock.calls[0]?.[0]).toEqual({ type: "CACHE_URLS", payload: { urlsToCache: [base + "assets/math.worker.js"] } });
});
it("rechecks pre-control resources on activation, including entries which finish afterwards", async () => {
  const value = start(), target = worker(); value.registered({ active: target });
  container.dispatchEvent(new Event("controllerchange"));
  emit([resource(base + "assets/math.worker.js", 0)]);
  await vi.waitFor(() => expect(target.postMessage).toHaveBeenCalledOnce());
  emit([resource(base + "assets/later.js", performance.now() + 1000)]);
  await Promise.resolve();
  expect(target.postMessage).toHaveBeenCalledOnce();
});
it("does no extra cache work on an already controlled visit", () => {
  container.controller = { scriptURL: base + "sw.js" };
  entries = [resource(base + "assets/app.js")];
  const value = start(), target = worker(); value.registered({ active: target });
  expect(observe).not.toHaveBeenCalled(); expect(caches.match).not.toHaveBeenCalled();
});
it("disposal closes pending message channels and disconnects every listener", async () => {
  entries = [resource(base + "assets/math.worker.js")];
  const value = start(), target = worker(false); value.registered({ active: target });
  await vi.waitFor(() => expect(target.postMessage).toHaveBeenCalledOnce());
  value.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(channels[0]?.port1.close).toHaveBeenCalled(); expect(channels[0]?.port2.close).toHaveBeenCalled();
  container.dispatchEvent(new Event("controllerchange")); emit([resource(base + "assets/ignored.js")]);
  await Promise.resolve(); expect(target.postMessage).toHaveBeenCalledOnce();
});
it("ignores optional cache failures without throwing into application rendering", async () => {
  entries = [resource(base + "assets/math.worker.js")];
  vi.mocked(caches.match).mockRejectedValue(new DOMException("Denied", "SecurityError"));
  const value = start(), target = worker(); value.registered({ active: target });
  await vi.waitFor(() => expect(caches.match).toHaveBeenCalled());
  expect(target.postMessage).not.toHaveBeenCalled();
});
