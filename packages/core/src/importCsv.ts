/** Read exported database values exactly, including commas and newlines inside quoted cells. */
export function parseImportCsv(source: string): readonly (readonly string[])[] {
  const rows: string[][] = [], row: string[] = [];
  let value = "", quoted = false, closed = false;
  const input = source.replace(/^\ufeff/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
      continue;
    }
    if (closed && ![",", "\r", "\n"].includes(char)) throw Error("A CSV field has text after its closing quote.");
    if (char === '"') {
      if (value) throw Error("A CSV quote must begin a field.");
      quoted = true;
    } else if (char === ",") { row.push(value); value = ""; closed = false; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(value); rows.push(row.splice(0)); value = ""; closed = false;
    } else value += char;
  }
  if (quoted) throw Error("An imported CSV field has an unclosed quote.");
  if (value || row.length || closed) { row.push(value); rows.push(row); }
  if (rows.length > 50000) throw Error("An imported CSV has more than 50000 rows.");
  return rows;
}
