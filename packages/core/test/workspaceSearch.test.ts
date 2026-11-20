import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { findLiteralMatches, planLiteralReplacement } from "../src/workspaceSearch.js";

describe("literal source search", () => {
  it("returns source offsets and physical positions without normalizing BOM or mixed endings", () => {
    const source = "\uFEFFAlpha\r\n🙂 Alpha\rবাংলা Alpha\nAlpha";
    const matches = [...findLiteralMatches(source, "alpha")];
    expect(matches).toEqual([
      { from: 1, to: 6, text: "Alpha", line: 1, column: 2 },
      { from: 11, to: 16, text: "Alpha", line: 2, column: 4 },
      { from: 23, to: 28, text: "Alpha", line: 3, column: 7 },
      { from: 29, to: 34, text: "Alpha", line: 4, column: 1 },
    ]);
    for (const match of matches) expect(source.slice(match.from, match.to)).toBe(match.text);
  });
  it.each([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "/", "a.*[b]\\$"])("treats %j as literal text", (query) => {
    const source = `before ${query} after ${query}`;
    expect([...findLiteralMatches(source, query)].map((match) => match.from)).toEqual([7, 14 + query.length]);
    expect(planLiteralReplacement(source, query, "kept").output).toBe("before kept after kept");
  });
  it("matches Unicode case without changing offsets through expanding lowercase mappings", () => {
    const source = "İx KKk ſS 🙂 বাংলা";
    expect([...findLiteralMatches(source, "k")].map((match) => match.from)).toEqual([3, 4, 5]);
    expect([...findLiteralMatches(source, "s")].map((match) => match.text)).toEqual(["ſ", "S"]);
    expect([...findLiteralMatches(source, "İx")][0]).toMatchObject({ from: 0, to: 2 });
    expect([...findLiteralMatches(source, "বাংলা")][0]?.text).toBe("বাংলা");
    expect([...findLiteralMatches(source, "k", { matchCase: true })].map((match) => match.from)).toEqual([5]);
  });
  it("does not match half of an astral character but supports literal unpaired surrogates", () => {
    const source = "🙂\uD83Dx\uDE42";
    expect([...findLiteralMatches(source, "🙂")].map((match) => [match.from, match.to])).toEqual([[0, 2]]);
    expect([...findLiteralMatches(source, "\uD83D")].map((match) => match.from)).toEqual([2]);
    expect([...findLiteralMatches(source, "\uDE42")].map((match) => match.from)).toEqual([4]);
  });
  it("counts CRLF as one line while giving newline matches nonnegative source columns", () => {
    const source = "a\r\nb\rc\n";
    expect([...findLiteralMatches(source, "\n")]).toEqual([
      { from: 2, to: 3, text: "\n", line: 1, column: 3 },
      { from: 6, to: 7, text: "\n", line: 3, column: 2 },
    ]);
    expect([...findLiteralMatches(source, "\r\nb\r")][0]).toMatchObject({ from: 1, to: 5, line: 1, column: 2 });
    expect([...findLiteralMatches(source, "c")][0]).toMatchObject({ line: 3, column: 1 });
  });
  it("finds non-overlapping matches, supports an empty replacement and leaves empty queries alone", () => {
    expect([...findLiteralMatches("aaaaa", "aa")].map((match) => match.from)).toEqual([0, 2]);
    expect(planLiteralReplacement("aaaaa", "aa", "").output).toBe("a");
    expect(planLiteralReplacement("Words", "", "extra")).toEqual({ source: "Words", output: "Words", changes: [], matches: 0 });
    expect(planLiteralReplacement("", "Words", "extra").changes).toEqual([]);
  });
  it("keeps replacement metacharacters literal and avoids writes for identical matches", () => {
    const replacement = "$&$1$`$'\\n";
    const plan = planLiteralReplacement("\uFEFFWord\r\nWORD\rWord\n", "word", replacement);
    expect(plan.output).toBe(`\uFEFF${replacement}\r\n${replacement}\r${replacement}\n`);
    expect(plan.changes).toHaveLength(3); expect(plan.matches).toBe(3);
    expect(planLiteralReplacement("same SAME", "same", "same")).toMatchObject({ output: "same same", matches: 2, changes: [{ from: 5, to: 9, text: "same" }] });
    expect(planLiteralReplacement("same", "same", "same").changes).toEqual([]);
  });
  it("preserves all source outside exact match ranges across generated literal replacements", () => {
    const chunks = fc.array(fc.constantFrom("a", "B", "🙂", "বাংলা", "e\u0301", "\r", "\n", "$&", "[x]", "\\", "\uFEFF", " "), { maxLength: 60 }).map((items) => items.join(""));
    fc.assert(fc.property(chunks, chunks.filter((query) => query.length > 0), chunks, (source, query, replacement) => {
      const input = source + query + source;
      const plan = planLiteralReplacement(input, query, replacement, { matchCase: true });
      expect(plan.output).toBe(input.split(query).join(replacement));
      const matches = [...findLiteralMatches(input, query, { matchCase: true })];
      expect(plan.matches).toBe(matches.length);
      for (const match of matches) { expect(input.slice(match.from, match.to)).toBe(query); expect(match.column).toBeGreaterThan(0); }
    }), { numRuns: 300 });
  });
});
