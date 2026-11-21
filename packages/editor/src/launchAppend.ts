import { isolateHistory } from "@codemirror/commands";
import { appendLaunchText } from "@slate/core";
import type { DocumentSession } from "./documentSession.js";
import { editorSourceEffect } from "./tidy.js";

/** Use the file's retained history without creating or focusing an editor view. */
export function appendDocumentText(session: DocumentSession, expected: string, text: string, actor?: object): boolean {
  const snapshot = session.snapshot();
  if (!text || !session.canEdit() || snapshot.source !== expected) return false;
  const source = appendLaunchText(expected, text), addition = source.slice(expected.length).replace(/\r\n?/g, "\n");
  const from = snapshot.state.doc.length;
  return session.apply(snapshot.state.update({
    changes: { from, insert: addition }, selection: { anchor: from + addition.length },
    effects: editorSourceEffect(source), annotations: isolateHistory.of("full"), userEvent: "input.launch-append",
  }), snapshot.revision, actor);
}
