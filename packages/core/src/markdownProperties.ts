import { isMap, isScalar, parseDocument } from "yaml";
import { markdownFrontmatter } from "./markdownBody.js";

export interface MarkdownProperty {
  readonly key: string;
  readonly value: unknown;
  readonly keyFrom: number;
  readonly valueFrom: number;
}
export interface MarkdownProperties {
  readonly prefix: string;
  readonly closingFrom: number;
  readonly bodyFrom: number;
  readonly properties: readonly MarkdownProperty[];
}

/** Read a YAML mapping and its original UTF-16 offsets without serializing it. */
export function parseMarkdownProperties(source: string): MarkdownProperties | undefined {
  const range = markdownFrontmatter(source);
  if (!range) return;
  try {
    const document = parseDocument(source.slice(range.from, range.to), { keepSourceTokens: true, uniqueKeys: true });
    if (document.errors.length || document.warnings.length) return;
    const contents = document.contents;
    if (contents !== null && !isMap(contents)) return;
    // Aliases stay literal rather than expanding untrusted metadata graphs.
    const data: unknown = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
    const properties: MarkdownProperty[] = [];
    for (const item of contents?.items ?? []) {
      if (!isScalar(item.key) || typeof item.key.value !== "string" || !item.key.range || !(data instanceof Map)) return;
      properties.push({ key: item.key.value, value: data.get(item.key.value) as unknown,
        keyFrom: range.from + item.key.range[0], valueFrom: range.from + (item.value?.range?.[0] ?? item.key.range[1]) });
    }
    return { prefix: source.slice(0, range.bodyFrom), closingFrom: range.to, bodyFrom: range.bodyFrom, properties };
  } catch {
    // Invalid or unsupported metadata must remain available as editable source.
    return;
  }
}
