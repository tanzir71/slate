/** Keep inserted block content separate without duplicating existing newlines. */
export function markdownBoundary(left: string, right: string, eol: string) {
  if (!left || !right) return "";
  let existing = 0;
  while (existing < 2 && left.endsWith(eol.repeat(existing + 1))) existing++;
  let leading = 0;
  while (existing + leading < 2 && right.startsWith(eol.repeat(leading + 1)))
    leading++;
  return eol.repeat(Math.max(0, 2 - existing - leading));
}
