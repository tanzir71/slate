import type { Page } from "@playwright/test";

export async function libraryPaths(page: Page) {
  return page.evaluate(async () => {
    const root = await (
      await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("spaces")
    ).getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
    const paths: string[] = [];
    async function scan(directory: FileSystemDirectoryHandle, prefix: string) {
      for await (const [name, handle] of directory.entries()) {
        if (name === ".slate") continue;
        if (handle.kind === "directory")
          await scan(handle, prefix + name + "/");
        else paths.push(prefix + name);
      }
    }
    await scan(root, "");
    return paths.sort();
  });
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
        if (
          content === undefined &&
          error instanceof DOMException &&
          error.name === "NotFoundError"
        )
          return undefined;
        throw error;
      }
    },
    { path, content },
  );
}
