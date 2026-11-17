export function sheetPreview(body: string): string {
  return body
    .replace(/^#+\s.*$/gm, "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match: string, target: string, label: string | undefined) =>
        label ?? target,
    )
    .replace(/[*_`~]/g, "")
    .trim()
    .slice(0, 115);
}
