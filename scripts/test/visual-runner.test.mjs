import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";

test("the isolated visual runtime contains every relative test import", () => {
  const root = resolve(import.meta.dirname, "../..");
  const runner = readFileSync(resolve(root, "scripts/visual-test.mjs"), "utf8");
  const staged = new Map();
  for (const match of runner.matchAll(/cp \/source\/(\S+) "\$runtime\/([^"]+)"/g)) {
    const [, source, target] = match;
    if (source.endsWith("/*.ts")) {
      for (const file of readdirSync(resolve(root, posix.dirname(source))).filter(file => file.endsWith(".ts")))
        staged.set(posix.join(target, file), posix.join(posix.dirname(source), file));
    } else staged.set(target, source);
  }
  assert.ok(staged.has("e2e/visual/workspace.spec.ts"), "stage the actual visual tests");
  for (const [target, source] of staged) {
    const code = readFileSync(resolve(root, source), "utf8");
    for (const match of code.matchAll(/\b(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(target), match[1]));
      assert.ok([dependency, ...[".ts", ".mjs", ".js"].map(extension => dependency + extension)]
        .some(candidate => staged.has(candidate)), `${source} imports ${match[1]}, which is missing from the isolated runtime`);
    }
  }
});

test("CI rejects both baseline-update flag forms before starting any runtime", () => {
  // An empty PATH prevents a Docker launch even if the guard regresses.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  for (const flag of ["--update-snapshots", "--update-snapshots=all", "-u"]) {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../visual-test.mjs"), flag], {
      env: { ...environment, PATH: "", CI: "true" }, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CI may compare visual baselines/);
  }
});
