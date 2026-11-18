/** Parse only the copied fragment, in a disconnected inert template document. */
export function readClipboardFragment(html: string): DocumentFragment {
  const start = /<!--\s*StartFragment\s*-->/i.exec(html);
  const end = /<!--\s*EndFragment\s*-->/i.exec(html);
  const selected =
    start && end && end.index >= start.index + start[0].length
      ? html.slice(start.index + start[0].length, end.index)
      : html;
  const template = document.createElement("template");
  template.innerHTML = selected;
  for (const node of template.content.querySelectorAll(
    "script, style, meta, link, base, iframe, object, embed, title, noscript",
  ))
    node.remove();
  return template.content;
}
