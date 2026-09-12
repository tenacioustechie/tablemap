#!/usr/bin/env node
/**
 * Generates `e2e/fixtures/grid-map.png`: a 400×300 map with a printed grid
 * of 50 px squares offset (12, 7) from the top-left corner, matching
 * `src/test/gridFixture.ts`. Dependency-free (zlib + a minimal PNG writer)
 * so the fixture is reproducible from the repo.
 *
 *   npm run fixture:grid
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 400;
const HEIGHT = 300;
const CELL = 50;
const OFFSET_X = 12;
const OFFSET_Y = 7;
const BACKGROUND = [70, 60, 50];
const LINE = [255, 255, 255];

function isGridLine(p, offset) {
  return p >= offset && (p - offset) % CELL === 0;
}

// Raw scanlines: filter byte 0 + RGB per pixel.
const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x++) {
    const on = isGridLine(x, OFFSET_X) || isGridLine(y, OFFSET_Y);
    const [r, g, b] = on ? LINE : BACKGROUND;
    const i = row + 1 + x * 3;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
  }
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e", "fixtures", "grid-map.png");
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
