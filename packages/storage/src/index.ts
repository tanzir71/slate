import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { parseSheet, type SheetDocument } from "@slate/core";

export interface SpaceMetadata {
  id?: string;
  name: string;
  color?: string;
  icon?: string;
}

export interface SheetIndexEntry {
  id: string;
  path: string;
  title: string;
  tags: string[];
  links: string[];
  words: number;
  updatedAt: string | undefined;
}

export interface WriteSheetOptions {
  baseContent?: string;
  now?: Date;
}

export interface WriteSheetResult {
  status: "written" | "conflict-copy";
  path: string;
}

export interface LocalStorageAdapter {
  ensureSpace(metadata: SpaceMetadata): Promise<SpaceMetadata & { id: string }>;
  rebuildIndex(): Promise<SheetIndexEntry[]>;
  readIndex(): Promise<SheetIndexEntry[]>;
  writeSheet(path: string, content: string, options?: WriteSheetOptions): Promise<WriteSheetResult>;
  moveSheet(fromPath: string, toPath: string): Promise<void>;
  deleteSheet(path: string): Promise<void>;
}

const slateDir = ".slate";
const indexFile = "index.sqlite";

export function createLocalStorageAdapter(root: string): LocalStorageAdapter {
  const absoluteRoot = resolve(root);

  return {
    async ensureSpace(metadata) {
      const complete: SpaceMetadata & { id: string } = {
        id: metadata.id ?? stableSpaceId(absoluteRoot),
        name: metadata.name
      };
      if (metadata.color !== undefined) {
        complete.color = metadata.color;
      }
      if (metadata.icon !== undefined) {
        complete.icon = metadata.icon;
      }
      await mkdir(join(absoluteRoot, slateDir), { recursive: true });
      await writeFile(join(absoluteRoot, slateDir, "space.json"), JSON.stringify(complete, null, 2));
      return complete;
    },

    async rebuildIndex() {
      await mkdir(join(absoluteRoot, slateDir), { recursive: true });
      const markdownFiles = await listMarkdownFiles(absoluteRoot);
      const entries = await Promise.all(
        markdownFiles.map(async (absolutePath) => {
          const relativePath = toWorkspacePath(relative(absoluteRoot, absolutePath));
          const raw = await readFile(absolutePath, "utf8");
          return sheetToIndexEntry(parseSheet(raw, relativePath));
        })
      );
      const sorted = entries.sort((left, right) => left.path.localeCompare(right.path));
      await writeFile(join(absoluteRoot, slateDir, indexFile), JSON.stringify(sorted, null, 2));
      return sorted;
    },

    async readIndex() {
      const raw = await readFile(join(absoluteRoot, slateDir, indexFile), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.flatMap(readIndexEntry) : [];
    },

    async writeSheet(path, content, options = {}) {
      const target = safeJoin(absoluteRoot, path);
      await mkdir(dirname(target), { recursive: true });

      if (options.baseContent !== undefined) {
        const current = await readExisting(target);
        if (current !== undefined && current !== options.baseContent) {
          const conflict = conflictCopyPath(target, options.now ?? new Date());
          await writeFile(conflict, content);
          return {
            status: "conflict-copy",
            path: toWorkspacePath(relative(absoluteRoot, conflict))
          };
        }
      }

      await writeFile(target, content);
      return { status: "written", path: toWorkspacePath(relative(absoluteRoot, target)) };
    },

    async moveSheet(fromPath, toPath) {
      const from = safeJoin(absoluteRoot, fromPath);
      const to = safeJoin(absoluteRoot, toPath);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    },

    async deleteSheet(path) {
      await rm(safeJoin(absoluteRoot, path), { force: true });
    }
  };
}

export function createConflictCopyName(filename: string, now: Date): string {
  const extension = extname(filename);
  const basename = extension ? filename.slice(0, -extension.length) : filename;
  const stamp = now.toISOString().slice(0, 19).replace("T", " ").replaceAll(":", "-");
  return `${basename} (conflicted copy ${stamp})${extension}`;
}

function sheetToIndexEntry(sheet: SheetDocument): SheetIndexEntry {
  return {
    id: sheet.id,
    path: sheet.path,
    title: sheet.title,
    tags: sheet.tags.map((tag) => tag.path),
    links: sheet.links.map((link) => link.target),
    words: sheet.stats.words,
    updatedAt: sheet.updatedAt?.toISOString()
  };
}

function readIndexEntry(value: unknown): SheetIndexEntry[] {
  if (!isRecord(value)) {
    return [];
  }

  const id = readString(value.id);
  const path = readString(value.path);
  const title = readString(value.title);
  const tags = readStringArray(value.tags);
  const links = readStringArray(value.links);
  const words = typeof value.words === "number" ? value.words : undefined;

  if (!id || !path || !title || words === undefined) {
    return [];
  }

  return [
    {
      id,
      path,
      title,
      tags,
      links,
      words,
      updatedAt: readString(value.updatedAt)
    }
  ];
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === slateDir) {
      continue;
    }

    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolute)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolute);
    }
  }

  return files;
}

async function readExisting(path: string): Promise<string | undefined> {
  try {
    await stat(path);
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function conflictCopyPath(path: string, now: Date): string {
  return join(dirname(path), createConflictCopyName(path.slice(dirname(path).length + 1), now));
}

function safeJoin(root: string, path: string): string {
  const target = resolve(root, path);
  const normalizedRoot = root.endsWith("\\") || root.endsWith("/") ? root : `${root}\\`;
  if (target !== root && !target.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes Slate space root: ${path}`);
  }
  return target;
}

function toWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function stableSpaceId(root: string): string {
  let hash = 5381;
  for (const char of root) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return `space_${(hash >>> 0).toString(36)}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === "string" ? [item] : [])) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
