import { useCallback, useMemo, type ComponentProps } from "react";
import { createDocumentSession } from "@slate/editor";
import { MarkdownEditor } from "../MarkdownEditor";
import type { WorkspaceStore } from "./workspaceStore";
import type { EditorDocumentPool } from "./editorDocumentPool";
import { importBlockImage } from "./importBlockImage";
import { importClipboardImage } from "./importClipboardImage";

type Props = Omit<ComponentProps<typeof MarkdownEditor>, "value" | "onChange" | "documentSession" | "blockNote" | "onImportImage" | "onImportClipboardImage"> & {
  pool: EditorDocumentPool;
  store: WorkspaceStore;
  path: string;
  title: string;
};
/** The editor/session runtime stays behind the workspace's lazy boundary. */
export default function WorkspaceDocumentEditor({ pool, store, path, title, ...props }: Props) {
  const session = pool.get(path, createDocumentSession), name = store.api.getState().record.name;
  const blockNote = useMemo(() => ({ space: name, path, title }), [name, path, title]);
  const image = useCallback((file: File) => importBlockImage(store.space, file, path), [store, path]);
  const clipboard = useCallback((file: File) => importClipboardImage(store.space, file, path), [store, path]);
  return session ? <MarkdownEditor {...props} documentSession={session} blockNote={blockNote} onImportImage={image} onImportClipboardImage={clipboard} />
    : <p role="status">This sheet is unavailable. Choose another tab or refresh your Space.</p>;
}
