// Generates src-tauri/icons/icon.png + icon.ico without external deps.
// Design: rounded square, indigo→violet gradient, white clipboard glyph.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// rounded-rect signed distance
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 256;
  const clip = 22 * s; // corner radius
  const half = 128 * s;

  // clipboard body rect (white) and top clip
  const bw = 60 * s, bh = 84 * s, br = 12 * s;
  const bcy = 136 * s;
  const cw = 34 * s, ch = 14 * s, cr = 6 * s;
  const cy = bcy - bh / 2 - 2 * s;

  // three "content lines" inside the clipboard
  const lines = [
    { w: 64 * s, y: bcy - 26 * s },
    { w: 64 * s, y: bcy - 6 * s },
    { w: 40 * s, y: bcy + 14 * s },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = sdRoundRect(x + 0.5, y + 0.5, half, half, half - 2 * s, half - 2 * s, clip);
      let a = Math.min(1, Math.max(0, 0.5 - d));
      if (a <= 0) { rgba[i + 3] = 0; continue; }

      // gradient indigo #4f46e5 → violet #9333ea (diagonal)
      const t = Math.min(1, Math.max(0, (x + y) / (size * 2)));
      let r = Math.round(0x4f + (0x93 - 0x4f) * t);
      let g = Math.round(0x46 + (0x33 - 0x46) * t);
      let b = Math.round(0xe5 + (0xea - 0xe5) * t);

      // white clipboard body
      const db = sdRoundRect(x + 0.5, y + 0.5, half, bcy, bw, bh, br);
      const ab = Math.min(1, Math.max(0, 0.5 - db));
      // top clip
      const dc = sdRoundRect(x + 0.5, y + 0.5, half, cy, cw, ch, cr);
      const ac = Math.min(1, Math.max(0, 0.5 - dc));
      const white = Math.max(ab, ac);

      if (white > 0) {
        r = Math.round(255 * white + r * (1 - white));
        g = Math.round(255 * white + g * (1 - white));
        b = Math.round(255 * white + b * (1 - white));
      }

      // content lines (gradient color, over white body)
      let line = 0;
      for (const L of lines) {
        const dl = sdRoundRect(x + 0.5, y + 0.5, half, L.y, L.w, 5 * s, 2.5 * s);
        line = Math.max(line, Math.min(1, Math.max(0, 0.5 - dl)) * (ab > 0.5 ? 1 : 0));
      }
      if (line > 0) {
        r = Math.round(r * line + 255 * (1 - line));
        g = Math.round(g * line + 255 * (1 - line));
        b = Math.round(b * line + 255 * (1 - line));
      }

      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const png256 = render(256);
writeFileSync(join(outDir, "icon.png"), png256);
writeFileSync(join(outDir, "icon@2x.png"), png256); // tauri convention
writeFileSync(join(outDir, "32x32.png"), render(32));
writeFileSync(join(outDir, "128x128.png"), render(128));

// ICO with embedded PNG (Vista+)
function makeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256 => 0
  entry[1] = 0;
  entry[2] = 0; // colors
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, entry, png]);
}
writeFileSync(join(outDir, "icon.ico"), makeIco(png256));
console.log("icons written to", outDir);
