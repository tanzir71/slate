import { expect, it, vi } from "vitest";
import { createBrowserSpace } from "../src/browserSpace";
import { createMemoryFiles, encodeText } from "../src/browserFiles";

it("serializes canonical creation without suffix copies or replacement, including empty/unknown bytes", async () => {
  for (const initial of [
    undefined,
    encodeText(""),
    new Uint8Array([0xff, 0xfe, 0xfd]),
  ]) {
    const files = createMemoryFiles();
    if (initial) await files.write("Daily/day.md", initial);
    const space = createBrowserSpace(files);
    const created = await Promise.all([
      space.createIfMissing("Daily/day.md", "First"),
      space.createIfMissing("Daily/day.md", "Second"),
    ]);
    expect(created.filter(Boolean)).toHaveLength(initial ? 0 : 1);
    expect(await files.list()).toEqual(["Daily/day.md"]);
    expect(await files.read("Daily/day.md")).toEqual(
      initial ?? encodeText("First"),
    );
  }
});
it("checks canonical existence after earlier queued writes rather than replacing them", async () => {
  const files = createMemoryFiles();
  const space = createBrowserSpace(files);
  const first = space.create("Daily/day.md", "Other creation");
  const second = space.createIfMissing("Daily/day.md", "Daily content");
  await first;
  expect(await second).toBeUndefined();
  expect(await space.read("Daily/day.md")).toBe("Other creation");
});
it("propagates read/write errors and can retry without poisoning the queue", async () => {
  const files = createMemoryFiles();
  const space = createBrowserSpace(files);
  const read = vi
    .spyOn(files, "read")
    .mockRejectedValueOnce(new Error("Read refused"));
  await expect(space.createIfMissing("Daily/day.md", "Keep")).rejects.toThrow(
    "Read refused",
  );
  read.mockRestore();
  const write = vi
    .spyOn(files, "write")
    .mockRejectedValueOnce(new Error("Write refused"));
  await expect(space.createIfMissing("Daily/day.md", "Keep")).rejects.toThrow(
    "Write refused",
  );
  write.mockRestore();
  expect(await space.createIfMissing("Daily/day.md", "Keep")).toEqual({
    path: "Daily/day.md",
    content: "Keep",
  });
});
it("refuses nonportable targets and writes from a reader", async () => {
  const files = createMemoryFiles();
  await expect(async () =>
    createBrowserSpace(files).createIfMissing("../day.md", "Keep"),
  ).rejects.toThrow();
  await expect(
    createBrowserSpace(files, () => false).createIfMissing(
      "Daily/day.md",
      "Keep",
    ),
  ).rejects.toThrow("read-only");
  expect(await files.list()).toEqual([]);
});

it("preserves a partial file after an interrupted first write rather than replacing it on retry", async () => {
  const files = createMemoryFiles();
  const space = createBrowserSpace(files);
  const write = files.write;
  vi.spyOn(files, "write").mockImplementationOnce(async (path) => {
    await write(path, encodeText("Partial words"));
    throw new Error("Write interrupted");
  });
  await expect(
    space.createIfMissing("Daily/day.md", "Complete words"),
  ).rejects.toThrow("Write interrupted");
  expect(
    await space.createIfMissing("Daily/day.md", "Retry words"),
  ).toBeUndefined();
  expect(await space.read("Daily/day.md")).toBe("Partial words");
  expect(await files.list()).toEqual(["Daily/day.md"]);
});
