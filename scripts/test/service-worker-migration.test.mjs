import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { migrationScript, preserveDeferredAssets } from "../service-worker-precache.ts";

const scope = "https://slate.test/slate/app/";
class MemoryCache {
  entries = new Map();
  async keys() { return [...this.entries.keys()].map(url => new globalThis.Request(url)); }
  async match(request) { return this.entries.get(typeof request === "string" ? request : request.url)?.clone(); }
  async put(request, response) { this.entries.set(typeof request === "string" ? request : request.url, response.clone()); }
  async addAll(urls) { for (const url of urls) await this.put(url, new globalThis.Response("downloaded")); }
}
function storage() {
  const entries = new Map();
  return { entries, async keys() { return [...entries.keys()]; }, async open(name) {
    if (!entries.has(name)) entries.set(name, new MemoryCache());
    return entries.get(name);
  } };
}
async function legacy(store, file, body = "retained") {
  await (await store.open("workbox-precache-v2-legacy")).put(new URL(file, scope).href, new globalThis.Response(body));
}

test("moves current deferred assets while leaving document versioning to the precache", async () => {
  const store = storage();
  await legacy(store, "assets/math.worker.js");
  await legacy(store, "diagram-preview.html?__WB_REVISION__=old");
  await legacy(store, "assets/stale.js"); await legacy(store, "assets/app.js");
  await preserveDeferredAssets(store, scope, ["assets/math.worker.js", "diagram-preview.html"]);
  const assets = await store.open("slate-lazy-assets-v1");
  assert.equal(await (await assets.match(scope + "assets/math.worker.js")).text(), "retained");
  assert.equal(store.entries.has("slate-lazy-pages-v1"), false);
  assert.equal(await assets.match(scope + "assets/stale.js"), undefined);
  assert.equal(await assets.match(scope + "assets/app.js"), undefined);
  assert.equal(await (await store.open("workbox-precache-v2-legacy")).keys().then(keys => keys.length), 4);
});
test("does not copy private, foreign or out-of-scope files even when supplied as candidates", async () => {
  const store = storage();
  for (const file of ["Notes/private.json", "assets/../../Notes/private.json", "https://foreign.test/assets/math.js", "/other/assets/math.js"])
    await legacy(store, file);
  await preserveDeferredAssets(store, scope, ["Notes/private.json", "assets/../../Notes/private.json", "https://foreign.test/assets/math.js", "/other/assets/math.js"]);
  assert.deepEqual(await store.keys(), ["workbox-precache-v2-legacy"]);
});
test("does not overwrite an existing runtime asset with older cached bytes", async () => {
  const store = storage(); await legacy(store, "assets/math.js", "older");
  const target = await store.open("slate-lazy-assets-v1"); await target.put(scope + "assets/math.js", new globalThis.Response("newer"));
  await preserveDeferredAssets(store, scope, ["assets/math.js"]);
  assert.equal(await (await target.match(scope + "assets/math.js")).text(), "newer");
});
test("a fresh installation does not create or fill a lazy cache", async () => {
  const store = storage(); await legacy(store, "assets/app.js");
  await preserveDeferredAssets(store, scope, ["assets/math.js"]);
  assert.deepEqual(await store.keys(), ["workbox-precache-v2-legacy"]);
});
test("the emitted script holds installation until cache migration finishes", async () => {
  const store = storage(); await legacy(store, "assets/math.js");
  let install, complete;
  vm.runInNewContext(migrationScript(["assets/math.js"]), { URL, caches: store,
    self: { registration: { scope, active: {} }, addEventListener(name, handler) { assert.equal(name, "install"); install = handler; } },
  });
  install({ waitUntil(promise) { complete = promise; } });
  assert.ok(complete); await complete;
  assert.equal(await (await (await store.open("slate-lazy-assets-v1")).match(scope + "assets/math.js")).text(), "retained");
});
test("a failed migration rejects installation so the old worker remains available", async () => {
  const store = storage(); await legacy(store, "assets/math.js");
  (await store.open("slate-lazy-assets-v1")).put = async () => { throw Error("Cache full"); };
  await assert.rejects(preserveDeferredAssets(store, scope, ["assets/math.js"]), /Cache full/);
});
test("a legacy precached diagram warms its current bootstrap after a filename change", async () => {
  const store = storage(); await legacy(store, "diagram-preview.html"); await legacy(store, "assets/diagram-old.js");
  await preserveDeferredAssets(store, scope, ["assets/diagram-current.js", "assets/elk-unused.js"], ["assets/diagram-current.js", "https://foreign.test/private.js"]);
  const target = await store.open("slate-lazy-assets-v1");
  assert.equal(await (await target.match(scope + "assets/diagram-current.js")).text(), "downloaded");
  assert.equal(await target.match(scope + "assets/elk-unused.js"), undefined);
});
test("a newer-policy user warms only an already-used diagram, and leaves unused diagrams lazy", async () => {
  const store = storage(); await legacy(store, "diagram-preview.html"); await legacy(store, "cache-migrate.js");
  await preserveDeferredAssets(store, scope, ["assets/diagram-current.js"], ["assets/diagram-current.js"]);
  assert.equal(store.entries.has("slate-lazy-assets-v1"), false);
  const target = await store.open("slate-lazy-assets-v1"); await target.put(scope + "assets/diagram-old.js", new globalThis.Response("used"));
  await preserveDeferredAssets(store, scope, ["assets/diagram-current.js"], ["assets/diagram-current.js"]);
  assert.equal(await (await target.match(scope + "assets/diagram-current.js")).text(), "downloaded");
});
test("a fresh worker does not run upgrade migration", () => {
  let install, waited = false;
  vm.runInNewContext(migrationScript(["assets/math.js"]), {
    self: { registration: { scope, active: null }, addEventListener(_name, handler) { install = handler; } },
  });
  install({ waitUntil() { waited = true; } }); assert.equal(waited, false);
});
