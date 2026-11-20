import { createInspectorMentionIndex } from "./inspectorMentionIndex";
import type { MentionRequest, MentionReply } from "./inspectorMentionProtocol";

const read = createInspectorMentionIndex();
self.onmessage = ({ data }: MessageEvent<MentionRequest>) => {
  let reply: MentionReply;
  try { reply = read(data); }
  catch (error) { reply = { id: data.id, reset: true, changed: [], removed: [], error: error instanceof Error ? error.message : "Mentions could not load." }; }
  self.postMessage(reply);
};
