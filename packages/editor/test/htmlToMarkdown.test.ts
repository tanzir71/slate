import { parseMarkdownPreview, type MarkdownPreviewNode } from "@slate/core";
import { expect, it } from "vitest";
import fixtures from "./fixtures/clipboard-html.json";
import { convertHtmlToMarkdown } from "../src/htmlToMarkdown";

it.each(fixtures)("converts $name to golden GFM", ({ html, markdown }) => {
  expect(convertHtmlToMarkdown(html)).toBe(markdown);
});

function nodes(root: MarkdownPreviewNode): MarkdownPreviewNode[] {
  return [root, ...(root.children ?? []).flatMap(nodes)];
}
function text(root: MarkdownPreviewNode): string {
  return root.value ?? root.alt ?? (root.children ?? []).map(text).join("");
}
it.each([
  [
    "<p>&lt;script&gt; &amp;copy; ~~literal~~ ==mark== $x$</p>",
    "<script> &copy; ~~literal~~ ==mark== $x$",
  ],
  ["<p>Café বাংলা 📝 non&nbsp;breaking</p>", "Café বাংলা 📝 non\u00a0breaking"],
  [
    "<p>*literal* _word_ [label](url) \\path</p>",
    "*literal* _word_ [label](url) \\path",
  ],
])("retains literal text when rendered as GFM: %s", (html, expected) => {
  const tree = parseMarkdownPreview(convertHtmlToMarkdown(html));
  expect(text(tree)).toBe(expected);
  expect(
    nodes(tree).filter((node) =>
      ["html", "delete", "link", "emphasis"].includes(node.type),
    ),
  ).toEqual([]);
});
it("keeps style resets and combines adjacent word-processor spans", () => {
  expect(
    convertHtmlToMarkdown(
      '<p><b>Bold <span style="font-weight:normal">plain</span> bold</b> <span style="font-style:italic">one</span><span style="font-style:italic">two</span></p>',
    ),
  ).toBe("**Bold** plain **bold** *onetwo*");
});
it("retains formatting around inline code without changing its literal contents", () => {
  const tree = parseMarkdownPreview(
    convertHtmlToMarkdown(
      "<p><strong><code>*literal* &amp; &lt;x&gt;</code></strong></p>",
    ),
  );
  expect(tree.children?.[0]?.children?.[0]?.type).toBe("strong");
  expect(nodes(tree).find((node) => node.type === "inlineCode")?.value).toBe(
    "*literal* & <x>",
  );
});
it("keeps strikethrough and highlight markers", () => {
  expect(
    convertHtmlToMarkdown(
      "<p><s>old</s> <del>gone</del> <mark>bright</mark></p>",
    ),
  ).toBe("~~old~~ ~~gone~~ ==bright==");
});
it.each([
  "javascript:alert(1)",
  "java&#10;script:alert(1)",
  "data:text/html,hello",
  "file:///secret",
  "blob:https://example.test/id",
])("keeps a label while discarding an unsafe reference: %s", (href) => {
  expect(convertHtmlToMarkdown(`<p><a href="${href}">Keep me</a></p>`)).toBe(
    "Keep me",
  );
});
it.each([
  "https://example.test/a(b)?x=1&copy;=2",
  "../a(b).md?x=1&copy;=2",
  "mailto:writer@example.test",
])("round-trips a safe destination: %s", (url) => {
  const html = `<a href="${url.replaceAll("&", "&amp;")}">Label</a>`;
  const link = nodes(parseMarkdownPreview(convertHtmlToMarkdown(html))).find(
    (node) => node.type === "link",
  );
  expect(link?.url).toBe(url);
  expect(text(link!)).toBe("Label");
});
it("escapes image alt text and keeps safe relative references", () => {
  const tree = parseMarkdownPreview(
    convertHtmlToMarkdown(
      '<p><img alt="[diagram] &amp;copy;" src="./assets/a(b).png"></p>',
    ),
  );
  const image = nodes(tree).find((node) => node.type === "image");
  expect(image?.url).toBe("./assets/a(b).png");
  expect(image?.alt).toBe("[diagram] &copy;");
  expect(
    convertHtmlToMarkdown('<img alt="Diagram" src="javascript:bad">'),
  ).toBe("Diagram");
});
it("promotes a spreadsheet's first TD row to a header", () => {
  expect(
    convertHtmlToMarkdown(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
    ),
  ).toBe("| A   | B   |\n| --- | --- |\n| C   | D   |");
});
it("expands spans without duplicating or losing cell values and keeps captions", () => {
  const markdown = convertHtmlToMarkdown(
    '<table><caption>Results</caption><tr><td colspan="2">Wide</td><td rowspan="0">Tall</td></tr><tr><td>First</td><td>Second</td></tr><tr><td>Third</td><td>Last</td></tr></table>',
  );
  expect(markdown.startsWith("Results\n\n| Wide")).toBe(true);
  const table = nodes(parseMarkdownPreview(markdown)).find(
    (node) => node.type === "table",
  )!;
  expect(table.children?.map((row) => row.children?.map(text))).toEqual([
    ["Wide", "", "Tall"],
    ["First", "Second", ""],
    ["Third", "Last", ""],
  ]);
});
it("keeps code pipes and line breaks inside a table cell", () => {
  const markdown = convertHtmlToMarkdown(
    "<table><tr><th>Code</th></tr><tr><td><pre><code>a|b\nc</code></pre></td></tr></table>",
  );
  const table = nodes(parseMarkdownPreview(markdown)).find(
    (node) => node.type === "table",
  )!;
  const content = table.children?.[1]?.children?.[0]?.children;
  expect(content?.map((node) => node.type)).toEqual([
    "inlineCode",
    "html",
    "inlineCode",
  ]);
  expect(content?.map(text)).toEqual(["a|b", "<br>", "c"]);
});
it("uses a code fence longer than copied backticks and preserves code whitespace", () => {
  const code = "  first\n```md\nlast  ";
  const markdown = convertHtmlToMarkdown(
    `<pre><code class="language-ts">${code}\n</code></pre>`,
  );
  expect(markdown).toBe("````ts\n" + code + "\n````");
  const node = parseMarkdownPreview(markdown).children?.[0];
  expect(node?.type).toBe("code");
  expect(node?.value).toBe(code);
});
it("converts PRE line breaks without requiring a CODE wrapper", () => {
  expect(convertHtmlToMarkdown("<pre>first<br>second\r\n</pre>")).toBe(
    "```\nfirst\nsecond\n```",
  );
});
it("drops active document resources and honors a selected clipboard fragment", () => {
  const html =
    '<base href="https://external.test/"><link rel="stylesheet" href="https://external.test/style"><!--StartFragment--><p>Kept</p><script>throw 1</script><iframe src="https://external.test/"></iframe><object data="https://external.test/x"></object><!--EndFragment--><p>Not selected</p>';
  expect(convertHtmlToMarkdown(html)).toBe("Kept");
});
it("does not discard content when fragment markers are incomplete", () => {
  expect(
    convertHtmlToMarkdown("<p>First</p><!--StartFragment--><p>Second</p>"),
  ).toBe("First\n\nSecond");
});
it("keeps a copied Word list's starting number and nested children", () => {
  const item = (level: number, marker: string, value: string) =>
    `<p style="mso-list:l0 level${level} lfo1"><span style="mso-list:Ignore">${marker}</span>${value}</p>`;
  const tree = parseMarkdownPreview(
    convertHtmlToMarkdown(
      item(3, "3.", "Parent") + item(4, "1.", "Child") + item(3, "4.", "Next"),
    ),
  );
  expect(tree.children?.[0]?.type).toBe("list");
  expect(tree.children?.[0]?.ordered).toBe(true);
  expect(nodes(tree).filter((node) => node.type === "list")).toHaveLength(2);
  expect(text(tree)).toBe("ParentChildNext");
  expect(convertHtmlToMarkdown(item(3, "3.", "Parent"))).toBe("3.  Parent");
});

it("does not invent empty list items for skipped Word indentation levels", () => {
  const item = (level: string, value: string) =>
    `<p style="mso-list:l0 level${level} lfo1"><span style="mso-list:Ignore">•</span>${value}</p>`;
  const tree = parseMarkdownPreview(
    convertHtmlToMarkdown(
      item("1", "Parent") +
        item("40", "Child") +
        item("999999999999999999999999999", "Last"),
    ),
  );
  expect(nodes(tree).filter((node) => node.type === "list")).toHaveLength(2);
  expect(nodes(tree).filter((node) => node.type === "listItem")).toHaveLength(
    3,
  );
  expect(text(tree)).toBe("ParentChildLast");
});
it("converts a long series of styled word-processor spans without splitting its formatting", () => {
  const parts = Array.from(
    { length: 2_000 },
    (_unused, index) => `word${index} `,
  );
  const html =
    "<p>" +
    parts
      .map((part) => `<span style="font-weight:bold">${part}</span>`)
      .join("") +
    "</p>";
  const tree = parseMarkdownPreview(convertHtmlToMarkdown(html));
  expect(text(tree)).toBe(parts.join("").trimEnd());
  expect(nodes(tree).filter((node) => node.type === "strong")).toHaveLength(1);
});

it.each(["a", "img"])("keeps escaped %s titles", (tag) => {
  const attribute =
    tag === "a"
      ? 'href="https://example.test/"'
      : 'src="./assets/a.png" alt="Image"';
  const html = `<${tag} ${attribute} title="A &quot;quote&quot; &amp;copy;">${tag === "a" ? "Link</a>" : ""}`;
  const tree = parseMarkdownPreview(convertHtmlToMarkdown(html));
  expect(
    nodes(tree).find((node) => node.type === (tag === "a" ? "link" : "image")),
  ).toMatchObject({ title: 'A "quote" &copy;' });
});

it("keeps paragraph-wide formatting when converting Word list metadata", () => {
  const html =
    '<p style="mso-list:l0 level1 lfo1;font-weight:bold"><span style="mso-list:Ignore">•</span>Bold <span style="font-weight:normal">plain</span></p>';
  expect(convertHtmlToMarkdown(html)).toBe("-   **Bold** plain");
});
