import { expect, it, vi } from "vitest";
import { historyField, isolateHistory, redoDepth, undoDepth } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { createDocumentSession, type DocumentSessionUpdate } from "../src/index";
import { editorSource, editorSourceEffect, tidyEditorHistory } from "../src/tidy";

const original = "\uFEFF# Alpha\r\n\r\nWords kept.\r\n";
const normalized = (value: string) => value.replace(/\r\n?/g, "\n");
const view = (source: string, anchor = 0) => EditorState.create({ doc: normalized(source), selection: { anchor }, extensions: [tidyEditorHistory(source)] });
const input = [Transaction.userEvent.of("input.type"), isolateHistory.of("full")];

it("keeps a stable exact-source snapshot until a real source change", () => {
  const session = createDocumentSession(original), snapshot = session.snapshot(), changed = vi.fn(); session.subscribe(changed);
  expect(snapshot.source).toBe(original); expect(snapshot.revision).toBe(0);
  expect(snapshot.state.doc.toString()).toBe(normalized(original));
  expect(session.snapshot()).toBe(snapshot); expect(session.undo()).toBe(false); expect(session.redo()).toBe(false);
  expect(session.apply(view(original).update({ selection: { anchor: 3 } }), 0)).toBe(false);
  expect(session.replaceSource(original)).toBe(false);
  expect(session.snapshot()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
});

it("shares one history across two independently selected views without echoing the acting edit", () => {
  const session = createDocumentSession(original), paneA = {}, paneB = {};
  const position = normalized(original).indexOf("Alpha") + 5;
  const views = new Map([[paneA, view(original, position)], [paneB, view(original, normalized(original).length)]]);
  const updates: DocumentSessionUpdate[] = [];
  session.subscribe((update) => {
    updates.push(update);
    for (const [actor, state] of views) {
      if (update.kind === "edit" && update.actor === actor) continue;
      views.set(actor, state.update({ changes: update.changes, effects: update.effects,
        ...(update.actor === actor ? { selection: update.selection } : {}), annotations: Transaction.addToHistory.of(false) }).state);
    }
  });
  function type(actor: object, text: string) {
    const before = views.get(actor)!, from = before.selection.main.head;
    const transaction = before.update({ changes: { from, insert: text }, selection: { anchor: from + text.length }, annotations: input });
    views.set(actor, transaction.state);
    expect(session.apply(transaction, session.snapshot().revision, actor)).toBe(true);
  }
  type(paneA, "!"); const first = original.replace("Alpha", "Alpha!");
  expect(editorSource(views.get(paneB)!)).toBe(first);
  expect(views.get(paneB)!.selection.main.head).toBe(normalized(first).length);
  type(paneB, "Beta"); expect(session.snapshot().source).toBe(first + "Beta");
  expect(views.get(paneA)!.selection.main.head).toBe(position + 1);
  expect(undoDepth(session.snapshot().state)).toBe(2);
  expect(session.undo(paneB)).toBe(true); expect(session.snapshot().source).toBe(first);
  expect(session.undo(paneA)).toBe(true); expect(session.snapshot().source).toBe(original);
  expect(session.redo(paneA)).toBe(true); expect(session.redo(paneB)).toBe(true);
  for (const state of views.values()) { expect(editorSource(state)).toBe(first + "Beta"); expect(state.field(historyField, false)).toBeUndefined(); }
  expect(updates.map((update) => update.kind)).toEqual(["edit", "edit", "undo", "undo", "redo", "redo"]);
  expect(updates.map((update) => update.revision)).toEqual([1, 2, 3, 4, 5, 6]);
});

it("retains BOM and mixed physical endings through a source-changing action and its Undo/Redo", () => {
  const source = "\uFEFF# Alpha\r\n\rWords\nEnd\r\n", output = "\uFEFF# Alpha\n\nWords\nEnd\n";
  const session = createDocumentSession(source), before = view(source);
  const transaction = before.update({ effects: editorSourceEffect(output), annotations: [Transaction.userEvent.of("input.tidy"), isolateHistory.of("full")] });
  expect(session.apply(transaction, 0)).toBe(true); expect(session.snapshot().source).toBe(output);
  expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe(source);
  expect(editorSource(session.snapshot().state)).toBe(source);
  expect(session.redo()).toBe(true); expect(session.snapshot().source).toBe(output);
});

it("keeps view-local extensions out of the retained document history", () => {
  const session = createDocumentSession(original), local = StateField.define({ create: () => "view callback state", update: (value) => value });
  const transaction = view(original).update({ changes: { from: 0, insert: "!" }, effects: StateEffect.appendConfig.of(local), annotations: input });
  expect(session.apply(transaction, 0)).toBe(true);
  expect(session.snapshot().state.field(local, false)).toBeUndefined();
  expect(undoDepth(session.snapshot().state)).toBe(1);
  expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe(original);
});

it("rejects stale revisions and different physical source without overwriting either proposal", () => {
  const session = createDocumentSession(original), before = view(original), changed = vi.fn(); session.subscribe(changed);
  expect(session.apply(before.update({ changes: { from: 0, insert: "!" }, annotations: input }), 0)).toBe(true);
  const accepted = session.snapshot(), proposal = before.update({ changes: { from: 0, insert: "Other words" }, annotations: input });
  expect(session.apply(proposal, 0)).toBe(false); expect(session.snapshot()).toBe(accepted);
  expect(editorSource(proposal.state)).toBe("Other words" + original); expect(changed).toHaveBeenCalledTimes(1);
  const mismatched = view(normalized(accepted.source)).update({ changes: { from: 0, insert: "Wrong raw base" }, annotations: input });
  expect(session.apply(mismatched, accepted.revision)).toBe(false); expect(session.snapshot()).toBe(accepted);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("resets old Undo when authoritative external source replaces a cached document", () => {
  const session = createDocumentSession(original), changed = vi.fn(); session.subscribe(changed);
  session.apply(view(original).update({ changes: { from: 0, insert: "!" }, annotations: input }), 0);
  expect(undoDepth(session.snapshot().state)).toBe(1);
  const external = "\uFEFF# External\r\n\r\nNewer words kept.\r\n";
  expect(session.replaceSource(external)).toBe(true); const snapshot = session.snapshot();
  expect(editorSource(snapshot.state)).toBe(external); expect(snapshot.source).toBe(external);
  expect(undoDepth(snapshot.state)).toBe(0); expect(redoDepth(snapshot.state)).toBe(0);
  expect(session.undo()).toBe(false); expect(session.redo()).toBe(false);
  expect(session.replaceSource(external)).toBe(false); expect(session.snapshot()).toBe(snapshot);
  expect(changed).toHaveBeenCalledTimes(2); expect(changed.mock.lastCall?.[0].kind).toBe("external");
});

it("retains history when an old view unsubscribes and a new view opens the same file", () => {
  const session = createDocumentSession(original), oldView = vi.fn(), detach = session.subscribe(oldView);
  session.apply(view(original).update({ changes: { from: 0, insert: "!" }, annotations: input }), 0);
  detach(); detach(); const freshView = vi.fn(); session.subscribe(freshView);
  expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe(original);
  expect(oldView).toHaveBeenCalledTimes(1); expect(freshView).toHaveBeenCalledTimes(1);
});

it("retains committed words and notifies other subscribers when one view callback fails", () => {
  const session = createDocumentSession(original), received = vi.fn();
  const detach = session.subscribe(() => { throw new Error("Detached view failed"); }); session.subscribe(received);
  expect(() => session.apply(view(original).update({ changes: { from: 0, insert: "!" }, annotations: input }), 0)).toThrow(AggregateError);
  expect(session.snapshot().source).toBe("!" + original); expect(received).toHaveBeenCalledTimes(1);
  detach(); expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe(original);
});

it("refuses document mutations from a read-only view", () => {
  const session = createDocumentSession(original), changed = vi.fn(); session.subscribe(changed);
  const readonly = view(original).update({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }).state;
  const proposal = readonly.update({ changes: { from: 0, insert: "Not writable" }, annotations: input });
  expect(session.apply(proposal, 0)).toBe(false); expect(session.snapshot().source).toBe(original);
  expect(undoDepth(session.snapshot().state)).toBe(0); expect(changed).not.toHaveBeenCalled();
});

it("refuses reentrant source mutations while delivering a committed update", () => {
  const session = createDocumentSession(original), received = vi.fn();
  session.subscribe(() => { expect(() => session.replaceSource("Reentrant replacement")).toThrow(/current document update/); });
  session.subscribe(received);
  expect(session.apply(view(original).update({ changes: { from: 0, insert: "!" }, annotations: input }), 0)).toBe(true);
  expect(session.snapshot()).toMatchObject({ source: "!" + original, revision: 1 }); expect(received).toHaveBeenCalledTimes(1);
});

it("keeps composition separate from a preceding independently undoable action", () => {
  const session = createDocumentSession("Alpha"); let state = view("Alpha");
  const action = state.update({ changes: { from: 0, insert: "!" }, annotations: input });
  session.apply(action, 0); state = action.state;
  for (const text of ["ব", "া"]) {
    const transaction = state.update({ changes: { from: state.doc.length, insert: text }, annotations: Transaction.userEvent.of("input.type.compose") });
    session.apply(transaction, session.snapshot().revision); state = transaction.state;
  }
  expect(session.snapshot().source).toBe("!Alphaবা");
  expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe("!Alpha");
  expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe("Alpha");
});

it("checks current edit permission before edits and history commands while allowing disk updates", () => {
  let owned = true;
  const session = createDocumentSession(original, () => owned);
  session.apply(view(original).update({ changes: { from: 0, insert: "!" }, annotations: input }), 0);
  const snapshot = session.snapshot(); owned = false;
  const proposal = view(snapshot.source).update({ changes: { from: 0, insert: "Not owned" }, annotations: input });
  expect(session.apply(proposal, snapshot.revision)).toBe(false);
  expect(session.undo()).toBe(false); expect(session.redo()).toBe(false); expect(session.snapshot()).toBe(snapshot);
  owned = true; expect(session.undo()).toBe(true); expect(session.snapshot().source).toBe(original);
  owned = false; expect(session.replaceSource("External source while read-only")).toBe(true);
  expect(session.snapshot().source).toBe("External source while read-only");
});

it("refuses an authoritative-source request captured before newer typing", () => {
  const session = createDocumentSession(original), rendered = session.snapshot();
  session.apply(view(original).update({ changes: { from: 0, insert: "New typing" }, annotations: input }), rendered.revision);
  const typed = session.snapshot();
  expect(session.replaceSource("Stale rendered source", rendered.revision)).toBe(false);
  expect(session.snapshot()).toBe(typed); expect(session.snapshot().source).toBe("New typing" + original);
  expect(session.replaceSource("Fresh external source", typed.revision)).toBe(true);
  expect(session.snapshot().source).toBe("Fresh external source");
});

it("publishes action origins so save observers can distinguish Tidy from typing and Undo", () => {
  const session = createDocumentSession(original), changed = vi.fn(); session.subscribe(changed);
  const transaction = view(original).update({ changes: { from: 0, insert: "!" }, annotations: [Transaction.userEvent.of("input.tidy"), isolateHistory.of("full")] });
  session.apply(transaction, 0); expect(changed.mock.lastCall?.[0].userEvent).toBe("input.tidy");
  session.undo(); expect(changed.mock.lastCall?.[0].userEvent).toBe("undo");
  session.redo(); expect(changed.mock.lastCall?.[0].userEvent).toBe("redo");
  session.replaceSource("Authoritative disk source"); expect(changed.mock.lastCall?.[0].userEvent).toBeUndefined();
});
