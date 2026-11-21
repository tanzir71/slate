import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { TextChange } from "./textChanges.js";
import { markdownBoundary as boundary } from "./markdownBoundary.js";

interface BlockDefinition {
  id: string;
  label: string;
  description: string;
  aliases: readonly string[];
  group: "Blocks" | "Insert";
  placement: "block" | "inline" | "start";
}

export const builtinBlocks = [
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section heading",
    aliases: ["h1", "title"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Section heading",
    aliases: ["h2"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading",
    aliases: ["h3"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "bullet",
    label: "Bulleted list",
    description: "Unordered list",
    aliases: ["ul", "bullet", "list"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "ordered",
    label: "Numbered list",
    description: "Ordered list",
    aliases: ["ol", "number"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "task",
    label: "Task list",
    description: "Checklist · - [ ]",
    aliases: ["todo", "[]", "checklist"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "quote",
    label: "Quote",
    description: "Blockquote",
    aliases: ["quote", ">"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "callout.note",
    label: "Note callout",
    description: "A note with a title",
    aliases: ["note", "callout"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "callout.tip",
    label: "Tip callout",
    description: "A helpful tip",
    aliases: ["tip", "callout"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "callout.warning",
    label: "Warning callout",
    description: "A warning",
    aliases: ["warning", "callout"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "callout.important",
    label: "Important callout",
    description: "Important information",
    aliases: ["important", "callout"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "callout.caution",
    label: "Caution callout",
    description: "Something to take care with",
    aliases: ["caution", "callout"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal rule",
    aliases: ["hr", "rule"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "table",
    label: "Table",
    description: "Grid with a header row",
    aliases: ["ta", "table", "grid", "| |"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "codeblock",
    label: "Code block",
    description: "Fenced code with a language",
    aliases: ["code", "fence"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "math",
    label: "Math block",
    description: "Display math",
    aliases: ["math", "latex"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    description: "A flowchart starter",
    aliases: ["diagram", "flow"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "image",
    label: "Image",
    description: "Choose a local image",
    aliases: ["img", "picture"],
    group: "Insert",
    placement: "inline",
  },
  {
    id: "wiki",
    label: "Link to sheet",
    description: "Link to a sheet in this Space",
    aliases: ["link", "wiki"],
    group: "Insert",
    placement: "inline",
  },
  {
    id: "embed",
    label: "Embed sheet",
    description: "Embed a sheet or heading",
    aliases: ["embed", "transclusion"],
    group: "Insert",
    placement: "inline",
  },
  {
    id: "toc",
    label: "Table of contents",
    description: "Links from the current headings",
    aliases: ["toc", "contents"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "footnote",
    label: "Footnote",
    description: "A reference and its definition",
    aliases: ["fn", "footnote"],
    group: "Insert",
    placement: "inline",
  },
  {
    id: "frontmatter",
    label: "Front-matter",
    description: "Properties at the start of the sheet",
    aliases: ["properties", "yaml"],
    group: "Blocks",
    placement: "start",
  },
  {
    id: "date",
    label: "Date",
    description: "ISO date",
    aliases: ["date", "today"],
    group: "Insert",
    placement: "inline",
  },
  {
    id: "time",
    label: "Time",
    description: "ISO time",
    aliases: ["time", "now"],
    group: "Insert",
    placement: "inline",
  },
  {
    id: "details",
    label: "Details",
    description: "A collapsible section",
    aliases: ["details", "toggle"],
    group: "Blocks",
    placement: "block",
  },
  {
    id: "comment",
    label: "Comment",
    description: "A Markdown comment",
    aliases: ["comment", "annotation"],
    group: "Insert",
    placement: "inline",
  },
  {
    id: "tag",
    label: "Tag",
    description: "#tag with autocomplete",
    aliases: ["tag", "#"],
    group: "Insert",
    placement: "inline",
  },
] as const satisfies readonly BlockDefinition[];

export type BuiltinBlockId = (typeof builtinBlocks)[number]["id"];
export interface BlockContext {
  source: string;
  from: number;
  to: number;
  /** Gutter insertion creates its own block, including inline catalog entries. */
  separateBlock?: boolean;
  language?: string;
  image?: { path: string; alt?: string };
  date?: string;
  time?: string;
}
export type BlockPlan =
  | {
      kind: "insert";
      changes: TextChange[];
      selection: { anchor: number; head: number };
      followUp?: "wiki" | "tag";
    }
  | { kind: "request"; input: "image" | "language" | "date" | "time" }
  | { kind: "unavailable"; reason: string };
interface Recipe {
  text: string;
  anchor: number;
  head: number;
  joinsSuffix?: boolean;
  append?: string;
  followUp?: "wiki" | "tag";
}
const caret = (text: string, anchor = text.length): Recipe => ({
  text,
  anchor,
  head: anchor,
});
const selected = (text: string, label: string): Recipe => ({
  text,
  anchor: text.indexOf(label),
  head: text.indexOf(label) + label.length,
});

/** Produces one editor transaction; the caller performs resource picking and IO. */
export function planBuiltinBlock(id: string, context: BlockContext): BlockPlan {
  validateRange(context);
  const block = builtinBlocks.find((entry) => entry.id === id);
  if (!block) return { kind: "unavailable", reason: "Unknown block." };
  if (
    block.placement === "start" &&
    context.from !== (context.source.startsWith("\uFEFF") ? 1 : 0)
  )
    return {
      kind: "unavailable",
      reason: "Front-matter belongs at the start of the sheet.",
    };
  const recipe = blockRecipe(block.id, context);
  if ("kind" in recipe) return recipe;
  const eol = context.source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const text = recipe.text.replace(/\n/g, eol);
  const prefix = context.source.slice(0, context.from);
  const suffix = context.source.slice(context.to);
  const separate = context.separateBlock && block.placement !== "start";
  const before =
    block.placement === "block" || separate ? boundary(prefix, text, eol) : "";
  const after =
    (block.placement !== "inline" && !recipe.joinsSuffix) || separate
      ? boundary(text, suffix, eol)
      : "";
  const insert = `${before}${text}${after}`;
  const offset = context.from + before.length;
  const changes: TextChange[] = [
    { from: context.from, to: context.to, text: insert },
  ];
  const position = (value: number) =>
    offset + recipe.text.slice(0, value).replace(/\n/g, eol).length;
  let selection = {
    anchor: position(recipe.anchor),
    head: position(recipe.head),
  };
  if (recipe.append !== undefined) {
    const tail = suffix || insert;
    const append =
      boundary(tail, recipe.append, eol) + recipe.append.replace(/\n/g, eol);
    changes.push({
      from: context.source.length,
      to: context.source.length,
      text: append,
    });
    const end =
      context.source.length -
      (context.to - context.from) +
      insert.length +
      append.length;
    selection = { anchor: end, head: end };
  }
  return {
    kind: "insert",
    changes,
    selection,
    ...(recipe.followUp ? { followUp: recipe.followUp } : {}),
  };
}

function blockRecipe(
  id: BuiltinBlockId,
  context: BlockContext,
): Recipe | Exclude<BlockPlan, { kind: "insert" }> {
  if (id.startsWith("heading"))
    return { ...caret(`${"#".repeat(Number(id.at(-1)))} `), joinsSuffix: true };
  if (id.startsWith("callout."))
    return {
      ...selected(`> [!${id.slice(8).toUpperCase()}] Title\n> `, "Title"),
      joinsSuffix: true,
    };
  switch (id) {
    case "bullet":
      return { ...caret("- "), joinsSuffix: true };
    case "ordered":
      return { ...caret("1. "), joinsSuffix: true };
    case "task":
      return { ...caret("- [ ] "), joinsSuffix: true };
    case "quote":
      return { ...caret("> "), joinsSuffix: true };
    case "divider":
      return caret("---\n\n");
    case "table":
      return selected(
        "| Column | Column | Column |\n| ------ | ------ | ------ |\n|        |        |        |\n|        |        |        |",
        "Column",
      );
    case "codeblock":
      if (context.language === undefined)
        return { kind: "request", input: "language" };
      if (!/^[\w+#.-]{0,48}$/.test(context.language))
        return { kind: "unavailable", reason: "Choose a valid code language." };
      return caret(
        `\`\`\`${context.language}\n\n\`\`\``,
        4 + context.language.length,
      );
    case "math":
      return caret("$$\n\n$$", 3);
    case "mermaid":
      return selected(
        "```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```",
        "Start",
      );
    case "image":
      return imageRecipe(context.image);
    case "wiki":
      return { ...caret("[["), followUp: "wiki" };
    case "embed":
      return selected("![[Sheet#Heading]]", "Sheet#Heading");
    case "toc":
      return caret(
        `<!-- toc -->\n${tableOfContents(context.source.slice(0, context.from) + context.source.slice(context.to))}\n<!-- /toc -->`,
        13,
      );
    case "footnote": {
      const used = new Set(
        [...context.source.matchAll(/\[\^(\d+)\]/g)].map((match) => match[1]),
      );
      let number = 1;
      while (used.has(String(number))) number++;
      return { ...caret(`[^${number}]`), append: `[^${number}]: ` };
    }
    case "frontmatter":
      if (
        /^\uFEFF?---(?:\r\n|\n|\r)/.test(
          context.source.slice(0, context.from) +
            context.source.slice(context.to),
        )
      )
        return {
          kind: "unavailable",
          reason: "This sheet already has front-matter.",
        };
      return caret("---\ntitle: \n---\n", 11);
    case "date":
      if (context.date === undefined) return { kind: "request", input: "date" };
      return validDate(context.date)
        ? caret(context.date)
        : { kind: "unavailable", reason: "Choose a valid ISO date." };
    case "time":
      if (context.time === undefined) return { kind: "request", input: "time" };
      return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(context.time)
        ? caret(context.time)
        : { kind: "unavailable", reason: "Choose a valid ISO time." };
    case "details":
      return selected(
        "<details>\n<summary>Details</summary>\n\n\n</details>",
        "Details",
      );
    case "comment":
      return selected("<!-- Comment -->", "Comment");
    case "tag":
      return { ...caret("#"), followUp: "tag" };
    default:
      throw new Error(`Block recipe is missing: ${id}`);
  }
}

function imageRecipe(
  image: BlockContext["image"],
): Recipe | Exclude<BlockPlan, { kind: "insert" }> {
  if (!image) return { kind: "request", input: "image" };
  const path = image.path.replace(/^\.\//, "");
  const parts = path.split("/");
  if (
    !path.startsWith("assets/") ||
    parts.some((part) => !part || part === "." || part === "..") ||
    Array.from(path).some(
      (character) =>
        character === "\\" ||
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127,
    )
  )
    return { kind: "unavailable", reason: "Choose a local image asset." };
  const uri = parts
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  const alt = image.alt ?? "Image";
  if (/[\r\n]/.test(alt))
    return {
      kind: "unavailable",
      reason: "Image descriptions must fit on one line.",
    };
  const label = alt.replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&");
  return { text: `![${label}](${uri})`, anchor: 2, head: 2 + label.length };
}

function validateRange({ source, from, to }: BlockContext) {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length
  )
    throw new RangeError("Invalid block insertion range.");
}
function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
  );
}

export interface MarkdownPreviewNode {
  position?: { start: { offset?: number; line?: number }; end: { offset?: number; line?: number } };
  type: string;
  depth?: number;
  value?: string;
  alt?: string;
  url?: string;
  ordered?: boolean;
  checked?: boolean | null;
  children?: MarkdownPreviewNode[];
}
/** Syntax data only; renderers must escape text and decide which URLs to allow. */
export function parseMarkdownPreview(source: string): MarkdownPreviewNode {
  return (source.includes("$$") ? mathPreviewParser : markdownPreviewParser).parse(source) as MarkdownPreviewNode;
}
function createMarkdownPreviewParser() {
  return unified().use(remarkParse).use(remarkGfm).freeze();
}
const markdownPreviewParser = /* @__PURE__ */ createMarkdownPreviewParser();
const mathPreviewParser = /* @__PURE__ */ unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false }).freeze();
export function markdownNodeText(node: MarkdownPreviewNode): string {
  if (node.type === "html") return "";
  return node.value ?? node.alt ?? (node.children ?? []).map(markdownNodeText).join("");
}
/** Shared heading links for inserted TOCs; code and front-matter are excluded. */
export function tableOfContents(source: string): string {
  const markdown = source
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF?---\n[\s\S]*?\n---(?:\n|$)/, "");
  const root = parseMarkdownPreview(markdown);
  const headings: { depth: number; text: string }[] = [];
  function visit(node: MarkdownPreviewNode) {
    if (node.type === "heading") {
      const text = markdownNodeText(node).replace(/\s+/g, " ").trim();
      if (text) headings.push({ depth: node.depth!, text });
    } else node.children?.forEach(visit);
  }
  visit(root);
  const minimum = headings.reduce(
    (depth, heading) => Math.min(depth, heading.depth),
    Infinity,
  );
  const used = new Set<string>();
  return headings
    .map(({ depth, text }) => {
      const base =
        text
          .toLowerCase()
          .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, "")
          .trim()
          .replace(/\s+/g, "-") || "section";
      let slug = base;
      let suffix = 1;
      while (used.has(slug)) slug = `${base}-${suffix++}`;
      used.add(slug);
      return `${"  ".repeat(depth - minimum)}- [${text.replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&")}](#${slug})`;
    })
    .join("\n");
}
