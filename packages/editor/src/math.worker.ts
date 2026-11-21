import { renderMath } from "./mathRender.js";
import type { RichRenderRequest } from "./richPreviewProtocol.js";

self.onmessage = ({ data }: MessageEvent<RichRenderRequest>) => { self.postMessage(renderMath(data)); };
