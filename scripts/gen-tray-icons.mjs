// Generates the tray icon variant set: src-tauri/icons/tray/<name>.png
// Same clipboard glyph as the app icon, different palettes/surfaces tuned
// for readability on light and dark taskbars.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons", "tray");
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

const PALETTES = {
  classic: { from: [0x4f, 0x46, 0xe5], to: [0x93, 0x33, 0xea], glyph: [255, 255, 255], line: "bg" },
  emerald: { from: [0x05, 0x9f, 0x69], to: [0x0d, 0x94, 0x88], glyph: [255, 255, 255], line: "bg" },
  sunset:  { from: [0xf9, 0x73, 0x16], to: [0xec, 0x48, 0x99], glyph: [255, 255, 255], line: "bg" },
  ocean:   { from: [0x25, 0x63, 0xeb], to: [0x06, 0xb6, 0xd4], glyph: [255, 255, 255], line: "bg" },
  mono:    { from: [0x2b, 0x2b, 0x31], to: [0x17, 0x17, 0x1c], glyph: [245, 245, 248], line: "bg" },
  pearl:   { from: [0xf4, 0xf4, 0xf8], to: [0xd8, 0xd8, 0xe6], glyph: [255, 255, 255], line: [0x4f, 0x46, 0xe5] },
};

function render(size, pal) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 64;
  const half = size / 2;
  const corner = 12 * s;

  // clipboard glyph geometry (half-widths, centered on the tile)
  const bodyHw = 14 * s, bodyHh = 19 * s, bodyR = 4.5 * s;
  const clipHw = 7.5 * s, clipHh = 3 * s, clipR = 1.5 * s;
  const bodyCy = 34 * s;
  const clipCy = bodyCy - bodyHh - clipHh + 1 * s;
  const lines = [
    { cy: bodyCy - 7 * s, hw: 7.5 * s },
    { cy: bodyCy - 0.5 * s, hw: 7.5 * s },
    { cy: bodyCy + 6 * s, hw: 5 * s },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5, py = y + 0.5;

      const dBg = sdRoundRect(px, py, half, half, half - 1 * s, half - 1 * s, corner);
      const aBg = Math.min(1, Math.max(0, 0.5 - dBg));
      if (aBg <= 0) { rgba[i + 3] = 0; continue; }

      // diagonal gradient across the tile (saved: content lines reuse it)
      const t = Math.min(1, Math.max(0, (px + py) / (size * 2)));
      const bgR = pal.from[0] + (pal.to[0] - pal.from[0]) * t;
      const bgG = pal.from[1] + (pal.to[1] - pal.from[1]) * t;
      const bgB = pal.from[2] + (pal.to[2] - pal.from[2]) * t;
      let r = bgR, g = bgG, b = bgB;

      // clipboard body + top clip
      const dBody = sdRoundRect(px, py, half, bodyCy, bodyHw, bodyHh, bodyR);
      const aBody = Math.min(1, Math.max(0, 0.5 - dBody));
      const dClip = sdRoundRect(px, py, half, clipCy, clipHw, clipHh, clipR);
      const aClip = Math.min(1, Math.max(0, 0.5 - dClip));
      const glyph = Math.max(aBody, aClip);

      if (glyph > 0) {
        r = pal.glyph[0] * glyph + r * (1 - glyph);
        g = pal.glyph[1] * glyph + g * (1 - glyph);
        b = pal.glyph[2] * glyph + b * (1 - glyph);
      }

      // content lines: bg gradient showing through (pearl: indigo accents)
      for (const L of lines) {
        const dL = sdRoundRect(px, py, half, L.cy, L.hw, 1.4 * s, 0.7 * s);
        const aL = Math.min(1, Math.max(0, 0.5 - dL)) * (aBody > 0.5 ? 1 : 0);
        if (aL > 0) {
          const lc = pal.line === "bg" ? [bgR, bgG, bgB] : pal.line;
          r = lc[0] * aL + r * (1 - aL);
          g = lc[1] * aL + g * (1 - aL);
          b = lc[2] * aL + b * (1 - aL);
        }
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(aBg * 255);
    }
  }
  return encodePng(size, size, rgba);
}

for (const [name, pal] of Object.entries(PALETTES)) {
  writeFileSync(join(outDir, `${name}.png`), render(64, pal));
  console.log("wrote", name);
}
console.log("tray icons ->", outDir);
