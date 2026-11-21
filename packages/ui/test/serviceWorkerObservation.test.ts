import { afterEach, expect, it, vi } from "vitest";
import { installServiceWorkerObservation } from "../../../e2e/serviceWorkerObservation";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  Reflect.deleteProperty(window, "slateServiceWorkerObservation");
  vi.unstubAllGlobals();
});
const records = () => Reflect.get(window, "slateServiceWorkerObservation") as Record<string, unknown>[];
function setup(register: ServiceWorkerContainer["register"]) {
  const container = Object.assign(new window.EventTarget(), { register, controller: null }) as unknown as ServiceWorkerContainer;
  vi.stubGlobal("navigator", { serviceWorker: container });
  cleanups.push(installServiceWorkerObservation());
  return container;
}
function registration() {
  return Object.assign(new window.EventTarget(), { scope: "https://slate.test/app/", installing: null, waiting: null, active: null }) as unknown as ServiceWorkerRegistration;
}

it("returns the original registration promise, arguments and receiver", async () => {
  const value = registration(), pending = Promise.resolve(value);
  const original = vi.fn(function (this: ServiceWorkerContainer) { expect(this).toBe(container); return pending; });
  const container = setup(original);
  const options = { scope: "./", type: "classic" as const };
  const result = container.register("./sw.js", options);
  expect(result).toBe(pending); expect(await result).toBe(value);
  expect(original).toHaveBeenCalledWith("./sw.js", options);
  expect(records()).toContainEqual(expect.objectContaining({ kind: "registration-resolved", scope: value.scope }));
});

it("records a rejection while preserving the original error and promise", async () => {
  const error = new DOMException("Worker could not install", "SecurityError"), pending = Promise.reject(error);
  const container = setup(() => pending), result = container.register("./sw.js");
  expect(result).toBe(pending); await expect(result).rejects.toBe(error);
  expect(records()).toContainEqual(expect.objectContaining({ kind: "registration-rejected", name: "SecurityError", message: error.message }));
});

it("keeps a synchronous registration error synchronous", () => {
  const error = new TypeError("Invalid worker URL"), container = setup(() => { throw error; });
  expect(() => container.register("bad:")).toThrow(error);
  expect(records()).toContainEqual(expect.objectContaining({ kind: "registration-threw", name: "TypeError" }));
});

it("observes state changes and cleanup restores the exact original method", async () => {
  const current = Object.assign(new window.EventTarget(), { scriptURL: "https://slate.test/app/sw.js", state: "installing" }) as unknown as ServiceWorker;
  const value = registration(); Object.defineProperty(value, "installing", { configurable: true, value: current });
  const original = () => Promise.resolve(value), container = setup(original);
  await container.register("./sw.js");
  Object.defineProperty(current, "state", { configurable: true, value: "installed" });
  current.dispatchEvent(new window.Event("statechange"));
  expect(records()).toContainEqual(expect.objectContaining({ kind: "worker-state", state: "installed" }));
  cleanups.shift()!(); expect(container.register).toBe(original);
  const before = records().length; current.dispatchEvent(new window.Event("statechange")); expect(records()).toHaveLength(before);
});

it("metadata failures leave the registration result intact", async () => {
  const value = registration(); Object.defineProperty(value, "scope", { get() { throw new Error("Observation unavailable"); } });
  const pending = Promise.resolve(value), container = setup(() => pending);
  expect(await container.register("./sw.js")).toBe(value);
  await Promise.resolve();
  expect(records()).toContainEqual(expect.objectContaining({ kind: "observer-error", message: "Observation unavailable" }));
});
