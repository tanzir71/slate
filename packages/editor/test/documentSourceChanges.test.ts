import { expect, it, vi } from "vitest";
import { applyTextChanges } from "@slate/core";
import { applyDocumentSourceChanges, createDocumentSession } from "../src/index";

const source = "\uFEFF# Original\r\n\r\nWords\n";
const changes = [{ from: source.indexOf("Words"), to: source.indexOf("Words") + 5, text: "Linked words" }];
const plan = { source, changes, output: applyTextChanges(source, changes) };

it("applies an exact source proposal as one raw-history action and notifies its writer once", () => {
  const session = createDocumentSession(source), changed = vi.fn(); session.subscribe(changed);
  expect(applyDocumentSourceChanges(session, session.snapshot(), plan, "input.link.mentions")).toBe(true);
  expect(session.snapshot().source).toBe(plan.output); expect(changed).toHaveBeenCalledTimes(1);
  expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe(source);
  expect(session.redo()).toBe(true); expect(session.snapshot().source).toBe(plan.output);
});

it("rejects stale revisions even after Undo restores identical bytes, and checks live permission", () => {
  let owned = true; const session = createDocumentSession(source, () => owned), before = session.snapshot();
  expect(applyDocumentSourceChanges(session, before, plan, "input.link.mentions")).toBe(true);
  session.undo(); expect(session.snapshot().source).toBe(source);
  expect(applyDocumentSourceChanges(session, before, plan, "input.link.mentions")).toBe(false);
  const current = session.snapshot(); owned = false;
  expect(applyDocumentSourceChanges(session, current, plan, "input.link.mentions")).toBe(false); expect(session.snapshot().source).toBe(source);
});

it("rejects malformed, mismatched, out-of-range and empty proposals without publishing an edit", () => {
  const session = createDocumentSession(source), changed = vi.fn(); session.subscribe(changed);
  for (const invalid of [
    { ...plan, source: source + "stale" }, { ...plan, output: "Unreviewed" },
    { ...plan, changes: [{ from: -1, to: 0, text: "Bad" }] }, { ...plan, changes: [] },
  ]) expect(applyDocumentSourceChanges(session, session.snapshot(), invalid, "input.link.mentions")).toBe(false);
  expect(changed).not.toHaveBeenCalled(); expect(session.snapshot().source).toBe(source);
});

it("propagates a published listener failure while preserving the complete source/history for recovery", () => {
  const session = createDocumentSession(source), stop = session.subscribe(() => { throw Error("Writer unavailable"); });
  expect(() => applyDocumentSourceChanges(session, session.snapshot(), plan, "input.link.mentions")).toThrow(/could not update/);
  expect(session.snapshot().source).toBe(plan.output); stop(); expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe(source);
});
