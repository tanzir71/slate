/** Convert only when a caller receives eligible HTML clipboard data. */
export async function convertClipboardHtml(html: string): Promise<string> {
  const { convertHtmlToMarkdown } = await import("./htmlToMarkdown.js");
  return convertHtmlToMarkdown(html);
}
