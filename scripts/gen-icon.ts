#!/usr/bin/env bun
/**
 * Generates a valid solid-color source PNG for the Tauri app icon, then you can
 * run `bunx tauri icon <out>` to produce the full platform icon set. This is a
 * placeholder brand mark (geins teal) — replace the source PNG with real art.
 *
 * Usage: bun run scripts/gen-icon.ts [outfile] [size]
 */
import { deflateSync } from 'node:zlib';

const out = process.argv[2] ?? 'src-tauri/icons/source.png';
const size = parseInt(process.argv[3] ?? '1024', 10);

// geins teal
const [r, g, b, a] = [127, 219, 202, 255];

// Raw image data: each row is a filter byte (0 = none) + RGBA pixels.
const row = Buffer.alloc(1 + size * 4);
row[0] = 0;
for (let x = 0; x < size; x++) {
  const o = 1 + x * 4;
  row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = a;
}
const raw = Buffer.concat(Array.from({ length: size }, () => row));

// CRC32 (PNG polynomial).
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression / filter / interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

await Bun.write(out, png);
console.log(`✓ wrote ${out} (${size}x${size})`);
