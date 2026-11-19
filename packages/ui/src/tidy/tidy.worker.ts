import { runTidyRequest, type TidyWorkerRequest } from "./tidyWorkerProtocol";

self.onmessage = (event: MessageEvent<TidyWorkerRequest>) => {
  self.postMessage(runTidyRequest(event.data));
};
