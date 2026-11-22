export interface ImportMarkup { readonly root: DocumentFragment | Element; readonly title: string }
export interface MarkupConversion {
  link(url: string): string | undefined;
  image(url: string, alt: string): string;
  media(hash: string, type: string, alt: string): string;
  warn(message: string): void;
}
export const escapeImportText = (text: string) => text.replace(/&/g, "&amp;").replace(/([\\`*_{}[\]<>!#|~$])/g, "\\$1")
  .replace(/(^|\n)( {0,3})([+-])(?=\s)/g, "$1$2\\$3").replace(/(^|\n)( {0,3})(\d+)([.)])(?=\s)/g, "$1$2$3\\$4").replace(/^( *)([-=]{3,})([ \t]*)$/gm, "$1\\$2$3");
export function importCode(text: string, block = false): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
  const fence = "`".repeat(Math.max(block ? 3 : 1, longest + 1));
  return block ? `\n\n${fence}\n${text.replace(/\n$/, "")}\n${fence}\n\n` : `${fence} ${text.replace(/[\r\n]/g, " ")} ${fence}`;
}

/** XML parsers never receive DTD/entity definitions; quoted > and CDATA remain intact. */
export function stripImportDoctypes(source: string): string {
  const token = /<!--|<!\[CDATA\[|<!DOCTYPE\b|<!ENTITY\b/gi, chunks: string[] = [];
  let copied = 0;
  for (let match = token.exec(source); match; match = token.exec(source)) {
    if (match[0] === "<!--" || match[0] === "<![CDATA[") {
      const close = source.indexOf(match[0] === "<!--" ? "-->" : "]]>", token.lastIndex);
      if (close < 0) throw Error("An imported XML comment or CDATA section is incomplete.");
      token.lastIndex = close + 3; continue;
    }
    if (/^<!ENTITY/i.test(match[0])) throw Error("XML entity definitions are not supported. Export a plain ENEX file.");
    let quote = "", end = token.lastIndex;
    for (; end < source.length; end++) {
      const char = source[end]!;
      if (quote) { if (char === quote) quote = ""; }
      else if (char === "'" || char === '"') quote = char;
      else if (char === "[") throw Error("XML entity definitions are not supported. Export a plain ENEX file.");
      else if (char === ">") break;
    }
    if (end === source.length) throw Error("An imported XML doctype is incomplete.");
    chunks.push(source.slice(copied, match.index)); copied = end + 1; token.lastIndex = copied;
  }
  return chunks.length ? chunks.join("") + source.slice(copied) : source;
}
export function parseImportXml(source: string, root: string): Element {
  const xml = new DOMParser().parseFromString(stripImportDoctypes(source), "application/xml");
  if (xml.documentElement.localName !== root || xml.getElementsByTagName("parsererror").length) throw Error(`The ${root} export contains invalid XML.`);
  return xml.documentElement;
}
export function prepareImportMarkup(source: string, enml = false): ImportMarkup {
  if (source.length > 10 * 1024 * 1024) throw Error("An imported note exceeds 10 MB of markup.");
  const template = document.createElement("template");
  let root: DocumentFragment | Element;
  if (enml) {
    // Convert XHTML named entities to numeric XML references without activating markup.
    const normalized = source.replace(/&([a-z][a-z\d]+);/gi, (entity, name: string) => {
      if (["amp", "lt", "gt", "quot", "apos"].includes(name)) return entity;
      template.innerHTML = entity;
      const value = template.content.textContent ?? "";
      return value === entity ? entity : Array.from(value).map(char => `&#${char.codePointAt(0)!};`).join("");
    });
    root = parseImportXml(normalized, "en-note");
  } else { template.innerHTML = source; root = template.content; }
  return { root, title: (root.querySelector("h1") ?? root.querySelector("title"))?.textContent?.trim() ?? "" };
}

/** Convert detached nodes into Markdown strings. Imported nodes never enter the live document. */
export function convertImportMarkup(markup: ImportMarkup, options: MarkupConversion): string {
  const codeBlocks: string[] = [];
  function codeBlock(text: string) {
    const index = codeBlocks.push(importCode(text, true).trim()) - 1;
    return `\n\n\u0000SLATE-CODE-${index}\u0000\n\n`;
  }
  function children(node: Node, depth: number): string { return Array.from(node.childNodes).map(child => render(child, depth + 1)).join(""); }
  function table(element: Element, depth: number) {
    const rows = Array.from(element.querySelectorAll("tr")).filter(row => row.closest("table") === element).map(row => Array.from(row.children).filter(cell => /^(?:td|th)$/i.test(cell.localName)).map(cell => children(cell, depth).trim().replace(/\n+/g, "<br>").replace(/(?<!\\)\|/g, "\\|")));
    if (!rows.length) return "";
    const width = Math.max(...rows.map(row => row.length));
    if (rows.length > 50000 || rows.length * width > 250000) throw Error("An imported table has too many cells.");
    const header = element.querySelector("tr")?.querySelector("th") ? rows.shift()! : Array.from({ length: width }, () => "");
    return "\n\n" + [header, Array.from({ length: width }, () => "---"), ...rows].map(row => "| " + Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ") + " |").join("\n") + "\n\n";
  }
  function list(element: Element, depth: number) {
    const first = Number(element.getAttribute("start") ?? 1), start = Number.isSafeInteger(first) && first >= 0 && first < 1000000 ? first : 1;
    return "\n\n" + Array.from(element.children).filter(child => child.localName === "li").map((item, index) => {
      const body = children(item, depth).trim(), prefix = element.localName === "ol" ? `${start + index}. ` : "- ";
      const lines = body.split("\n");
      return (/^- \[[ x]\]/i.test(body) ? "" : prefix) + lines[0] + lines.slice(1).map(line => "\n" + " ".repeat(prefix.length) + line).join("");
    }).join("\n") + "\n\n";
  }
  function render(node: Node, depth: number): string {
    if (depth > 64) throw Error("An imported note has too many nested elements.");
    if (node.nodeType === 3) return escapeImportText(node.textContent?.replace(/\s+/g, " ") ?? "");
    if (node.nodeType !== 1) return node.nodeType === 11 ? children(node, depth) : "";
    const element = node as Element, tag = element.localName.toLowerCase();
    if (["script", "style", "head", "title", "meta", "link", "base", "iframe", "object", "embed", "template"].includes(tag)) {
      if (["script", "iframe", "object", "embed"].includes(tag)) options.warn("Active HTML was kept only in the original export.");
      return "";
    }
    if (tag === "pre") {
      const source = element.textContent ?? "";
      if (element.closest("td,th")) return "<code>" + source.replace(/[&<>|`*_{}[\]\\!~$]/g, char => `&#${char.charCodeAt(0)};`).replace(/\r\n|\r|\n/g, "<br>") + "</code>";
      return codeBlock(source);
    }
    if (tag === "code" || tag === "kbd" || tag === "samp") return importCode(element.textContent ?? "");
    if (tag === "br") return "\n";
    if (tag === "hr") return "\n\n---\n\n";
    if (tag === "img") return options.image(element.getAttribute("src") ?? "", element.getAttribute("alt") ?? "Image");
    if (tag === "en-media") return options.media(element.getAttribute("hash") ?? "", element.getAttribute("type") ?? "", element.getAttribute("alt") ?? "Attachment");
    if (tag === "en-crypt") { options.warn("Encrypted Evernote content was kept as ciphertext. Unlock it in Evernote to export readable text."); return codeBlock(element.textContent ?? ""); }
    if (tag === "en-todo" || tag === "input" && element.getAttribute("type") === "checkbox") return `- [${element.getAttribute("checked") === "true" || tag === "input" && element.hasAttribute("checked") ? "x" : " "}] `;
    if (tag === "table") return table(element, depth);
    if (tag === "ul" || tag === "ol") return list(element, depth);
    const body = children(element, depth);
    if (/^h[1-6]$/.test(tag)) return "\n\n" + "#".repeat(Number(tag[1])) + " " + body.trim() + "\n\n";
    if (["strong", "b"].includes(tag)) return `**${body.trim()}**`;
    if (["em", "i"].includes(tag)) return `*${body.trim()}*`;
    if (["del", "s", "strike"].includes(tag)) return `~~${body.trim()}~~`;
    if (tag === "blockquote") return "\n\n" + body.trim().split("\n").map(line => "> " + line).join("\n") + "\n\n";
    if (tag === "a") {
      const href = element.getAttribute("href"), url = href && options.link(href);
      return url ? `[${body.trim() || escapeImportText(href!)}](${url})` : body;
    }
    if (tag === "audio" || tag === "video") {
      const source = element.getAttribute("src") ?? element.querySelector("source[src]")?.getAttribute("src"), url = source && options.link(source);
      return url ? `[${tag === "audio" ? "Audio" : "Video"}](${url})` : body;
    }
    if (["p", "div", "section", "article", "en-note", "dl", "dt", "dd", "figure", "figcaption"].includes(tag)) return "\n\n" + body.trim() + "\n\n";
    if (tag === "span" || tag === "font") {
      const style = (element as HTMLElement).style;
      if (style?.fontWeight === "bold" || Number(style?.fontWeight) >= 600) return `**${body.trim()}**`;
      if (style?.fontStyle === "italic") return `*${body.trim()}*`;
    }
    return body;
  }
  // eslint-disable-next-line no-control-regex -- Internal NUL markers preserve code whitespace; parsed HTML/XML text cannot contain these markers.
  return render(markup.root, 0).replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim().replace(/(^[^\n]*)\u0000SLATE-CODE-(\d+)\u0000/gm, (_token, prefix: string, index: string) => {
    const list = /(?:^|[ \t>])(?:[-+*]|\d+[.)])[ \t]+$/.exec(prefix);
    const continuation = list ? prefix.slice(0, list.index) + list[0].replace(/\S/g, " ") : prefix;
    return prefix + codeBlocks[Number(index)]!.replace(/\n/g, "\n" + continuation);
  }) + "\n";
}
