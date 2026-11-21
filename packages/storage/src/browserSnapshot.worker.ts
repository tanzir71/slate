import { listDirectoryPaths, readDirectoryFile } from "./browserDirectoryReads";
import { readMarkdownSnapshot } from "./fileIO";
import type { DirectorySnapshotReply, DirectorySnapshotRequest } from "./browserSnapshotProtocol";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<DirectorySnapshotRequest>) => void) | null;
  postMessage(reply: DirectorySnapshotReply): void;
};

scope.onmessage = async ({ data: { id, root } }) => {
  try {
    const sheets = await readMarkdownSnapshot({ list: () => listDirectoryPaths(root), read: path => readDirectoryFile(root, path) });
    scope.postMessage({ id, kind: "snapshot", sheets });
  } catch (cause) {
    const error = cause as { name?: unknown; message?: unknown } | null;
    scope.postMessage({ id, kind: "error", name: typeof error?.name === "string" ? error.name : "Error",
      message: typeof error?.message === "string" ? error.message : String(cause) });
  }
};
