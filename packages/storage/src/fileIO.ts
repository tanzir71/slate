/** Platform-neutral file access. Indexes and UI state never replace these bytes. */
export interface WorkspaceFileReader {
  list(includePrivate?: boolean): Promise<string[]>;
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

export const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);
export const decodeText = (bytes: Uint8Array, preserveBOM = false): string => new TextDecoder("utf-8", { fatal: true, ignoreBOM: preserveBOM }).decode(bytes);
