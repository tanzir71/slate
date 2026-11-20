import { useMemo, useState, type ComponentProps } from "react";
import Inspector from "./Inspector";
import { useInspectorMentions } from "./useInspectorMentions";
import { inspectorLinking } from "./inspectorLinking";
import type { WorkspaceStore } from "./workspaceStore";
import type { EditorDocumentPool } from "./editorDocumentPool";
import type { MentionInput } from "./inspectorMentionProtocol";
import { useNativeFileInfo } from "./useNativeFileInfo";
import type { WorkspaceFileActions } from "./workspaceRuntime";

export default function WorkspaceInspector({ store, pool, sheets, fileActions, ...props }: Omit<ComponentProps<typeof Inspector>, "mentions" | "nativeFile" | "outlineUnavailable"> & {
  store: WorkspaceStore; pool: EditorDocumentPool; sheets: readonly MentionInput[]; fileActions?: WorkspaceFileActions;
}) {
  const controller = useMemo(() => inspectorLinking(store, pool), [store, pool]);
  const { document } = props;
  const input = useMemo(() => ({ sheets, target: document ? { id: document.id, path: document.path, title: document.title, source: document.raw } : undefined }), [sheets, document]);
  const snapshot = useInspectorMentions(input);
  const selected = sheets.find(sheet => sheet.path === props.path);
  const visibleSnapshot = selected?.unsupportedEncoding ? { status: "unavailable" as const, error: "Mentions are unavailable for this file's encoding." }
    : props.path && (!document || document.raw !== selected?.content) ? { status: "pending" as const } : snapshot;
  const nativeFile = useNativeFileInfo(store, props.path, fileActions);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const titles = useMemo(() => new Map(props.documents.map(document => [document.path, document.title])), [props.documents]);
  async function perform(undo: boolean) {
    if (busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      if (undo) { await controller.undo(); setMessage("Linking undone."); }
      else if (snapshot.status === "ready") {
        const count = await controller.apply(snapshot.review, snapshot.rows);
        setMessage(`Linked ${count.toLocaleString()} ${count === 1 ? "mention" : "mentions"}.`);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Linking could not finish. Your words were kept."); }
    finally { setBusy(false); }
  }
  return <Inspector {...props} {...(nativeFile ? { nativeFile } : {})} {...(selected?.unsupportedEncoding ? { outlineUnavailable: "The outline is unavailable for this file's encoding." } : {})}
    mentions={{ snapshot: visibleSnapshot, busy, message, error, canUndo: controller.canUndo(),
    title: path => titles.get(path) ?? path, onLink: () => { void perform(false); }, onUndo: () => { void perform(true); } }} />;
}
