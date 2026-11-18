/** Pick an inline-code fence that cannot close on a run inside the source. */
export function inlineCodeDelimiters(text: string): readonly [string, string] {
  let longest = 0;
  for (const match of text.matchAll(/`+/g))
    longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return [fence + padding, padding + fence];
}
