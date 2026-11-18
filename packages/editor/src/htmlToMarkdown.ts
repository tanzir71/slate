// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- An ambient shim must also reach workspaces that consume editor source.
/// <reference path="./types/turndown-plugin-gfm.d.ts" />
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  normalizeHtmlFormatting,
  normalizeWordLists,
} from "./htmlFormatting.js";
import { htmlTableMarkdown } from "./htmlTable.js";
import { inlineCodeDelimiters } from "./codeDelimiters.js";

function clipboardFragment(html: string): DocumentFragment {
  const start = /<!--\s*StartFragment\s*-->/i.exec(html);
  const end = /<!--\s*EndFragment\s*-->/i.exec(html);
  const selected =
    start && end && end.index >= start.index + start[0].length
      ? html.slice(start.index + start[0].length, end.index)
      : html;
  // Template contents stay disconnected and inert, including image/frame resources.
  const template = document.createElement("template");
  template.innerHTML = selected;
  const root = template.content;
  for (const node of root.querySelectorAll(
    "script, style, meta, link, base, iframe, object, embed, title, noscript",
  ))
    node.remove();
  normalizeWordLists(root);
  normalizeHtmlFormatting(root);
  return root;
}
function safeReference(value: string, image = false): string | undefined {
  const text = value.trim();
  if (!text || /\p{Cc}/u.test(text)) return;
  try {
    const url = new URL(text, "https://slate.invalid/");
    if (
      !["http:", "https:", ...(image ? [] : ["mailto:"])].includes(url.protocol)
    )
      return;
    return text.replace(/[ <>]/g, (character) => encodeURIComponent(character));
  } catch {
    return;
  }
}
const destination = (text: string) => text.replace(/[\\()<>&]/g, "\\$&");
function titleAttribute(node: HTMLElement): string {
  const title = node.getAttribute("title");
  return title
    ? ' "' + title.replace(/[\\"&<>]/g, "\\$&").replace(/\r\n?|\n/g, " ") + '"'
    : "";
}
function codeLine(text: string): string {
  let [before, after] = inlineCodeDelimiters(text);
  if (text.startsWith(" ") && text.endsWith(" ") && !/^ +$/.test(text)) {
    before += " ";
    after = " " + after;
  }
  return before + text + after;
}

/** Rich converter implementation, accessed through the lazy clipboard entry point. */
export function convertHtmlToMarkdown(html: string): string {
  const root = clipboardFragment(html);
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
  });
  const escape = service.escape.bind(service);
  // Turndown's default escaping omits HTML/entities and several GFM/Slate
  // delimiters. Copied literal text must remain literal when the file renders.
  service.escape = (text) => escape(text).replace(/[&<>~=$|]/g, "\\$&");
  service.use(gfm);
  service.addRule("slateStrike", {
    filter: (node) => /^(DEL|S|STRIKE)$/.test(node.nodeName),
    replacement: (content) => (content ? `~~${content}~~` : ""),
  });
  service.addRule("slateHighlight", {
    filter: "mark",
    replacement: (content) => (content ? `==${content}==` : ""),
  });
  service.addRule("slateLink", {
    filter: "a",
    replacement(content, node) {
      const href = safeReference(node.getAttribute("href") ?? "");
      return href
        ? `[${content}](${destination(href)}${titleAttribute(node)})`
        : content;
    },
  });
  service.addRule("slateImage", {
    filter: "img",
    replacement(_content, node) {
      const src = safeReference(node.getAttribute("src") ?? "", true);
      const alt = service.escape(node.getAttribute("alt") ?? "");
      return src
        ? `![${alt}](${destination(src)}${titleAttribute(node)})`
        : alt;
    },
  });
  service.addRule("slateCodeBlock", {
    filter: "pre",
    replacement(_content, node) {
      const cloned = node.cloneNode(true) as HTMLElement;
      for (const br of cloned.querySelectorAll("br")) br.replaceWith("\n");
      const text = (cloned.textContent ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/\n$/, "");
      if (node.closest("td, th"))
        return text.split("\n").map(codeLine).join("<br>");
      const language =
        /\blanguage-([\w+#.-]{1,48})(?:\s|$)/.exec(
          node.querySelector("code")?.className ?? "",
        )?.[1] ?? "";
      let width = 3;
      for (const run of text.matchAll(/`+/g))
        width = Math.max(width, run[0].length + 1);
      const fence = "`".repeat(width);
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
  });
  const tableCache = new Map<string, string>();
  service.addRule("slateTable", {
    filter: "table",
    replacement(_content, node) {
      const key = node.outerHTML;
      let markdown = tableCache.get(key);
      if (markdown === undefined) {
        markdown = htmlTableMarkdown(node as HTMLTableElement, service);
        tableCache.set(key, markdown);
      }
      return markdown ? `\n\n${markdown}\n\n` : "";
    },
  });
  return service.turndown(root);
}
