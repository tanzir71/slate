// ENML identifies attached resources by the MD5 of their binary body (RFC 1321).
const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]] as const;
const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);

function block(state: Uint32Array, view: DataView, offset: number) {
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!;
  for (let index = 0; index < 64; index++) {
    const round = Math.floor(index / 16);
    const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
    const word = round === 0 ? index : round === 1 ? (5 * index + 1) % 16 : round === 2 ? (3 * index + 5) % 16 : (7 * index) % 16;
    const value = (a + f + constants[index]! + view.getUint32(offset + word * 4, true)) | 0;
    const shift = shifts[round]![index % 4]!;
    const next = (b + ((value << shift) | (value >>> (32 - shift)))) | 0;
    a = d; d = c; c = b; b = next;
  }
  state[0] = (state[0]! + a) >>> 0; state[1] = (state[1]! + b) >>> 0;
  state[2] = (state[2]! + c) >>> 0; state[3] = (state[3]! + d) >>> 0;
}

/** Match an ENEX resource to its en-media hash, without copying the whole attachment. */
export function importResourceHash(bytes: Uint8Array): string {
  const state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  for (; offset + 64 <= bytes.length; offset += 64) block(state, view, offset);
  const remaining = bytes.subarray(offset), tail = new Uint8Array(remaining.length < 56 ? 64 : 128);
  tail.set(remaining); tail[remaining.length] = 0x80;
  const last = new DataView(tail.buffer);
  last.setUint32(tail.length - 8, (bytes.length * 8) >>> 0, true);
  last.setUint32(tail.length - 4, Math.floor(bytes.length / 0x20000000), true);
  for (let index = 0; index < tail.length; index += 64) block(state, last, index);
  return Array.from(state).map(word => [0, 8, 16, 24].map(shift => ((word >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
}
