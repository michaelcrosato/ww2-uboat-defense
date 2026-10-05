// Home-screen icons for the web app manifest: the favicon's 16×16 pixel-art U-boat, enlarged by whole
// pixels into PNGs (no image libraries; node:zlib does the deflate and CRC).
//   node tools/icons.mjs   → public/icon-192.png, public/icon-512.png
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const C = {
  '.': [11, 16, 24], m: [232, 220, 160], s: [152, 160, 162], h: [140, 147, 150], l: [180, 187, 189],
  w: [42, 90, 102], o: [22, 50, 59], g: [80, 140, 150],
};
// 16 rows × 16 columns; the boat sits in the middle 80 % so a maskable crop keeps it whole
const ART = [
  '................',
  '................',
  '............mm..',
  '............mm..',
  '.......s........',
  '.......s........',
  '......sss.......',
  '......sss.......',
  '.....ssss.......',
  '..llllllllllll..',
  '..hhhhhhhhhhhh..',
  'wwwwwwwwwwwwwwww',
  'oooogoooooooogoo',
  'oooooooogooooooo',
  'oogooooooooooooo',
  'oooooooooooogooo',
];

function png(size) {
  const k = size / 16, row = size * 4 + 1, raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;   // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = C[ART[Math.floor(y / k)][Math.floor(x / k)]];
      raw.set([r, g, b, 255], y * row + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);   // 8-bit RGBA, deflate, no interlace
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) { writeFileSync(`public/icon-${s}.png`, png(s)); console.log(`public/icon-${s}.png`); }
