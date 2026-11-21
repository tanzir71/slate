import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { markdownBodyFrom } from "../markdownBody.js";
import { parseTidyAst, type TidyDocument } from "./source.js";
import { mathSourceRanges } from "./math.js";

type Projection =
  | null
  | boolean
  | number
  | string
  | Projection[]
  | { [key: string]: Projection };

function astProjection(value: unknown): Projection {
  if (Array.isArray(value)) return value.map(astProjection);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  if (typeof value !== "object")
    throw new Error("Unsupported Markdown node value.");
  const node = value as Record<string, unknown>;
  // Keep unknown own keys literal, including __proto__, without allocating
  // entry pairs and flatMap arrays for every field of every Markdown node.
  const projected: { [key: string]: Projection } = {};
  for (const key of Object.keys(node).sort()) {
    if (
      key === "position" ||
      ((node.type === "list" || node.type === "listItem") && key === "spread")
    ) continue;
    const content = node[key];
    if (content === undefined) continue;
    const value = node.type === "text" && key === "value" && typeof content === "string"
      ? content.replace(/\s+/gu, " ")
      : astProjection(content);
    if (key === "__proto__") Object.defineProperty(projected, key, { value, enumerable: true, configurable: true, writable: true });
    else projected[key] = value;
  }
  return projected;
}

function yamlProjection(value: unknown): Projection {
  if (value === null) return null;
  // Reordering aliases or repeated anchors can change which value an alias reads.
  // Keep such metadata literal rather than resolving or expanding it.
  if (isAlias(value)) throw new Error("Preserve YAML aliases literally.");
  if (!isScalar(value) && !isMap(value) && !isSeq(value))
    throw new Error("Unsupported YAML node.");
  if (value.anchor) throw new Error("Preserve YAML anchors literally.");
  const annotations = {
    comment: value.comment ?? null,
    commentBefore: value.commentBefore ?? null,
    tag: value.tag ?? null,
  };
  if (isScalar(value)) {
    const scalar: unknown = value.value;
    if (
      scalar !== null &&
      !["string", "boolean", "number", "bigint"].includes(typeof scalar)
    )
      throw new Error("Unsupported YAML scalar.");
    return {
      type: "scalar",
      valueType: scalar === null ? "null" : typeof scalar,
      // The formatter need not rewrite numeric spelling. Preserve it so rounded
      // JavaScript numbers cannot hide lost precision or a changed signed zero.
      numericSource:
        typeof scalar === "number" ? (value.source ?? String(scalar)) : null,
      value:
        typeof scalar === "number" || typeof scalar === "bigint"
          ? String(scalar)
          : (scalar as string | boolean | null),
      ...annotations,
    };
  }
  if (isSeq(value))
    return {
      type: "sequence",
      items: value.items.map(yamlProjection),
      ...annotations,
    };
  // Front matter is read as JavaScript properties. Non-string keys can collide
  // after coercion even when YAML considers them distinct (1 versus "1").
  if (
    value.items.some(
      ({ key }) => !isScalar(key) || typeof key.value !== "string",
    )
  )
    throw new Error("Preserve non-string YAML keys literally.");
  const items = value.items.map((pair) => [
    yamlProjection(pair.key),
    yamlProjection(pair.value),
  ]);
  items.sort((a, b) => {
    const left = JSON.stringify(a[0]),
      right = JSON.stringify(b[0]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { type: "mapping", items, ...annotations };
}

function metadataProjection(source: string, bodyFrom: number): Projection {
  const prefix = source.slice(0, bodyFrom).replace(/^\uFEFF/, "");
  if (!prefix) return null;
  const opening = /^---[ \t]*(?:\r\n|\n|\r|$)/.exec(prefix);
  if (!opening) throw new Error("Unexpected Markdown prefix.");
  const remainder = prefix.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/m.exec(remainder);
  if (!closing || closing.index + closing[0].length !== remainder.length)
    return { protected: prefix };
  const raw = remainder.slice(0, closing.index);
  try {
    const document = parseDocument(raw.replace(/\r\n?|\n/g, "\n"));
    if (document.errors.length || document.warnings.length)
      return { protected: prefix };
    return {
      yaml: yamlProjection(document.contents),
      comment: document.comment,
      commentBefore: document.commentBefore,
      version: document.directives.yaml.version,
      tags: astProjection(document.directives.tags),
    };
  } catch {
    // Invalid, unsupported or anchor-bearing metadata remains byte-for-byte data.
    return { protected: prefix };
  }
}

/** Compare meaning and literal data, allowing only the plan's presentation differences. */
export function projectTidyDocument(document: Pick<TidyDocument, "source" | "bodyFrom" | "body" | "root"> & Partial<Pick<TidyDocument, "mathRanges">>): string {
  const { source, bodyFrom, body, root } = document;
  const math = document.mathRanges ?? mathSourceRanges(document);
  return JSON.stringify({
    bom: source.startsWith("\uFEFF"),
    metadata: metadataProjection(source, bodyFrom),
    // Standard mdast treats wiki paths as text, but whitespace changes can select
    // a different Slate file. Preserve complete links/embeds, including aliases.
    wiki: Array.from(
      body.matchAll(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g),
      (match) => match[0],
    ),
    math: math.length ? math.map(range => source.slice(range.from, range.to)) : undefined,
    markdown: astProjection(root),
  });
}

export function contentProjection(source: string): string {
  const bodyFrom = markdownBodyFrom(source),
    body = source.slice(bodyFrom);
  return projectTidyDocument({
    source,
    bodyFrom,
    body,
    root: parseTidyAst(body),
  });
}

export function preservesContent(before: string, after: string): boolean {
  if (before === after) return true;
  try {
    return contentProjection(before) === contentProjection(after);
  } catch {
    return false;
  }
}
