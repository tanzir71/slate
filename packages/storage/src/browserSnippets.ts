import {
  readSnippetConfiguration,
  type SnippetConfiguration,
} from "@slate/core";
import { decodeText } from "./browserFiles";
import { type BrowserSpace, type BrowserWriteResult } from "./browserSpace";

export const spaceSnippetPath = ".slate/snippets.json";
export const globalSnippetPath = "global/snippets.json";
type SnippetPath = typeof spaceSnippetPath | typeof globalSnippetPath;
export interface SnippetFile {
  readonly path: SnippetPath;
  readonly status:
    "missing" | "valid" | "invalid" | "unsupported" | "unavailable";
  readonly source?: string;
  readonly configuration?: SnippetConfiguration;
  readonly bytes?: Uint8Array;
  readonly error?: string;
}
type WriteLock = (
  action: () => Promise<BrowserWriteResult>,
) => Promise<BrowserWriteResult>;
const sourceLimit = 8 * 1_048_576;
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
function parseConfiguration(source: string) {
  if (source.length > sourceLimit)
    throw new Error("Keep snippet configuration within 8 MiB of JSON text.");
  return readSnippetConfiguration(JSON.parse(source));
}

/** Reads are inert; only an explicit valid save may create a configuration file. */
export function createSnippetFileStore(
  space: BrowserSpace,
  path: SnippetPath = spaceSnippetPath,
  lock?: WriteLock,
) {
  if (path !== spaceSnippetPath && path !== globalSnippetPath)
    throw new Error("Invalid snippet configuration path.");
  if (path === globalSnippetPath && !lock)
    throw new Error("Global snippet writes need a shared lock.");
  return {
    async read(): Promise<SnippetFile> {
      let bytes: Uint8Array | undefined;
      try {
        bytes = await space.files.read(path);
      } catch (cause) {
        return { path, status: "unavailable", error: message(cause) };
      }
      if (bytes === undefined) return { path, status: "missing" };
      let source: string;
      try {
        source = decodeText(bytes);
      } catch {
        return {
          path,
          bytes,
          status: "unsupported",
          error:
            "This snippet file is not valid UTF-8. Its original bytes are preserved.",
        };
      }
      try {
        return {
          path,
          bytes,
          source,
          status: "valid",
          configuration: parseConfiguration(source),
        };
      } catch (cause) {
        return {
          path,
          bytes,
          source,
          status: "invalid",
          error: message(cause),
        };
      }
    },
    async save(
      snapshot: SnippetFile,
      source: string,
    ): Promise<BrowserWriteResult> {
      if (
        snapshot.path !== path ||
        snapshot.status === "unsupported" ||
        snapshot.status === "unavailable"
      )
        throw new Error("Read an editable snippet file before saving it.");
      parseConfiguration(source);
      // Keep the user's exact JSON, including unknown metadata and whitespace.
      const write = () => space.save(path, source, snapshot.source);
      return lock ? lock(write) : write();
    },
  };
}
