import type { MarkdownConfig } from "@lezer/markdown";

/** Keep YAML scalars from opening Markdown constructs that consume the following document. */
export const frontmatterSyntax: MarkdownConfig = {
  defineNodes: [{ name: "SlateFrontmatter", block: true }],
  parseBlock: [{
    name: "SlateFrontmatter", before: "HorizontalRule",
    parse(context, line) {
      if (context.lineStart !== 0 || line.text.length > 128 || !/^\uFEFF?---[\t ]*$/.test(line.text)) return false;
      let to = line.text.length;
      while (context.nextLine()) {
        to = context.lineStart + line.text.length;
        if (line.text.length <= 128 && /^(?:---|\.\.\.)[\t ]*$/.test(line.text)) { context.nextLine(); break; }
      }
      context.addElement(context.elt("SlateFrontmatter", 0, to)); return true;
    },
  }],
};
