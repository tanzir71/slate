const opening = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r|$)/;

/** Raw UTF-16 bounds shared by metadata readers and source-preserving editing. */
export function markdownFrontmatter(source: string): { from: number; to: number; bodyFrom: number } | undefined {
  const match = opening.exec(source);
  if (!match) return;
  let position = match[0].length;
  while (position < source.length) {
    let end = position;
    while (end < source.length && source[end] !== "\r" && source[end] !== "\n")
      end++;
    const after =
      end + (source.startsWith("\r\n", end) ? 2 : end < source.length ? 1 : 0);
    if (/^(?:---|\.\.\.)[ \t]*$/.test(source.slice(position, end)))
      return { from: match[0].length, to: position, bodyFrom: after };
    position = after;
  }
}

/** Metadata stays protected even when it is unfinished or invalid YAML. */
export function markdownBodyFrom(source: string): number {
  return markdownFrontmatter(source)?.bodyFrom ??
    (opening.test(source) ? source.length : source.startsWith("\uFEFF") ? 1 : 0);
}
