import type { renderSnippetTemplate } from "@slate/core";

/** The view and source snapshot stay private to the editor's insertion closure. */
export interface SnippetTarget {
  readonly selection: string;
  readonly source: string;
  readonly element: HTMLElement;
  insert(expansion: ReturnType<typeof renderSnippetTemplate>): boolean;
}
