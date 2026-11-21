import { expect, it } from "vitest";
import { createDocumentSession } from "../src/documentSession.js";
import { appendDocumentText } from "../src/launchAppend.js";

it("appends with one shared Undo while retaining exact physical bytes", () => {
  const before = "\uFEFF# Kept\r\n\r\nOriginal words.\r\n", session = createDocumentSession(before);
  expect(appendDocumentText(session, before, "New\nwords.\n")).toBe(true);
  expect(session.snapshot().source).toBe(before + "\r\nNew\r\nwords.\r\n");
  expect(session.undo()).toBe(true);
  expect(session.snapshot().source).toBe(before);
  expect(session.undo()).toBe(false);
  expect(session.redo()).toBe(true);
  expect(session.snapshot().source).toBe(before + "\r\nNew\r\nwords.\r\n");
});

it("refuses changed sources, readers and empty requests without a history entry", () => {
  const session = createDocumentSession("Kept");
  expect(appendDocumentText(session, "Old", "New")).toBe(false);
  expect(appendDocumentText(session, "Kept", "")).toBe(false);
  expect(session.snapshot().source).toBe("Kept");
  expect(session.undo()).toBe(false);
  const reader = createDocumentSession("Kept", () => false);
  expect(appendDocumentText(reader, "Kept", "New")).toBe(false);
  expect(reader.snapshot().source).toBe("Kept");
});

it("keeps appends separate from adjacent typing and publishes the supplied actor", () => {
  const session = createDocumentSession("Kept"), snapshot = session.snapshot(), actor = {};
  session.apply(snapshot.state.update({ changes: { from: 4, insert: " typed" }, userEvent: "input.type" }), snapshot.revision);
  const updates: unknown[] = [];
  session.subscribe(update => updates.push(update.actor));
  expect(appendDocumentText(session, "Kept typed", "Appended", actor)).toBe(true);
  expect(updates).toEqual([actor]);
  expect(session.undo()).toBe(true);
  expect(session.snapshot().source).toBe("Kept typed");
  expect(session.undo()).toBe(true);
  expect(session.snapshot().source).toBe("Kept");
});
