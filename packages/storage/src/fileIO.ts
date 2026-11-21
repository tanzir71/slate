export interface MarkdownFileSnapshot { path: string; content: string; unsupportedEncoding?: boolean }

/** Platform-neutral file access. Indexes and UI state never replace these bytes. */
export interface WorkspaceFileReader {
  list(includePrivate?: boolean): Promise<string[]>;
  /** Read an existing subtree without creating it; results remain Space-relative. */
  listDirectory?(path: string): Promise<string[]>;
  /** Fresh physical Markdown snapshots; adapters may read them off the caller thread. */
  snapshotMarkdown?(): Promise<MarkdownFileSnapshot[]>;
  read(path: string): Promise<Uint8Array | undefined>;
}

export interface MutableWorkspaceFiles extends WorkspaceFileReader {
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface CheckedWorkspaceFiles extends WorkspaceFileReader {
  readonly operations: {
    createNew(path: string, bytes: Uint8Array): Promise<boolean>;
    save(path: string, bytes: Uint8Array, base: Uint8Array | undefined): Promise<{ path: string; conflict: boolean }>;
    move(from: string, to: string, base: Uint8Array): Promise<void>;
    trash(path: string, base: Uint8Array): Promise<string>;
  };
}

export type WorkspaceFiles = MutableWorkspaceFiles | CheckedWorkspaceFiles;

export function safeWorkspacePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => !part || part === "." || part === ".." || part.includes(":") || [...part].some((character) => character.charCodeAt(0) < 32))) {
    throw new Error(`Invalid workspace path: ${path}`);
  }
  return normalized;
}

/** Adapters with directory handles can avoid enumerating unrelated notes. */
export async function listWorkspaceDirectory(files: WorkspaceFileReader, path: string): Promise<string[]> {
  const directory = safeWorkspacePath(path), prefix = `${directory}/`;
  const paths = await (files.listDirectory ? files.listDirectory(directory) : files.list(true));
  return paths.filter(entry => entry.startsWith(prefix));
}

export const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);
export const decodeText = (bytes: Uint8Array, preserveBOM = false): string => new TextDecoder("utf-8", { fatal: true, ignoreBOM: preserveBOM }).decode(bytes);

/** The same physical-text rules apply to local and worker-backed snapshots. */
export async function readMarkdownSnapshot(files: Pick<WorkspaceFileReader, "list" | "read">): Promise<MarkdownFileSnapshot[]> {
  const paths = (await files.list()).filter(path => /\.md$/i.test(path));
  const rows = await Promise.all(paths.map(async (path): Promise<MarkdownFileSnapshot | undefined> => {
    const bytes = await files.read(path);
    if (bytes === undefined) return undefined;
    try { return { path, content: decodeText(bytes, true) }; }
    catch { return { path, content: "", unsupportedEncoding: true }; }
  }));
  return rows.filter((row): row is MarkdownFileSnapshot => row !== undefined);
}
