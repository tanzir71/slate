import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { createBrowserSpace } from "@slate/storage/browser-space";
import { BlockPreview } from "../src/BlockPreview";
import { readBlockUsage } from "../src/blockUsage";
import { importBlockImage } from "../src/browser/importBlockImage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("accepts valid optional usage history and ignores corrupt entries", () => {
  expect(
    readBlockUsage(
      '{"table":{"count":2,"lastUsed":100},"bad":{"count":-1,"lastUsed":0},"oops":null}',
    ),
  ).toEqual({ table: { count: 2, lastUsed: 100 } });
  for (const raw of [
    null,
    "bad JSON",
    "[]",
    "null",
    "1",
    '{"table":{"count":"2","lastUsed":10}}',
  ])
    expect(readBlockUsage(raw)).toEqual({});
});

it("renders actual GFM table nodes and keeps HTML/script URLs inert", async () => {
  const parent = document.body.appendChild(document.createElement("div"));
  const root = createRoot(parent);
  try {
    await act(async () =>
      root.render(
        createElement(BlockPreview, {
          markdown:
            "| First | Second |\n| --- | --- |\n| A | B |\n\n**Words** [unsafe](javascript:alert(1)) [heading](#heading) [website](https://example.com)\n\n<script>window.oops = true</script>",
        }),
      ),
    );
    expect(parent.querySelectorAll("th")).toHaveLength(2);
    expect(parent.querySelectorAll("td")).toHaveLength(2);
    expect(parent.querySelector("strong")?.textContent).toBe("Words");
    expect(parent.querySelectorAll("a")).toHaveLength(3);
    expect(
      [...parent.querySelectorAll("a")].every(
        (link) => !link.hasAttribute("href"),
      ),
    ).toBe(true);
    expect(parent.querySelector("script")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    parent.remove();
  }
});

it("copies exact image bytes, chooses extensions from MIME and preserves collisions", async () => {
  const files = createMemoryFiles();
  const space = createBrowserSpace(files);
  const bytes = new Uint8Array([137, 80, 78, 71, 10]);
  const file = {
    name: "Diagram.md",
    type: "image/png",
    arrayBuffer: async () => bytes.buffer,
  };
  const first = await importBlockImage(space, file);
  expect(first).toEqual({ path: "assets/diagram.png", alt: "Diagram" });
  expect(await files.read(first.path)).toEqual(bytes);
  const next = await importBlockImage(space, {
    ...file,
    arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
  });
  expect(next.path).not.toBe(first.path);
  expect(await files.read(first.path)).toEqual(bytes);
  expect(await files.read(next.path)).toEqual(new Uint8Array([1, 2]));
  await expect(
    importBlockImage(space, { ...file, type: "text/plain" }),
  ).rejects.toThrow("Choose a PNG");
  const readonly = createBrowserSpace(files, () => false);
  await expect(importBlockImage(readonly, file)).rejects.toThrow("read-only");
  expect(await files.list()).toHaveLength(2);
});
