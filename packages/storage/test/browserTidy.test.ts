import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "../src/browserFiles";
import { createBrowserSpace } from "../src/browserSpace";
import { createTidyFileStore, spaceTidyPath } from "../src/browserTidy";

const original =
  '{\n "version": 1, "future": 9007199254740993, "rules": {"future-rule": {"keep":true}}\n}\n';
const replacement = original.replace(
  '"version": 1',
  '"version": 1, "preset": "minimal"',
);
afterEach(() => vi.restoreAllMocks());

it("reads missing settings without creating files and saves only the exact explicit JSON", async () => {
  const files = createMemoryFiles({
    "note.md": "Keep my words",
    ".slate/space.json": "{}",
  });
  const store = createTidyFileStore(createBrowserSpace(files));
  const snapshot = await store.read();
  expect(snapshot).toEqual({ path: spaceTidyPath, status: "missing" });
  expect(await files.list(true)).toEqual([".slate/space.json", "note.md"]);
  expect(await store.save(snapshot, original)).toEqual({
    path: spaceTidyPath,
    content: original,
    conflict: false,
  });
  expect(await files.read(spaceTidyPath)).toEqual(encodeText(original));
  expect(await files.read("note.md")).toEqual(encodeText("Keep my words"));
  expect(await files.read(".slate/space.json")).toEqual(encodeText("{}"));
  expect(await store.read()).toMatchObject({
    status: "valid",
    source: original,
    configuration: {
      preset: "slate",
      onSave: false,
      keepHardBreaks: true,
      rules: { "future-rule": { keep: true } },
    },
  });
});

it.each([
  "",
  "{broken",
  '{"version":2}',
  '{"version":1,"preset":null}',
  '{"version":1,"rules":{"heading-space":"yes"}}',
])("preserves invalid settings for explicit repair: %j", async (source) => {
  const files = createMemoryFiles({ [spaceTidyPath]: source });
  const store = createTidyFileStore(createBrowserSpace(files));
  const snapshot = await store.read();
  expect(snapshot).toMatchObject({
    status: "invalid",
    source,
    bytes: encodeText(source),
    error: expect.any(String),
  });
  expect(snapshot.configuration).toBeUndefined();
  expect(await files.read(spaceTidyPath)).toEqual(encodeText(source));
  await expect(store.save(snapshot, replacement)).resolves.toMatchObject({
    conflict: false,
  });
  expect(await files.read(spaceTidyPath)).toEqual(encodeText(replacement));
});

it("keeps unsupported bytes and refuses to overwrite an unreadable snapshot", async () => {
  const files = createMemoryFiles();
  const bytes = new Uint8Array([0xff, 0xfe, 0]);
  await files.write(spaceTidyPath, bytes);
  const store = createTidyFileStore(createBrowserSpace(files));
  const snapshot = await store.read();
  expect(snapshot).toMatchObject({ status: "unsupported", bytes });
  await expect(store.save(snapshot, original)).rejects.toThrow("editable Tidy");
  expect(await files.read(spaceTidyPath)).toEqual(bytes);
  expect(await files.list(true)).toEqual([spaceTidyPath]);
});

it("keeps read failures distinct from an absent file", async () => {
  const files = createMemoryFiles({ [spaceTidyPath]: original });
  vi.spyOn(files, "read").mockRejectedValueOnce(new Error("Disk unavailable"));
  const store = createTidyFileStore(createBrowserSpace(files));
  const snapshot = await store.read();
  expect(snapshot).toEqual({
    path: spaceTidyPath,
    status: "unavailable",
    error: "Disk unavailable",
  });
  await expect(store.save(snapshot, replacement)).rejects.toThrow(
    "editable Tidy",
  );
  expect((await store.read()).source).toBe(original);
});

it("retains external edits and returns an exact conflict copy of the proposed settings", async () => {
  const files = createMemoryFiles({ [spaceTidyPath]: original });
  const space = createBrowserSpace(files),
    store = createTidyFileStore(space);
  const snapshot = await store.read();
  const external = original.replace(
    '"version": 1',
    '"version": 1, "onSave": true',
  );
  await files.write(spaceTidyPath, encodeText(external));
  const result = await store.save(snapshot, replacement);
  expect(result.conflict).toBe(true);
  expect(result.path).not.toBe(spaceTidyPath);
  expect(await files.read(spaceTidyPath)).toEqual(encodeText(external));
  expect(await files.read(result.path)).toEqual(encodeText(replacement));
});

it("preserves a file created after a missing snapshot, even when it is empty", async () => {
  const files = createMemoryFiles(),
    store = createTidyFileStore(createBrowserSpace(files));
  const snapshot = await store.read();
  await files.write(spaceTidyPath, encodeText(""));
  const result = await store.save(snapshot, original);
  expect(result.conflict).toBe(true);
  expect(await files.read(spaceTidyPath)).toEqual(encodeText(""));
  expect(await files.read(result.path)).toEqual(encodeText(original));
});

it("retains a JSON BOM and detects a byte-only external change before saving", async () => {
  const source = `\uFEFF${original}`;
  const files = createMemoryFiles({ [spaceTidyPath]: source });
  const store = createTidyFileStore(createBrowserSpace(files));
  const snapshot = await store.read();
  expect(snapshot).toMatchObject({ status: "valid", source });
  const proposed = source.replace(
    '"version": 1',
    '"version": 1, "onSave": true',
  );
  expect((await store.save(snapshot, proposed)).conflict).toBe(false);
  expect(await files.read(spaceTidyPath)).toEqual(encodeText(proposed));
  const current = await store.read();
  await files.write(spaceTidyPath, encodeText(proposed.slice(1)));
  const conflict = await store.save(current, `\uFEFF${replacement}`);
  expect(conflict.conflict).toBe(true);
  expect(await files.read(spaceTidyPath)).toEqual(
    encodeText(proposed.slice(1)),
  );
  expect(await files.read(conflict.path)).toEqual(
    encodeText(`\uFEFF${replacement}`),
  );
});

it("serializes competing saves and preserves a newly unsupported external file", async () => {
  const files = createMemoryFiles({ [spaceTidyPath]: original });
  const store = createTidyFileStore(createBrowserSpace(files));
  const snapshot = await store.read();
  const [saved, conflict] = await Promise.all([
    store.save(snapshot, replacement),
    store.save(snapshot, '{"version":1,"preset":"github"}'),
  ]);
  expect(saved.conflict).toBe(false);
  expect(conflict.conflict).toBe(true);
  expect(await files.read(spaceTidyPath)).toEqual(encodeText(replacement));
  expect(await files.read(conflict.path)).toEqual(
    encodeText('{"version":1,"preset":"github"}'),
  );
  const current = await store.read();
  const external = new Uint8Array([0xff, 0xfe]);
  await files.write(spaceTidyPath, external);
  const result = await store.save(current, original);
  expect(result.conflict).toBe(true);
  expect(await files.read(spaceTidyPath)).toEqual(external);
  expect(await files.read(result.path)).toEqual(encodeText(original));
});

it("rejects invalid JSON, a wrong snapshot path and lost write ownership before any write", async () => {
  const files = createMemoryFiles();
  let writable = true;
  const store = createTidyFileStore(createBrowserSpace(files, () => writable));
  const snapshot = await store.read();
  for (const source of [
    "{}",
    '{"version":1,"onSave":null}',
    '{"version":1,"rules":[]}',
  ])
    await expect(store.save(snapshot, source)).rejects.toThrow();
  await expect(
    store.save(
      { ...snapshot, path: "other" as typeof spaceTidyPath },
      original,
    ),
  ).rejects.toThrow("editable Tidy");
  writable = false;
  await expect(store.save(snapshot, original)).rejects.toThrow("read-only");
  expect(await files.list(true)).toEqual([]);
});
