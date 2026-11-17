import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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
