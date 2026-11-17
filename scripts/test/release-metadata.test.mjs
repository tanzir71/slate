import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReleaseMetadata } from "../release-metadata.mjs";

const metadata = { version: "0.2.0", appVersion: "0.2.0", notesVersion: "0.2.0" };

test("accepts consistent manual and tagged release artifacts", () => {
  assert.doesNotThrow(() => assertReleaseMetadata(metadata, undefined));
  assert.doesNotThrow(() => assertReleaseMetadata(metadata, "v0.2.0"));
});

test("rejects an app or release notes from another version", () => {
  assert.throws(() => assertReleaseMetadata({ ...metadata, appVersion: "0.1.0" }, undefined), /versions disagree/);
  assert.throws(() => assertReleaseMetadata({ ...metadata, notesVersion: "0.1.0" }, undefined), /versions disagree/);
});

test("rejects a release tag that does not match the built app", () => {
  assert.throws(() => assertReleaseMetadata(metadata, "v0.3.0"), /must match v0.2.0/);
});
