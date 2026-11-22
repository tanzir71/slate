import { createHash } from "node:crypto";
import { exportBrowserArchive } from "../packages/storage/src/browserArchive";

export const sourceImportCases = [
  { id: "bear", heading: "From Bear", note: "Bear note/Bear note.md", image: "Bear note/assets/pixel.png" },
  { id: "notion", heading: "From Notion", note: "Parent.md", image: "Parent/pixel.png" },
  { id: "ulysses", heading: "From Ulysses", note: "Draft/Draft.md", image: "Draft/assets/pixel.png" },
  { id: "evernote", heading: "From Evernote", note: "Export/From Evernote.md", image: "Export/resources/note-1/pixel.png" },
  { id: "apple-notes", heading: "From Apple", note: "Apple.md", image: "assets/pixel.png" },
] as const;
const uuid = "12345678123412341234123456789abc", other = "22345678123412341234123456789abc";
export const importPixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6V8AAAAASUVORK5CYII=", "base64");
export async function sourceImportFixture(id: (typeof sourceImportCases)[number]["id"]) {
  const entries: Record<string, Uint8Array> = {};
  if (id === "bear") {
    entries["Bear note.textbundle/info.json"] = Buffer.from('{"version":2,"type":"net.daringfireball.markdown"}');
    entries["Bear note.textbundle/text.markdown"] = Buffer.from("\ufeff# From Bear\r\n\r\n![Pixel](assets/pixel.png)\r\n");
    entries["Bear note.textbundle/assets/pixel.png"] = importPixel;
  } else if (id === "notion") {
    entries[`Parent ${uuid}.md`] = Buffer.from(`# From Notion\n\n[Child](Parent%20${uuid}/Child%20${other}.md)\n![Pixel](Parent%20${uuid}/pixel.png)\n`);
    entries[`Parent ${uuid}/Child ${other}.md`] = Buffer.from("# Child\n\nSecond imported page.\n");
    entries[`Parent ${uuid}/pixel.png`] = importPixel;
    entries[".slate/keymap.json"] = Buffer.from('{"unexpected":"Imported settings stay in their notebook"}');
  } else if (id === "ulysses") {
    entries["info.json"] = Buffer.from('{"version":2,"type":"net.daringfireball.markdown"}');
    entries["text.markdown"] = Buffer.from("# From Ulysses\n\n![Pixel](assets/pixel.png)\n"); entries["assets/pixel.png"] = importPixel;
  } else if (id === "evernote") {
    const hash = createHash("md5").update(importPixel).digest("hex");
    const content = `<en-note><div>Saved Evernote words.</div><div><en-todo checked="true"/>Done</div><en-media hash="${hash}" type="image/png" alt="Pixel"/></en-note>`;
    const xml = `<?xml version="1.0"?><!DOCTYPE en-export SYSTEM "https://export.invalid/never.dtd"><en-export><note><title>From Evernote</title><content><![CDATA[${content}]]></content><created>20261122T010203Z</created><tag>imported</tag><resource><data encoding="base64">${importPixel.toString("base64")}</data><mime>image/png</mime><resource-attributes><file-name>pixel.png</file-name></resource-attributes></resource></note></en-export>`;
    return { name: "Export.enex", mimeType: "application/xml", buffer: Buffer.from(xml) };
  } else {
    entries["Apple.html"] = Buffer.from('<!doctype html><h1>From Apple</h1><p>Local <b>bold</b> writing.</p><img src="assets/pixel.png" alt="Pixel"><img src="https://export.invalid/image.png" alt="Remote"><iframe src="https://export.invalid/frame"></iframe><script>globalThis.sourceImportExecuted = true;</script>');
    entries["assets/pixel.png"] = importPixel;
  }
  const zip = await exportBrowserArchive({ list: async () => Object.keys(entries), read: async path => entries[path] });
  return { name: id === "ulysses" ? "Draft.textpack" : "Export.zip", mimeType: "application/zip", buffer: Buffer.from(zip) };
}
