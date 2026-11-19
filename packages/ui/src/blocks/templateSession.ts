import type {
  prepareInlineTemplate,
  renderMarkdownTemplate,
} from "@slate/core";

export interface InlineTemplateTarget {
  readonly element: HTMLElement;
  insert(rendered: ReturnType<typeof renderMarkdownTemplate>): boolean;
}
export type TemplateBlockRequest = ReturnType<typeof prepareInlineTemplate> & {
  readonly target: InlineTemplateTarget;
};
