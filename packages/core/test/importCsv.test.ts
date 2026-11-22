import { expect, it } from "vitest";
import { parseImportCsv } from "../src/importCsv";

it("keeps Unicode, quoted commas, escaped quotes, blank fields and CRLF inside cells", () => {
  expect(parseImportCsv('\ufeffName,Details,Empty\r\nবাংলা,"A, B\r\n""quoted""",\r\n')).toEqual([["Name", "Details", "Empty"], ["বাংলা", 'A, B\r\n"quoted"', ""]]);
});
it.each([["", []], ["a,b", [["a", "b"]]], ['""', [[""]]], [",", [["", ""]]], ["a\rb\nc\r\n", [["a"], ["b"], ["c"]]]])("reads boundary CSV input %j", (source, expected) => {
  expect(parseImportCsv(source as string)).toEqual(expected);
});
it.each(['"unclosed', 'prefix"quote', '"closed"extra', '"value"  ,next'])("rejects malformed quoted fields %j", source => { expect(() => parseImportCsv(source)).toThrow("CSV"); });
it("refuses an unbounded row expansion", () => { expect(() => parseImportCsv("a\n".repeat(50001))).toThrow("50000 rows"); });
