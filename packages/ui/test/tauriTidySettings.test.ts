import { expect, it, vi } from "vitest";
import { createTauriTidySettingsStore } from "../src/tauriTidySettings";
import type { TauriInvoke } from "../src/tauriAutosave";

function transport(reply: unknown) {
  const calls = vi.fn<
    (command: string, args?: Record<string, unknown>) => Promise<unknown>
  >(async () => reply);
  // The fixture returns unknown intentionally so malformed IPC responses exercise validation.
  const invoke: TauriInvoke = async <Result>(
    command: string,
    args?: Record<string, unknown>,
  ) => (await calls(command, args)) as Result;
  return { calls, store: createTauriTidySettingsStore({ invoke }) };
}
const bytes = (source: string) => Array.from(new TextEncoder().encode(source));
const source = '\uFEFF{\r\n "version":1,"future":9007199254740993\r\n}\r\n';

it("reads a missing fixed settings file without creating or saving it", async () => {
  const { store, calls } = transport(null);
  expect(await store.read()).toEqual({
    path: ".slate/tidy.json",
    status: "missing",
  });
  expect(calls).toHaveBeenCalledExactlyOnceWith(
    "read_tidy_settings",
    undefined,
  );
});

it("interprets readable exact bytes while retaining BOM, CRLF and unknown numeric spelling", async () => {
  const { store } = transport(bytes(source));
  const file = await store.read();
  expect(file).toMatchObject({
    path: ".slate/tidy.json",
    status: "valid",
    source,
    configuration: { version: 1, onSave: false },
  });
  expect(Array.from(file.bytes!)).toEqual(bytes(source));
});

it("keeps malformed JSON repairable and undecodable bytes read-only", async () => {
  const invalid = await transport(bytes("{broken")).store.read();
  expect(invalid).toMatchObject({
    status: "invalid",
    source: "{broken",
  });
  expect(Array.from(invalid.bytes!)).toEqual(bytes("{broken"));
  const unsupported = await transport([0xff, 0x00]).store.read();
  expect(unsupported).toMatchObject({
    status: "unsupported",
  });
  expect(Array.from(unsupported.bytes!)).toEqual([0xff, 0x00]);
  expect(unsupported.source).toBeUndefined();
});

it("keeps an empty file distinct from missing settings", async () => {
  const file = await transport([]).store.read();
  expect(file).toMatchObject({ status: "invalid", source: "" });
  expect(Array.from(file.bytes!)).toEqual([]);
});

it("rejects a forged snapshot path before invoking any native command", async () => {
  const { store, calls } = transport(null);
  const snapshot = { path: ".slate/tidy.json", status: "missing" } as const;
  Reflect.set(snapshot, "path", "../other.json");
  await expect(store.save(snapshot, '{"version":1}')).rejects.toThrow(
    "Read an editable Tidy file",
  );
  expect(calls).not.toHaveBeenCalled();
});

it("propagates native save errors so the editor can retain its settings draft", async () => {
  const invoke: TauriInvoke = async () => {
    throw new Error("Disk unavailable");
  };
  await expect(
    createTauriTidySettingsStore({ invoke }).save(
      { path: ".slate/tidy.json", status: "missing" },
      '{"version":1}',
    ),
  ).rejects.toThrow("Disk unavailable");
});

it.each([[256], [-1], [1.5], ["1"], {}, "raw", undefined])(
  "reports malformed IPC byte payload %j as unavailable",
  async (reply) => {
    const file = await transport(reply).store.read();
    expect(file.status).toBe("unavailable");
    expect(file.error).toContain("Invalid native Tidy settings response");
  },
);

it("reports native read failures without enabling on-save", async () => {
  const invoke: TauriInvoke = async () => {
    throw new Error("Access denied");
  };
  expect(await createTauriTidySettingsStore({ invoke }).read()).toMatchObject({
    status: "unavailable",
    error: "Access denied",
  });
});

it("saves original snapshot bytes with the literal proposed JSON through fixed-path IPC", async () => {
  const snapshot = await transport(bytes(source)).store.read();
  const proposed = source.replace('"version":1', '"version":1,"onSave":true');
  const { store, calls } = transport({
    status: "written",
    path: ".slate/tidy.json",
  });
  expect(await store.save(snapshot, proposed)).toEqual({
    path: ".slate/tidy.json",
    content: proposed,
    conflict: false,
  });
  expect(calls).toHaveBeenCalledExactlyOnceWith("write_tidy_settings", {
    bytes: bytes(proposed),
    baseBytes: bytes(source),
  });
});

it("makes absence explicit and exposes native conflict paths without claiming a canonical save", async () => {
  const snapshot = await transport(null).store.read();
  const path = ".slate/tidy (conflicted copy 12-1).json";
  const { store, calls } = transport({ status: "conflict-copy", path });
  expect(await store.save(snapshot, '{"version":1}')).toEqual({
    path,
    content: '{"version":1}',
    conflict: true,
  });
  expect(calls).toHaveBeenCalledExactlyOnceWith("write_tidy_settings", {
    bytes: bytes('{"version":1}'),
    baseBytes: null,
  });
});

it("rejects unsupported/unavailable snapshots and invalid proposals before invoking a write", async () => {
  const { store, calls } = transport(null);
  for (const status of ["unsupported", "unavailable"] as const) {
    await expect(
      store.save({ path: ".slate/tidy.json", status }, '{"version":1}'),
    ).rejects.toThrow("Read an editable Tidy file");
  }
  const snapshot = { path: ".slate/tidy.json", status: "missing" } as const;
  await expect(store.save(snapshot, "{broken")).rejects.toThrow();
  await expect(store.save(snapshot, '{"version":2}')).rejects.toThrow(
    "Unsupported",
  );
  expect(calls).not.toHaveBeenCalled();
});

it.each([
  { status: "written", path: "../elsewhere" },
  { status: "conflict-copy", path: ".slate/tidy.json" },
  { status: "written" },
  { status: "unknown", path: ".slate/tidy.json" },
  null,
])("rejects an invalid native write response %j", async (reply) => {
  await expect(
    transport(reply).store.save(
      { path: ".slate/tidy.json", status: "missing" },
      '{"version":1}',
    ),
  ).rejects.toThrow("Invalid native Tidy save response");
});
