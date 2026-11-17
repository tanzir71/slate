/** Fixed row heights keep scrolling stable as metadata and selection change. */
export function sheetWindow(
  count: number,
  height: number,
  top: number,
  rowHeight: number,
) {
  if (count <= 80) return { start: 0, end: count };
  const start = Math.min(
    Math.max(0, count - 1),
    Math.max(0, Math.floor(top / rowHeight) - 6),
  );
  return {
    start,
    end: Math.min(count, Math.ceil((top + height) / rowHeight) + 6),
  };
}
