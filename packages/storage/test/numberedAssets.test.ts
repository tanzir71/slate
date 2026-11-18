import { expect, it, vi } from "vitest";
import { createMemoryFiles } from "../src/browserFiles";
import { createBrowserSpace } from "../src/browserSpace";

it("chooses the first free asset number and preserves existing and empty files", async () => {
  const files = createMemoryFiles();
  await files.write("Drafts/assets/image-1.png", new Uint8Array());
  await files.write("Drafts/assets/image-3.png", new Uint8Array([3]));
  const space = createBrowserSpace(files);
  expect(
    await space.importNumberedFile(
      "Drafts/assets/image.png",
      new Uint8Array([2]),
    ),
  ).toBe("Drafts/assets/image-2.png");
  expect(await files.read("Drafts/assets/image-1.png")).toEqual(
    new Uint8Array(),
  );
  expect(await files.read("Drafts/assets/image-2.png")).toEqual(
    new Uint8Array([2]),
  );
  expect(await files.read("Drafts/assets/image-3.png")).toEqual(
    new Uint8Array([3]),
  );
});
it("serializes concurrent imports and snapshots bytes when each call starts", async () => {
  const files = createMemoryFiles();
  const space = createBrowserSpace(files);
  const firstBytes = new Uint8Array([1]);
  const first = space.importNumberedFile("assets/image.png", firstBytes);
  const second = space.importNumberedFile(
    "assets/image.png",
    new Uint8Array([2]),
  );
  firstBytes[0] = 99;
  expect(await Promise.all([first, second])).toEqual([
    "assets/image-1.png",
    "assets/image-2.png",
  ]);
  expect(await files.read("assets/image-1.png")).toEqual(new Uint8Array([1]));
  expect(await files.read("assets/image-2.png")).toEqual(new Uint8Array([2]));
});
it.each([
  ["image", "image-1"],
  [".asset", ".asset-1"],
  ["a.b.png", "a.b-1.png"],
])(
  "numbers the filename %s before its final extension",
  async (path, expected) => {
    const space = createBrowserSpace(createMemoryFiles());
    expect(await space.importNumberedFile(path!, new Uint8Array([1]))).toBe(
      expected,
    );
  },
);
it.each([
  "../image.png",
  "/image.png",
  "C:\\image.png",
  "a//image.png",
  "a/../image.png",
  "a/./image.png",
])("rejects invalid asset path %s before writing", async (path) => {
  const files = createMemoryFiles();
  await expect(
    createBrowserSpace(files).importNumberedFile(path, new Uint8Array([1])),
  ).rejects.toThrow("Invalid workspace path");
  expect(await files.list(true)).toEqual([]);
});
it("fails closed without ownership and does not treat read failures as free names", async () => {
  const files = createMemoryFiles();
  await expect(
    createBrowserSpace(files, () => false).importNumberedFile(
      "image.png",
      new Uint8Array([1]),
    ),
  ).rejects.toThrow("read-only");
  vi.spyOn(files, "read").mockRejectedValueOnce(new Error("Cannot read"));
  await expect(
    createBrowserSpace(files).importNumberedFile(
      "image.png",
      new Uint8Array([1]),
    ),
  ).rejects.toThrow("Cannot read");
  expect(await files.list(true)).toEqual([]);
});
it("keeps an interrupted asset and recovers the write queue without replacing it", async () => {
  const files = createMemoryFiles();
  const write = files.write.bind(files);
  vi.spyOn(files, "write").mockImplementationOnce(async (path) => {
    await write(path, new Uint8Array([9]));
    throw new Error("Interrupted");
  });
  const space = createBrowserSpace(files);
  await expect(
    space.importNumberedFile("image.png", new Uint8Array([1])),
  ).rejects.toThrow("Interrupted");
  expect(await space.importNumberedFile("image.png", new Uint8Array([2]))).toBe(
    "image-2.png",
  );
  expect(await files.read("image-1.png")).toEqual(new Uint8Array([9]));
  expect(await files.read("image-2.png")).toEqual(new Uint8Array([2]));
});
