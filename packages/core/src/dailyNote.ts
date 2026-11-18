import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { markdownBodyFrom } from "./markdownBody.js";

function createDailyParser() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStringify, { bullet: "-", listItemIndent: "one" })
    .freeze();
}
const markdown = /* @__PURE__ */ createDailyParser();
type Root = ReturnType<typeof markdown.parse>;
type Block = Root["children"][number];
type List = Extract<Block, { type: "list" }>;
type Quote = Extract<Block, { type: "blockquote" }>;

function pendingContainer(
  node: List | Quote,
  retainContext = false,
): List | Quote | undefined {
  if (node.type === "blockquote") {
    let hasPendingChild = false;
    const children = node.children.flatMap<Quote["children"][number]>(
      (child) => {
        if (child.type !== "list" && child.type !== "blockquote")
          return [child];
        const kept = pendingContainer(child, retainContext);
        if (kept) hasPendingChild = true;
        return kept ? [kept] : [];
      },
    );
    return retainContext || hasPendingChild ? { ...node, children } : undefined;
  }
  const children = node.children.flatMap((item) => {
    let hasPendingChild = false;
    const keep =
      item.checked === false || (retainContext && item.checked !== true);
    const content = item.children.flatMap<
      List["children"][number]["children"][number]
    >((child) => {
      if (child.type !== "list" && child.type !== "blockquote") return [child];
      const kept = pendingContainer(child, keep);
      if (kept) hasPendingChild = true;
      return kept ? [kept] : [];
    });
    if (!keep && !hasPendingChild) return [];
    // Finished/non-task ancestors remain plain context for their pending descendants.
    return [
      {
        ...item,
        checked: item.checked === false ? false : null,
        children: content,
      },
    ];
  });
  return children.length ? { ...node, children } : undefined;
}

/** Copy genuine GFM tasks, never checkbox-like text in metadata, code or HTML. */
export function carryOverTasks(source: string): string {
  const root = markdown.parse(source.slice(markdownBodyFrom(source)));
  const tasks = root.children.flatMap((node) => {
    if (node.type !== "list" && node.type !== "blockquote") return [];
    const kept = pendingContainer(node);
    return kept ? [kept] : [];
  });
  if (!tasks.length) return "";
  // Definitions remain available to links/images/footnotes in the copied tasks.
  const definitions = root.children.filter(
    (node) => node.type === "definition" || node.type === "footnoteDefinition",
  );
  return markdown.stringify({ ...root, children: [...tasks, ...definitions] });
}
