import type { Page } from "@playwright/test";

export async function libraryPaths(page: Page, includePrivate = false) {
  return page.evaluate(async (includePrivate) => {
    const root = await (
      await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("spaces")
    ).getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
    const paths: string[] = [];
    async function scan(directory: FileSystemDirectoryHandle, prefix: string) {
      for await (const [name, handle] of directory.entries()) {
        if (name === ".slate" && !includePrivate) continue;
        if (handle.kind === "directory")
          await scan(handle as FileSystemDirectoryHandle, prefix + name + "/");
        else paths.push(prefix + name);
      }
    }
    await scan(root, "");
    return paths.sort();
  }, includePrivate);
}

export async function libraryFile(
  page: Page,
  path: string,
  content?: string | number[],
) {
  return page.evaluate(
    async ({ path, content }) => {
      try {
        let directory = await (
          await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle("spaces")
        ).getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
        const parts = path.split("/"),
          name = parts.pop()!;
        for (const part of parts)
          directory = await directory.getDirectoryHandle(part, {
            create: content !== undefined,
          });
        const handle = await directory.getFileHandle(name, {
          create: content !== undefined,
        });
        if (content !== undefined) {
          const stream = await handle.createWritable();
          await stream.write(
            typeof content === "string" ? content : new Uint8Array(content),
          );
          await stream.close();
        }
        return Array.from(
          new Uint8Array(await (await handle.getFile()).arrayBuffer()),
        );
      } catch (error) {
        // A read-only poll reacquires a File changed after getFile().
        if (
          content === undefined &&
          error instanceof DOMException &&
          (error.name === "NotFoundError" || error.name === "NotReadableError")
        )
          return undefined;
        throw error;
      }
    },
    { path, content },
  );
}

/** Compare complete file bytes without transporting a large numeric array through Playwright. */
export async function libraryFileMatches(page: Page, path: string, expected: string): Promise<boolean> {
  return page.evaluate(async ({ path, expected }) => {
    try {
      let directory = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("spaces"))
        .getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
      const parts = path.split("/"), name = parts.pop()!;
      for (const part of parts) directory = await directory.getDirectoryHandle(part);
      const handle = await directory.getFileHandle(name);
      const actual = new Uint8Array(await (await handle.getFile()).arrayBuffer()), wanted = new TextEncoder().encode(expected);
      return actual.length === wanted.length && actual.every((byte, index) => byte === wanted[index]);
    } catch (error) {
      if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "NotReadableError")) return false;
      throw error;
    }
  }, { path, expected });
}
