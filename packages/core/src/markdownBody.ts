/** Metadata stays protected even when it is unfinished or invalid YAML. */
export function markdownBodyFrom(source: string): number {
  const opening = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r|$)/.exec(source);
  if (!opening) return source.startsWith("\uFEFF") ? 1 : 0;
  let position = opening[0].length;
  while (position < source.length) {
    let end = position;
    while (end < source.length && source[end] !== "\r" && source[end] !== "\n")
      end++;
    const after =
      end + (source.startsWith("\r\n", end) ? 2 : end < source.length ? 1 : 0);
    if (/^(?:---|\.\.\.)[ \t]*$/.test(source.slice(position, end)))
      return after;
    position = after;
  }
  return source.length;
}
