import { createSheetSummaryCache } from "./sheetSummaries";
import {
  summaryMetadata,
  type SummaryRequest,
  type SummaryReply,
} from "./sheetSummaryProtocol";

const summarize = createSheetSummaryCache();
self.onmessage = (event: MessageEvent<SummaryRequest>) => {
  const reply: SummaryReply = {
    id: event.data.id,
    summaries: summaryMetadata(summarize(event.data.sheets)),
  };
  self.postMessage(reply);
};
