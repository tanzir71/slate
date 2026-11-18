interface TextStyle {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  highlight: boolean;
}
const plain: TextStyle = {
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
};
const formatTags = /^(?:B|STRONG|I|EM|S|STRIKE|DEL|MARK|SPAN|FONT)$/;

function wrapFormatting(node: Node, style: TextStyle): Node {
  let current = node;
  for (const [enabled, tag] of [
    [style.highlight, "mark"],
    [style.strike, "del"],
    [style.italic, "em"],
    [style.bold, "strong"],
  ] as const) {
    if (!enabled) continue;
    const wrapper = node.ownerDocument!.createElement(tag);
    wrapper.appendChild(current);
    current = wrapper;
  }
  return current;
}
function moveChildren(from: Node, to: Node) {
  while (from.firstChild) to.appendChild(from.firstChild);
}

/** Merge while appending, without revisiting a growing sibling/text collection. */
function appendNormalized(parent: Node, node: Node) {
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    while (node.firstChild) appendNormalized(parent, node.firstChild);
    return;
  }
  const previous = parent.lastChild;
  if (
    node instanceof HTMLElement &&
    previous instanceof HTMLElement &&
    /^(STRONG|EM|DEL|MARK)$/.test(node.tagName) &&
    previous.tagName === node.tagName
  ) {
    while (node.firstChild) appendNormalized(previous, node.firstChild);
    node.remove();
  } else parent.appendChild(node);
}
function inheritedStyle(node: HTMLElement, inherited: TextStyle): TextStyle {
  const style = { ...inherited };
  if (
    /^(B|STRONG)$/.test(node.tagName) &&
    !node.id.startsWith("docs-internal-guid-")
  )
    style.bold = true;
  if (/^(I|EM)$/.test(node.tagName)) style.italic = true;
  if (/^(S|STRIKE|DEL)$/.test(node.tagName)) style.strike = true;
  if (node.tagName === "MARK") style.highlight = true;
  const weight = node.style.fontWeight;
  if (weight)
    style.bold =
      weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  if (node.style.fontStyle)
    style.italic = /^(italic|oblique)/.test(node.style.fontStyle);
  const decoration = node.style.textDecorationLine || node.style.textDecoration;
  if (decoration) style.strike = decoration.includes("line-through");
  return style;
}

/** Rebuild disconnected formatting once; avoid repeated wide-parent mutations. */
export function normalizeHtmlFormatting(root: DocumentFragment) {
  function visit(node: Node, inherited: TextStyle): Node {
    if (node.nodeType === Node.TEXT_NODE) {
      const copied = node.cloneNode();
      return node.textContent?.trim()
        ? wrapFormatting(copied, inherited)
        : copied;
    }
    if (!(node instanceof HTMLElement) || node.tagName === "PRE")
      return node.cloneNode(true);
    const style = inheritedStyle(node, inherited);
    if (node.tagName === "CODE") {
      const copied = node.cloneNode(true);
      return node.textContent?.trim() ? wrapFormatting(copied, style) : copied;
    }
    const children = node.ownerDocument.createDocumentFragment();
    for (const child of Array.from(node.childNodes))
      appendNormalized(children, visit(child, style));
    if (formatTags.test(node.tagName)) return children;
    const copied = node.cloneNode(false);
    copied.appendChild(children);
    return copied;
  }
  const formatted = root.ownerDocument.createDocumentFragment();
  for (const node of Array.from(root.childNodes))
    appendNormalized(formatted, visit(node, plain));
  root.replaceChildren(formatted);
}

/** Word's non-semantic list paragraphs retain their order, nesting and first counter. */
export function normalizeWordLists(root: DocumentFragment) {
  let container: Node | null = null,
    identity = "",
    base = 1;
  let lists: HTMLElement[] = [];
  for (const paragraph of Array.from(root.querySelectorAll("p[style]"))) {
    const metadata = /mso-list\s*:\s*([^;]+)/i.exec(
      paragraph.getAttribute("style") ?? "",
    )?.[1];
    if (!metadata || /^none$/i.test(metadata.trim())) continue;
    const parsedLevel = Number(/\blevel(\d+)\b/i.exec(metadata)?.[1] ?? 1);
    const rawLevel =
      Number.isSafeInteger(parsedLevel) && parsedLevel > 0 ? parsedLevel : 1;
    const id = metadata.replace(/\blevel\d+\b/i, "").trim();
    const marker = Array.from(paragraph.querySelectorAll("span[style]")).find(
      (node) => /mso-list\s*:\s*ignore/i.test(node.getAttribute("style") ?? ""),
    );
    const number = /^(\d{1,9})[.)]/.exec(
      marker?.textContent?.trim() ?? "",
    )?.[1];
    marker?.remove();
    const ordered = number !== undefined;
    const createList = () => {
      const list = paragraph.ownerDocument.createElement(ordered ? "ol" : "ul");
      if (ordered && number !== "1") list.setAttribute("start", number);
      return list;
    };
    if (
      container !== paragraph.parentNode ||
      id !== identity ||
      paragraph.previousElementSibling !== lists[0]
    ) {
      container = paragraph.parentNode;
      identity = id;
      base = rawLevel;
      const list = createList();
      paragraph.before(list);
      lists = [list];
    }
    // Missing intermediate levels do not require empty phantom list items.
    const level = Math.max(1, Math.min(rawLevel - base + 1, lists.length + 1));
    while (lists.length < level) {
      const parent = lists.at(-1)!;
      let item = parent.lastElementChild;
      if (!item) {
        item = paragraph.ownerDocument.createElement("li");
        parent.append(item);
      }
      const list = createList();
      item.append(list);
      lists.push(list);
    }
    lists = lists.slice(0, level);
    const item = paragraph.ownerDocument.createElement("li");
    item.setAttribute("style", paragraph.getAttribute("style") ?? "");
    moveChildren(paragraph, item);
    lists.at(-1)!.append(item);
    paragraph.remove();
  }
}
