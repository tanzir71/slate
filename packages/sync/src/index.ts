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

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const doc = new Y.Doc();
  return {
    status: options.slateSyncEnabled ? "ready" : "disabled",
    remoteKind: "stub",
    documentId: doc.guid
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort((left, right) =>
    left.localeCompare(right)
  );
}
