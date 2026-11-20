import { describe, expect, it } from "vitest";
import { parseMarkdownProperties } from "../src/index";

describe("source-preserving frontmatter properties", () => {
  it("retains raw BOM/CRLF, comments and quoted values with original source offsets", () => {
    const source = "\uFEFF---\r\n# Stay\r\nstatus: 'Draft' # Keep\r\ntags: [strategy, planning]\r\ngoal: 1500\r\n...\r\n\r\n# Body";
    const result = parseMarkdownProperties(source)!;
    expect(result.properties.map(property => [property.key, property.value])).toEqual([["status", "Draft"], ["tags", ["strategy", "planning"]], ["goal", 1500]]);
    expect(result.properties[0]?.keyFrom).toBe(source.indexOf("status"));
    expect(result.properties[0]?.valueFrom).toBe(source.indexOf("'Draft'"));
    expect(result.closingFrom).toBe(source.indexOf("..."));
    expect(result.prefix).toBe(source.slice(0, source.indexOf("\r\n\r\n# Body") + 2));
    expect(source.slice(result.bodyFrom)).toBe("\r\n# Body");
  });
  it("reads empty mappings and scalar, nested and null values without flattening their source", () => {
    expect(parseMarkdownProperties("---\n# Empty\n---")?.properties).toEqual([]);
    const result = parseMarkdownProperties("---\nempty:\nnumber: 0\nflag: false\noptions: {nested: yes}\n---")!;
    expect(result.properties.map(property => property.key)).toEqual(["empty", "number", "flag", "options"]);
    expect(result.properties.slice(0, 3).map(property => property.value)).toEqual([null, 0, false]);
    expect(result.properties[3]?.value).toEqual(new Map([["nested", "yes"]]));
  });
  it("treats HTML and prototype-shaped keys as ordinary metadata", () => {
    const source = "---\n__proto__: kept\ntitle: '<img onerror=alert(1)>'\n---\n\nBody";
    const result = parseMarkdownProperties(source)!;
    expect(result.properties.map(property => [property.key, property.value])).toEqual([["__proto__", "kept"], ["title", "<img onerror=alert(1)>"]]);
    expect(result.prefix).toBe(source.slice(0, source.indexOf("\n\nBody") + 1));
  });
  it.each([
    "No metadata", "---\nstatus: [unfinished\n---", "---\nstatus: one\nstatus: two\n---", "---\n- root sequence\n---",
    "---\nvalue: !unknown raw\n---", "---\nbase: &base {nested: value}\ncopy: *base\n---", "---\n? [complex, key]\n: value\n---", "---\nstatus: Draft",
  ])("leaves unsupported metadata literal: %j", source => {
    expect(parseMarkdownProperties(source)).toBeUndefined();
  });
});
