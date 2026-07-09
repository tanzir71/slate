import type { RuntimeMarkdownFileSource } from "./runtimeSqliteAdapter";

export interface WebTextFile {
  text(): Promise<string>;
}

export interface WebFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<WebTextFile>;
}

export interface WebDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterable<readonly [string, WebFileHandle | WebDirectoryHandle]>;
  getDirectoryHandle(name: string): Promise<WebDirectoryHandle>;
  getFileHandle(name: string): Promise<WebFileHandle>;
}

export function createWebDirectoryMarkdownFileSource(root: WebDirectoryHandle): RuntimeMarkdownFileSource {
  return {
    async listMarkdownFiles() {
      const paths: string[] = [];
      await collectMarkdownFiles(root, "", paths);
      return paths.sort((left, right) => left.localeCompare(right));
    },

    async readMarkdownFile(path) {
      const parts = normalizeWorkspacePath(path);
      const fileName = parts[parts.length - 1];
      if (!fileName) {
        throw new Error(`Markdown path is empty: ${path}`);
      }

      let directory = root;
      for (const part of parts.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(part);
      }

      const fileHandle = await directory.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      return file.text();
    }
  };
}

async function collectMarkdownFiles(
  directory: WebDirectoryHandle,
  prefix: string,
  paths: string[]
): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    if (name === ".slate") {
      continue;
    }

    const path = joinWorkspacePath(prefix, name);
    if (handle.kind === "directory") {
      await collectMarkdownFiles(handle, path, paths);
    } else if (name.toLowerCase().endsWith(".md")) {
      paths.push(path);
    }
  }
}

function normalizeWorkspacePath(path: string): string[] {
  const parts = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");

  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new Error(`Markdown path escapes the selected directory: ${path}`);
  }

  return parts;
}

function joinWorkspacePath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}
