// Generates monochrome "mixer faders" PNG icons for the plugin/category/action
// (Stream Deck action-list icons must be PNG). Pure Node — rasterizes simple
// shapes and encodes PNG with the built-in zlib. Run: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const IMG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fun.hiyoko.volumemixer.sdPlugin", "imgs");

const WHITE = [244, 244, 245, 255];
const DARK = [13, 13, 15, 255];

function canvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function setPx(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  c.data[i] = r; c.data[i + 1] = g; c.data[i + 2] = b; c.data[i + 3] = a;
}

function fillRoundRect(c, x0, y0, w, h, rad, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = x < x0 + rad ? x0 + rad - x : x > x0 + w - 1 - rad ? x - (x0 + w - 1 - rad) : 0;
      const dy = y < y0 + rad ? y0 + rad - y : y > y0 + h - 1 - rad ? y - (y0 + h - 1 - rad) : 0;
      if (dx * dx + dy * dy <= rad * rad) setPx(c, x, y, color);
    }
  }
}

function fillCircle(c, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) setPx(c, x, y, color);
    }
  }
}

function drawFaders(c, withBackground) {
  const S = c.size;
  if (withBackground) fillRoundRect(c, 0, 0, S, S, Math.round(S * 0.22), DARK);
  const cols = [0.28, 0.5, 0.72];
  const knobLevel = [0.62, 0.4, 0.3];
  const barW = Math.max(2, Math.round(S * 0.06));
  const top = Math.round(S * 0.18);
  const bottom = Math.round(S * 0.82);
  const knobR = Math.round(S * 0.105);
  for (let i = 0; i < cols.length; i++) {
    const x = Math.round(cols[i] * S);
    fillRoundRect(c, x - Math.floor(barW / 2), top, barW, bottom - top, Math.floor(barW / 2), WHITE);
    const ky = Math.round(knobLevel[i] * S);
    if (withBackground) fillCircle(c, x, ky, knobR + Math.max(1, Math.round(S * 0.02)), DARK);
    fillCircle(c, x, ky, knobR, WHITE);
  }
}

function encodePng(c) {
  const { size, data } = c;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw);

  const table = [];
  for (let n = 0; n < 256; n++) {
    let c2 = n;
    for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 0xedb88320 ^ (c2 >>> 1) : c2 >>> 1;
    table[n] = c2 >>> 0;
  }
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0);
    return Buffer.concat([len, typeBuf, body, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function write(name, size, withBackground) {
  const c = canvas(size);
  drawFaders(c, withBackground);
  writeFileSync(join(IMG_DIR, name), encodePng(c));
  console.log("wrote", name, `${size}x${size}`);
}

// base + @2x for each icon. Plugin icon has a dark rounded background.
for (const [base, bg] of [["category-icon", false], ["action-icon", false], ["plugin-icon", true], ["key", null]]) {
  if (base === "key") continue;
  write(`${base}.png`, 72, bg);
  write(`${base}@2x.png`, 144, bg);
}
