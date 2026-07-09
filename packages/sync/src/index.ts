import * as Y from "yjs";

export interface OfflineMergeInput {
  base: string;
  left: string;
  right: string;
}

export interface OfflineMergeResult {
  merged: string;
  lostData: boolean;
  conflicted: boolean;
}

export interface ByoFolderReconcileInput {
  path: string;
  baseContent: string | undefined;
  localContent: string | undefined;
  externalContent: string | undefined;
  now?: Date;
}

export type ByoFolderReconcileAction =
  | {
      type: "noop";
      path: string;
    }
  | {
      type: "accept-external";
      path: string;
      content: string;
    }
  | {
      type: "accept-external-delete";
      path: string;
    }
  | {
      type: "write-local";
      path: string;
      content: string;
    }
  | {
      type: "delete-external";
      path: string;
    }
  | {
      type: "write-merged";
      path: string;
      content: string;
      lostData: false;
    }
  | {
      type: "write-conflict-copy";
      path: string;
      conflictPath: string;
      content: string;
      externalContent: string;
      mergedContent: string;
      lostData: false;
    };

export interface SyncEngineOptions {
  slateSyncEnabled: boolean;
}

export interface SyncEngine {
  status: "disabled" | "ready";
  remoteKind: "stub";
  documentId: string;
}

export function mergeOfflineEdits(input: OfflineMergeInput): OfflineMergeResult {
  const { base, left, right } = input;

  if (left === right) {
    return { merged: left, lostData: false, conflicted: false };
  }

  if (left === base) {
    return { merged: right, lostData: false, conflicted: false };
  }

  if (right === base) {
    return { merged: left, lostData: false, conflicted: false };
  }

  if (left.startsWith(base) && right.startsWith(base)) {
    const additions = uniqueSorted([left.slice(base.length), right.slice(base.length)]);
    return {
      merged: `${base}${additions.join("")}`,
      lostData: false,
      conflicted: false
    };
  }

  const variants = uniqueSorted([left, right]);
  return {
    merged: `${base.trimEnd()}\n\n<<<<<<< slate-client-a\n${variants[0]?.trimEnd() ?? ""}\n=======\n${
      variants[1]?.trimEnd() ?? ""
    }\n>>>>>>> slate-client-b\n`,
    lostData: false,
    conflicted: true
  };
}

export function reconcileByoFolderFile(input: ByoFolderReconcileInput): ByoFolderReconcileAction {
  const { path, baseContent, localContent, externalContent } = input;

  if (localContent === externalContent) {
    return { type: "noop", path };
  }

  if (baseContent === undefined) {
    if (localContent === undefined && externalContent !== undefined) {
      return { type: "accept-external", path, content: externalContent };
    }

    if (localContent !== undefined && externalContent === undefined) {
      return { type: "write-local", path, content: localContent };
    }

    return createByoConflictCopyAction(input, localContent ?? "", externalContent ?? "");
  }

  if (localContent === baseContent) {
    if (externalContent === undefined) {
      return { type: "accept-external-delete", path };
    }

    return { type: "accept-external", path, content: externalContent };
  }

  if (externalContent === baseContent) {
    if (localContent === undefined) {
      return { type: "delete-external", path };
    }

    return { type: "write-local", path, content: localContent };
  }

  if (localContent !== undefined && externalContent !== undefined) {
    const merge = mergeOfflineEdits({ base: baseContent, left: localContent, right: externalContent });
    if (!merge.conflicted) {
      return {
        type: "write-merged",
        path,
        content: merge.merged,
        lostData: false
      };
    }

    return createByoConflictCopyAction(input, localContent, externalContent, merge.merged);
  }

  if (localContent === undefined && externalContent !== undefined) {
    return { type: "accept-external", path, content: externalContent };
  }

  return { type: "write-local", path, content: localContent ?? "" };
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const doc = new Y.Doc();
  return {
    status: options.slateSyncEnabled ? "ready" : "disabled",
    remoteKind: "stub",
    documentId: doc.guid
  };
}

export function createByoConflictPath(path: string, now: Date): string {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const directory = slash >= 0 ? `${normalized.slice(0, slash)}/` : "";
  const filename = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = filename.lastIndexOf(".");
  const hasExtension = dot > 0;
  const basename = hasExtension ? filename.slice(0, dot) : filename;
  const extension = hasExtension ? filename.slice(dot) : "";
  const stamp = now.toISOString().slice(0, 19).replace("T", " ").replaceAll(":", "-");

  return `${directory}${basename} (conflicted copy ${stamp})${extension}`;
}

function createByoConflictCopyAction(
  input: ByoFolderReconcileInput,
  localContent: string,
  externalContent: string,
  mergedContent = mergeOfflineEdits({
    base: input.baseContent ?? "",
    left: localContent,
    right: externalContent
  }).merged
): ByoFolderReconcileAction {
  return {
    type: "write-conflict-copy",
    path: input.path,
    conflictPath: createByoConflictPath(input.path, input.now ?? new Date()),
    content: localContent,
    externalContent,
    mergedContent,
    lostData: false
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort((left, right) =>
    left.localeCompare(right)
  );
}
