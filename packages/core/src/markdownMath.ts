export interface MathTextSource {
  readonly end: number;
  char(position: number): number;
  slice(from: number, to: number): string;
}
export interface InlineMathSpan { readonly from: number; readonly to: number; readonly width: number }

/** Shared TeX bounds with escaped dollars and currency-safe opening/closing rules. */
export function inlineMathSpan(text: MathTextSource, position: number): InlineMathSpan | undefined {
  if (text.char(position) !== 36) return;
  let openingSlashes = 0;
  for (let cursor = position - 1; cursor >= 0 && text.char(cursor) === 92; cursor--) openingSlashes++;
  if (openingSlashes % 2) return;
  let width = 1; while (text.char(position + width) === 36) width++;
  const start = position + width;
  if (start >= text.end || width === 1 && /\s/.test(text.slice(start, start + 1))) return;
  for (let close = start; close < text.end; close++) {
    if (text.char(close) !== 36) continue;
    let slashes = 0; for (let cursor = close - 1; cursor >= start && text.char(cursor) === 92; cursor--) slashes++;
    if (slashes % 2) continue;
    let count = 1; while (text.char(close + count) === 36) count++;
    if (count < width) { close += count - 1; continue; }
    // Stop at the first invalid unescaped closer; scanning onward could swallow prices and later formulas.
    if (width === 1 && (/\s/.test(text.slice(close - 1, close)) || /\d/.test(text.slice(close + 1, close + 2)))) return;
    return { from: position, to: close + width, width };
  }
}
