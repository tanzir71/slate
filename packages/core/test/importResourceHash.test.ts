import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { importResourceHash } from "../src/importResourceHash";

it.each([
  ["", "d41d8cd98f00b204e9800998ecf8427e"], ["a", "0cc175b9c0f1b6a831c399e269772661"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"], ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
  ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
  ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
  ["1234567890".repeat(8), "57edf4a22be3c955ac49da2e2107b67a"],
])("matches the RFC1321 resource identifier for %j", (source, expected) => {
  expect(importResourceHash(new TextEncoder().encode(source))).toBe(expected);
});
it("matches independent binary hashes across block/padding boundaries and subarray offsets", () => {
  for (const length of [1, 7, 31, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 4096, 10000]) {
    const backing = Uint8Array.from({ length: length + 17 }, (_, index) => (index * 37 + 191) % 256), bytes = backing.subarray(13, length + 13);
    const before = backing.slice();
    expect(importResourceHash(bytes), String(length)).toBe(createHash("md5").update(bytes).digest("hex"));
    expect(backing).toEqual(before);
  }
});
