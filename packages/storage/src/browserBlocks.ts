import {
  readCustomBlock,
  templateOutputPath,
  type CustomBlock,
} from "@slate/core";
import { safeBrowserPath } from "./browserFiles";
import { listWorkspaceDirectory } from "./fileIO";
import type { BrowserSpace, BrowserWriteResult } from "./browserSpace";

const directory = ".slate/blocks/";
export interface SpaceBlockFile {
  readonly path: string;
  readonly status:
    "missing" | "valid" | "invalid" | "unsupported" | "unavailable";
  readonly bytes?: Uint8Array;
  readonly source?: string;
  readonly block?: CustomBlock;
  readonly error?: string;
}
const isBlockPath = (path: string) =>
  path.startsWith(directory) && /\.md$/i.test(path);
function validatePath(path: string) {
  if (safeBrowserPath(path) !== path || !isBlockPath(path))
    throw new Error("Choose a Markdown file inside .slate/blocks/.");
}
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** Retain exact source/bytes, including a UTF-8 BOM, for an explicit later edit. */
export async function readSpaceBlock(
  space: BrowserSpace,
  path: string,
): Promise<SpaceBlockFile> {
  validatePath(path);
  let bytes: Uint8Array | undefined;
  try {
    bytes = await space.files.read(path);
  } catch (cause) {
    return { path, status: "unavailable", error: message(cause) };
  }
  if (bytes === undefined) return { path, status: "missing" };
  bytes = bytes.slice();
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return {
      path,
      bytes,
      status: "unsupported",
      error:
        "This custom block is not valid UTF-8. Its original bytes are preserved.",
    };
  }
  try {
    return {
      path,
      bytes,
      source,
      status: "valid",
      block: readCustomBlock(source, path),
    };
  } catch (cause) {
    return { path, bytes, source, status: "invalid", error: message(cause) };
  }
}

/** Listing errors stay errors; one unreadable block does not hide the other files. */
export async function readSpaceBlocks(
  space: BrowserSpace,
): Promise<SpaceBlockFile[]> {
  const paths = (await listWorkspaceDirectory(space.files, directory.slice(0, -1))).filter(isBlockPath).sort();
  const files = await Promise.all(
    paths.map((path) => readSpaceBlock(space, path)),
  );
  return files.filter((file) => file.status !== "missing");
}

/** Creating a block keeps an existing file, even when that file is empty. */
export async function createSpaceBlock(
  space: BrowserSpace,
  name: string,
  source: string,
): Promise<BrowserWriteResult> {
  const path = directory + templateOutputPath("", name);
  readCustomBlock(source, path);
  return { ...(await space.create(path, source)), conflict: false };
}

/** Updates join the Space's writer queue and preserve an externally changed primary file. */
export async function saveSpaceBlock(
  space: BrowserSpace,
  base: SpaceBlockFile,
  source: string,
): Promise<BrowserWriteResult> {
  validatePath(base.path);
  if (
    base.status === "unsupported" ||
    base.status === "unavailable" ||
    (base.status !== "missing" && base.bytes === undefined)
  )
    throw new Error("Read an editable custom-block file before saving it.");
  readCustomBlock(source, base.path);
  return space.saveSnapshot(base.path, source, base.bytes);
}
