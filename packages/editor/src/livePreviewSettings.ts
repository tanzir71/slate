import { Facet } from "@codemirror/state";

export interface LivePreviewSettings {
  hideSyntax: boolean;
  highContrastMarkers: boolean;
  sourceMode?: boolean;
}
const defaults: LivePreviewSettings = { hideSyntax: true, highContrastMarkers: false };
export const livePreviewSettings = Facet.define<LivePreviewSettings, LivePreviewSettings>({ combine: values => values.at(-1) ?? defaults });
