import { beforeEach, expect, it, vi } from "vitest";
import { captureRecoveryKey, createCaptureRecovery, type CaptureCompleted, type CaptureDraft } from "../src/native/captureRecovery";
import { createCaptureSession, type CaptureAPI } from "../src/native/captureSession";

const original: CaptureDraft = { id: "12345678-1234-4234-8234-123456789abc", spaceId: "native-default", spaceName: "Slate", text: "", pending: false, revision: 0 };
const done = (draft: CaptureDraft): CaptureCompleted => ({ id: draft.id, spaceId: draft.spaceId, text: draft.text, path: "Inbox/Capture.md", conflict: false });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(draft: CaptureDraft = original, completed: CaptureCompleted | null = null) {
  let listener: ((event: { preventDefault(): void }) => void) | undefined;
  const unlisten = vi.fn();
  const api: CaptureAPI = {
    snapshot: vi.fn(async () => ({ activeDraft: draft, lastCompleted: completed })),
    stash: vi.fn(async () => undefined), save: vi.fn(async value => done(value)),
    onClose: vi.fn(async receive => { listener = receive; return unlisten; }),
    requestClose: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined), showMain: vi.fn(async () => undefined),
  };
  const recovery = createCaptureRecovery(localStorage);
  const session = createCaptureSession(api, recovery);
  return { api, recovery, session, unlisten, close: () => { const preventDefault = vi.fn(); listener!({ preventDefault }); return preventDefault; } };
}
beforeEach(() => localStorage.clear());

it("installs one close guard before enabling input and keeps every input synchronously", async () => {
  const fixture = setup();
  expect(fixture.session.getSnapshot().ready).toBe(false);
  const opening = fixture.session.start();
  expect(fixture.session.start()).toBe(opening);
  await opening;
  expect(fixture.api.onClose).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fixture.api.onClose).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fixture.api.snapshot).mock.invocationCallOrder[0]!);
  fixture.session.change("exact\r\nবাংলা");
  expect(JSON.parse(localStorage.getItem(captureRecoveryKey)!).draft.text).toBe("exact\r\nবাংলা");
  fixture.session.dispose();
  expect(fixture.unlisten).toHaveBeenCalledTimes(1);
});

it("restores a newer local draft into the same frozen Space and preserves line endings", async () => {
  const recovered = { ...original, text: "newer\r\n\r\nthought", revision: 1 };
  const journal = createCaptureRecovery(localStorage); journal.read(); journal.write(recovered);
  const fixture = setup(); await fixture.session.start();
  expect(fixture.session.getSnapshot().draft).toEqual(recovered);
  fixture.close();
  await vi.waitFor(() => expect(fixture.api.destroy).toHaveBeenCalledOnce());
  expect(fixture.api.stash).toHaveBeenCalledWith(recovered);
});

it("freezes an uncertain submission and retries the exact ID/text after a read-only failure", async () => {
  const fixture = setup(); await fixture.session.start(); fixture.session.change("kept");
  vi.mocked(fixture.api.save).mockRejectedValueOnce(new Error("Read-only folder"));
  expect(await fixture.session.save()).toBe(false);
  expect(fixture.session.getSnapshot()).toMatchObject({ error: "Read-only folder", draft: { text: "kept", pending: true } });
  fixture.session.change("must not replace pending text");
  expect(await fixture.session.save()).toBe(true);
  expect(vi.mocked(fixture.api.save).mock.calls.map(([draft]) => [draft.id, draft.text])).toEqual([[original.id, "kept"], [original.id, "kept"]]);
  expect(localStorage.getItem(captureRecoveryKey)).toBeNull();
});

it("quiesces a held save before coalesced Close can stash or destroy", async () => {
  const fixture = setup(); await fixture.session.start(); fixture.session.change("pending words");
  const held = deferred<unknown>(); vi.mocked(fixture.api.save).mockReturnValue(held.promise);
  const saving = fixture.session.save();
  expect(fixture.close()).toHaveBeenCalledOnce(); expect(fixture.close()).toHaveBeenCalledOnce();
  await Promise.resolve(); await Promise.resolve();
  expect(fixture.api.stash).not.toHaveBeenCalled(); expect(fixture.api.destroy).not.toHaveBeenCalled();
  held.reject(new Error("Lost reply")); expect(await saving).toBe(false);
  await vi.waitFor(() => expect(fixture.api.destroy).toHaveBeenCalledOnce());
  expect(fixture.api.stash).toHaveBeenCalledExactlyOnceWith({ ...original, text: "pending words", pending: true, revision: 2 });
});

it("does not restash a successful save when Close arrives while its reply is held", async () => {
  const fixture = setup(); await fixture.session.start(); fixture.session.change("once");
  const held = deferred<unknown>(); vi.mocked(fixture.api.save).mockReturnValue(held.promise);
  const saving = fixture.session.save(); fixture.close();
  held.resolve(done({ ...original, text: "once" })); expect(await saving).toBe(true);
  await vi.waitFor(() => expect(fixture.api.destroy).toHaveBeenCalledOnce());
  expect(fixture.api.stash).not.toHaveBeenCalled();
});

it("failed draft persistence keeps the window open and a later Close retries", async () => {
  const fixture = setup(); await fixture.session.start(); fixture.session.change("visible words");
  vi.mocked(fixture.api.stash).mockRejectedValueOnce(new Error("Disk full")); fixture.close();
  await vi.waitFor(() => expect(fixture.session.getSnapshot().error).toBe("Disk full"));
  expect(fixture.api.destroy).not.toHaveBeenCalled();
  expect(fixture.session.getSnapshot().draft?.text).toBe("visible words");
  fixture.close(); await vi.waitFor(() => expect(fixture.api.destroy).toHaveBeenCalledOnce());
});

it("clears only the acknowledged stale recovery before admitting a fresh capture", async () => {
  const previous = { ...original, text: "already saved", pending: true, revision: 2 };
  const journal = createCaptureRecovery(localStorage); journal.read(); journal.write(previous);
  const next = { ...original, id: "22345678-1234-4234-8234-123456789abc" };
  const fixture = setup(next, done(previous)); await fixture.session.start();
  expect(fixture.session.getSnapshot()).toMatchObject({ ready: true, draft: next });
  expect(JSON.parse(localStorage.getItem(captureRecoveryKey)!).draft).toEqual(next);
  expect(fixture.api.save).not.toHaveBeenCalled();
});

it("foreign recovery is retained, visible for copying and cannot overwrite the active draft", async () => {
  const journal = createCaptureRecovery(localStorage); journal.read(); journal.write({ ...original, spaceId: "22345678-1234-4234-8234-123456789abc", text: "other Space" });
  const before = localStorage.getItem(captureRecoveryKey);
  const fixture = setup(); await expect(fixture.session.start()).rejects.toThrow("different capture");
  expect(fixture.session.getSnapshot()).toMatchObject({ ready: false, draft: { text: "other Space" } });
  fixture.close(); await vi.waitFor(() => expect(fixture.session.getSnapshot().closing).toBe(false));
  expect(fixture.api.stash).not.toHaveBeenCalled(); expect(fixture.api.destroy).not.toHaveBeenCalled();
  expect(localStorage.getItem(captureRecoveryKey)).toBe(before);
});

it("unknown recovery metadata is neither cleared nor overwritten", async () => {
  const raw = '{"version":2,"future":"kept"}'; localStorage.setItem(captureRecoveryKey, raw);
  const fixture = setup(); await expect(fixture.session.start()).rejects.toThrow("newer Slate");
  expect(fixture.session.getSnapshot().ready).toBe(false);
  expect(localStorage.getItem(captureRecoveryKey)).toBe(raw);
});

it("a new recovery generation during a held acknowledgement is kept without resurrecting the saved note", async () => {
  const fixture = setup(); await fixture.session.start(); fixture.session.change("submitted");
  const held = deferred<unknown>(); vi.mocked(fixture.api.save).mockReturnValue(held.promise);
  const saving = fixture.session.save(); await Promise.resolve();
  const raw = '{"version":99,"future":"keep exact bytes"}'; localStorage.setItem(captureRecoveryKey, raw);
  held.resolve(done({ ...original, text: "submitted" })); expect(await saving).toBe(false);
  expect(fixture.session.getSnapshot().completed?.text).toBe("submitted");
  fixture.close(); await vi.waitFor(() => expect(fixture.api.destroy).toHaveBeenCalledOnce());
  expect(fixture.api.stash).not.toHaveBeenCalled(); expect(localStorage.getItem(captureRecoveryKey)).toBe(raw);
});

it("retains typed text and stops editing if synchronous recovery storage fills", async () => {
  const fixture = setup(); await fixture.session.start();
  const broken = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw Error("Quota full"); });
  fixture.session.change("latest visible words");
  expect(fixture.session.getSnapshot()).toMatchObject({ recoveryFailed: true, draft: { text: "latest visible words" } });
  fixture.session.change("cannot lose previous words");
  broken.mockRestore(); fixture.close();
  await vi.waitFor(() => expect(fixture.api.destroy).toHaveBeenCalledOnce());
  expect(fixture.api.stash).toHaveBeenCalledWith({ ...original, text: "latest visible words", revision: 1 });
  expect(localStorage.getItem(captureRecoveryKey)).toBeNull();
  const reopened = setup({ ...original, text: "latest visible words", revision: 1 }); await reopened.session.start();
  expect(reopened.session.getSnapshot().draft?.text).toBe("latest visible words");
});

it("cleans a close listener that resolves after disposal without loading the draft", async () => {
  const fixture = setup(), held = deferred<() => void>();
  vi.mocked(fixture.api.onClose).mockReturnValue(held.promise);
  const opening = fixture.session.start(); await Promise.resolve(); fixture.session.dispose(); held.resolve(fixture.unlisten);
  await opening;
  expect(fixture.unlisten).toHaveBeenCalledOnce(); expect(fixture.api.snapshot).not.toHaveBeenCalled();
});

it("a synchronous journal failure can retry saving after storage becomes available", async () => {
  const fixture = setup(); await fixture.session.start(); fixture.session.change("safe");
  const broken = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw Error("Write unavailable"); });
  expect(await fixture.session.save()).toBe(false); broken.mockRestore();
  expect(fixture.api.save).not.toHaveBeenCalled();
  expect(await fixture.session.save()).toBe(true); expect(fixture.api.save).toHaveBeenCalledOnce();
});

it("a crash after backend stash cannot let an older local generation shadow newer durable words", async () => {
  const journal = createCaptureRecovery(localStorage); journal.read(); journal.write({ ...original, text: "older local text", revision: 1 });
  const latest = { ...original, text: "newest durable words", revision: 2 };
  const fixture = setup(latest); await fixture.session.start();
  expect(fixture.session.getSnapshot().draft).toEqual(latest);
  expect(JSON.parse(localStorage.getItem(captureRecoveryKey)!).draft).toEqual(latest);
});

it("different words at an equal revision are retained for review instead of silently choosing one", async () => {
  const journal = createCaptureRecovery(localStorage); journal.read(); journal.write({ ...original, text: "local words", revision: 1 });
  const raw = localStorage.getItem(captureRecoveryKey);
  const fixture = setup({ ...original, text: "durable words", revision: 1 });
  await expect(fixture.session.start()).rejects.toThrow("different capture");
  expect(localStorage.getItem(captureRecoveryKey)).toBe(raw); expect(fixture.api.stash).not.toHaveBeenCalled();
});
