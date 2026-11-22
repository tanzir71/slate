import { expect, it } from "vitest";
import { zipSync } from "fflate";
import { importResourceHash } from "@slate/core";
import { planNoteImport, readNoteImport } from "../src/noteImport";
import { stripImportDoctypes } from "../src/noteImport/markup";
import { readBrowserArchive } from "../src/browserArchive";

const bytes = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(value);
const input = (path: string, value: Uint8Array) => ({ path, file: { size: value.length, arrayBuffer: async () => value.slice().buffer } });
const first = "12345678123412341234123456789abc", second = "22345678123412341234123456789abc";

it("imports Notion ZIP pages with portable UUID-free paths and exact repaired note/asset references", async () => {
  const source = `\ufeff# Parent\r\n\r\n[Child](Parent%20${first}/Child%20${second}.md#section)\r\n![pic](Parent%20${first}/a%20%281%29.png)\r\n\r\n\`[literal](Parent%20${first}/Child%20${second}.md)\`\r\n`;
  const image = new Uint8Array([0, 1, 254, 255]);
  const zipped = zipSync({ [`Parent ${first}.md`]: bytes(source), [`Parent ${first}/Child ${second}.md`]: bytes("# Child\n\n[Parent](../Parent%20" + first + ".md)\n"), [`Parent ${first}/a (1).png`]: image });
  const plan = await readNoteImport("notion", [input("export.zip", zipped)]);
  expect(plan.notes).toEqual(["Parent.md", "Parent/Child.md"]);
  const converted = decode(plan.entries["Parent.md"]!);
  expect(converted).toBe(source.replace(`[Child](Parent%20${first}/Child%20${second}.md#section)`, "[Child](Parent/Child.md#section)").replace(`![pic](Parent%20${first}/a%20%281%29.png)`, "![pic](Parent/a%20%281%29.png)"));
  expect(decode(plan.entries["Parent/Child.md"]!)).toContain("[Parent](../Parent.md)");
  expect(Array.from(plan.entries["Parent/a (1).png"]!)).toEqual(Array.from(image));
  expect(plan.warnings).toEqual([]);
});
it.each(["bear", "ulysses"] as const)("flattens the %s TextBundle into ordinary Markdown and retains assets and metadata", source => {
  const body = "\ufeff# My writing\r\n\r\n![Photo](assets/photo.png)\r\n", image = new Uint8Array([255, 0, 127]);
  const plan = planNoteImport(source, { "Writing.textbundle/info.json": bytes('{"version":2,"type":"net.daringfireball.markdown"}'), "Writing.textbundle/text.markdown": bytes(body), "Writing.textbundle/assets/photo.png": image });
  expect(plan.notes).toEqual(["Writing/Writing.md"]);
  expect(decode(plan.entries["Writing/Writing.md"]!)).toBe(body);
  expect(plan.entries["Writing/assets/photo.png"]).toEqual(image);
  expect(decode(plan.entries["Writing/info.json"]!)).toContain('"version":2');
});
it("reads a compressed TextPack with a plain-text body without turning literal Markdown into formatting", async () => {
  const archive = zipSync({ "info.json": bytes('{"version":2,"type":"public.plain-text"}'), "text.txt": bytes("# Literal\n\n*words*\n") });
  const plan = await readNoteImport("ulysses", [input("Draft.textpack", archive)]);
  expect(plan.notes).toEqual(["Draft/Draft.md"]);
  expect(decode(plan.entries["Draft/Draft.md"]!)).toBe("\\# Literal\n\n\\*words\\*\n");
});
it("converts Notion CSV values without losing quoted commas, multiline cells or literal markup", () => {
  const raw = '\ufeffName,Details\r\nOne,"Comma, and\r\nnew line"\r\nTwo,"<script> &copy; | text"\r\n';
  const plan = planNoteImport("notion", { [`Database ${first}.csv`]: bytes(raw) });
  expect(decode(plan.entries["Database.md"]!)).toContain("| One | Comma, and<br>new line |");
  expect(decode(plan.entries["Database.md"]!)).toContain("\\<script\\> &amp;copy; \\| text");
  expect(decode(plan.entries["Sources/Database.csv"]!)).toBe(raw);
});
it("converts Apple Notes HTML to Markdown while retaining its exact original and local images", () => {
  const html = '<!doctype html><html><head><title>My note</title><script>globalThis.importedScript = true;</script></head><body><h1>My note</h1><p>A <b>bold</b> and <i>quiet</i> idea.</p><ul><li>First</li><li>Second</li></ul><blockquote>A thought</blockquote><pre>one\n\n\nthree\n</pre><p><img src="assets/photo.png" alt="Photo"></p><p><a href="other.html">Other</a></p><img src="https://example.invalid/image.png" alt="Remote"><script>bad()</script></body></html>';
  const image = new Uint8Array([8, 9]);
  const plan = planNoteImport("apple-notes", { "note.html": bytes(html), "other.html": bytes("<h1>Other</h1><p>Words</p>"), "assets/photo.png": image });
  const note = decode(plan.entries["note.md"]!);
  expect(note).toContain("# My note"); expect(note).toContain("**bold** and *quiet*"); expect(note).toContain("- First\n- Second");
  expect(note).toContain("> A thought"); expect(note).toContain("one\n\n\nthree"); expect(note).toContain("![Photo](assets/photo.png)");
  expect(note).toContain("[Other](other.md)"); expect(note).toContain("[Remote](https://example.invalid/image.png)"); expect(note).not.toContain("![Remote]");
  expect(note).not.toContain("bad()"); expect(decode(plan.entries["Sources/note.html"]!)).toBe(html); expect(plan.entries["assets/photo.png"]).toEqual(image);
  expect(plan.warnings).toContain("Remote images were kept as links and were not downloaded.");
  expect(Reflect.get(globalThis, "importedScript")).toBeUndefined();
});
it("extracts embedded images without copying data URLs into the Markdown", () => {
  const image = new Uint8Array([1, 2, 3]), hash = importResourceHash(image);
  const plan = planNoteImport("apple-notes", { "note.html": bytes('<h1>Image</h1><img alt="Saved" src="data:image/png;base64,AQID">') });
  expect(plan.entries[`Attachments/${hash}.png`]).toEqual(image);
  expect(decode(plan.entries["note.md"]!)).toContain(`![Saved](Attachments/${hash}.png)`);
  expect(decode(plan.entries["note.md"]!)).not.toContain("data:");
});
it("preserves ENEX title, dates, tags, tasks, resource bytes, media links and encrypted ciphertext", () => {
  const image = new Uint8Array([1, 2, 3]), hash = importResourceHash(image);
  const enml = `<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div><en-todo checked="true"/>Done&nbsp;now</div><div><en-todo/>Next</div><en-media hash="${hash}" type="image/png" alt="Scan"/><en-crypt hint="kept in source">YWJj</en-crypt></en-note>`;
  const xml = `<?xml version="1.0"?><!DOCTYPE en-export SYSTEM "https://example.invalid/never.dtd"><en-export><note><title>বাংলা plan</title><content><![CDATA[${enml}]]></content><created>20261122T010203Z</created><updated>20261122T020304Z</updated><tag>work</tag><tag>বাংলা</tag><resource><data encoding="base64">AQID</data><mime>image/png</mime><resource-attributes><file-name>scan.png</file-name></resource-attributes></resource></note></en-export>`;
  const plan = planNoteImport("evernote", { "Export.enex": bytes(xml) });
  const note = decode(plan.entries["Export/বাংলা plan.md"]!);
  expect(note).toContain('title: "বাংলা plan"'); expect(note).toContain('created: "2026-11-22T01:02:03Z"'); expect(note).toContain('updated: "2026-11-22T02:03:04Z"');
  expect(note).toContain('tags: ["work","বাংলা"]'); expect(note).toContain("- [x] Done"); expect(note).toContain("- [ ] Next");
  expect(note).toContain("![Scan](resources/note-1/scan.png)"); expect(note).toContain("YWJj");
  expect(plan.entries["Export/resources/note-1/scan.png"]).toEqual(image); expect(decode(plan.entries["Sources/Export.enex"]!)).toBe(xml);
  expect(plan.warnings.some(warning => warning.includes("ciphertext"))).toBe(true);
});
it("strips only external XML doctypes while preserving quoted > and CDATA examples", () => {
  const xml = '<!DOCTYPE en-export SYSTEM "https://example.invalid/a>b"><en-export><![CDATA[<!DOCTYPE literal>]]></en-export>';
  expect(stripImportDoctypes(xml)).toBe('<en-export><![CDATA[<!DOCTYPE literal>]]></en-export>');
  for (const source of ['<!DOCTYPE x [<!ENTITY a "value">]><x/>', '<!ENTITY x "value"><x/>', '<!DOCTYPE x', '<!-- unfinished', '<![CDATA[unfinished']) expect(() => stripImportDoctypes(source)).toThrow();
});
it("refuses malformed exports and unsupported bundle metadata before any write phase", async () => {
  expect(() => planNoteImport("evernote", { "x.enex": bytes('<en-export><note><title>x</title></en-export>') })).toThrow("invalid XML");
  expect(() => planNoteImport("bear", { "Bad.textbundle/text.markdown": bytes("Words") })).toThrow("whole TextBundle");
  expect(() => planNoteImport("bear", { "Bad.textbundle/info.json": bytes('{"version":2,"type":"org.fountain"}'), "Bad.textbundle/text.txt": bytes("Words") })).toThrow("Markdown or plain text");
  expect(() => planNoteImport("notion", { "broken.md": new Uint8Array([0xff]) })).toThrow("UTF-8");
  expect(() => planNoteImport("notion", { "../outside.md": bytes("No") })).toThrow("unsafe path");
  expect(() => planNoteImport("bear", { "only.pdf": bytes("Attachment") })).toThrow("No supported notes");
  await expect(readNoteImport("bear", [input("a.md", bytes("One")), input("a.md", bytes("Two"))])).rejects.toThrow("Duplicate paths");
});

it("preserves literal HTML text, nested quoted/list code and table code without introducing formatting", () => {
  const plan = planNoteImport("apple-notes", { "literal.html": bytes('<h1>Literal</h1><p>1. literal</p><p>---</p><p>&amp;copy; $x$ ~~word~~</p><blockquote><pre>one\n\n\nthree\n</pre></blockquote><ul><li><pre>alpha\n\n\nbeta</pre></li></ul><table><tr><th>Code</th></tr><tr><td><pre>a|`b`\n&lt;tag&gt;</pre></td></tr></table>') });
  const note = decode(plan.entries["literal.md"]!);
  expect(note).toContain("1\\. literal"); expect(note).toContain("\\---"); expect(note).toContain("&amp;copy; \\$x\\$ \\~\\~word\\~\\~");
  expect(note).toContain("> ```\n> one\n> \n> \n> three\n> ```");
  expect(note).toContain("- ```\n  alpha\n  \n  \n  beta\n  ```");
  expect(note).toContain("<code>a&#124;&#96;b&#96;<br>&#60;tag&#62;</code>");
});
it("escapes generated link destinations and keeps unsafe or missing links visible as warnings", () => {
  const html = '<h1>Links</h1><p><a href="https://example.com/a)![bad](https://bad.invalid)&amp;copy;">Safe label</a></p><a href="javascript:bad()">Keep words</a><img src="missing.png" alt="Missing">';
  const plan = planNoteImport("apple-notes", { "links.html": bytes(html) });
  const note = decode(plan.entries["links.md"]!);
  expect(note).toContain("https://example.com/a%29!%5Bbad%5D%28https://bad.invalid%29&amp;copy;");
  expect(note).toContain("Keep words"); expect(note).not.toContain("javascript:");
  expect(plan.warnings.some(warning => warning.includes("missing.png"))).toBe(true);
});
it("admits colon titles only through the converting importer and keeps the ordinary archive policy", async () => {
  const archive = zipSync({ [`Meeting: Plan ${first}.md`]: bytes("# Meeting"), "Home.md": bytes(`[Meeting](Meeting%3A%20Plan%20${first}.md)`) });
  await expect(readBrowserArchive(archive)).rejects.toThrow("Invalid workspace path");
  const plan = await readNoteImport("notion", [input("notion.zip", archive)]);
  expect(plan.notes).toContain("Meeting- Plan.md"); expect(decode(plan.entries["Home.md"]!)).toContain("[Meeting](Meeting-%20Plan.md)");
});
it("rejects duplicate ZIP entries before an overwritten archive member could disappear", async () => {
  const archive = zipSync({ "a.md": bytes("First"), "b.md": bytes("Second") });
  for (let index = 0; index + 4 <= archive.length; index++) if (archive[index] === 98 && archive[index + 1] === 46 && archive[index + 2] === 109 && archive[index + 3] === 100) archive[index] = 97;
  await expect(readBrowserArchive(archive)).rejects.toThrow("Duplicate paths");
  await expect(readNoteImport("notion", [input("duplicate.zip", archive)])).rejects.toThrow("Duplicate paths");
});

it("does not rebind an HTML link through a second page that happens to have its rewritten name", () => {
  const plan = planNoteImport("notion", { [`Home ${first}.html`]: bytes(`<h1>Home</h1><a href="B%20${second}.html">B</a>`), [`B ${second}.html`]: bytes("<h1>Imported B</h1>"), "B.md": bytes("# Separate B") });
  expect(decode(plan.entries["Home.md"]!)).toContain("[B](B.md)");
  expect(decode(plan.entries["B.md"]!)).toContain("Imported B"); expect(decode(plan.entries["B (2).md"]!)).toBe("# Separate B");
});
it("keeps imported configuration inside a renamed notebook subtree", () => {
  const plan = planNoteImport("notion", { "Note.md": bytes("# Note"), ".slate/keymap.json": bytes('{"version":1}') });
  expect(plan.entries["_.slate/keymap.json"]).toEqual(bytes('{"version":1}')); expect(plan.entries[".slate/keymap.json"]).toBeUndefined();
});
it("bounds pathological ragged tables before expanding their missing cells", () => {
  const csv = "a,".repeat(1000) + "a\n" + "x\n".repeat(1000);
  expect(() => planNoteImport("notion", { "database.csv": bytes(csv) })).toThrow("too many cells");
});
