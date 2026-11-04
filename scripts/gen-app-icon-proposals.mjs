// App icon redesign proposals — 4 design directions x 6 palettes.
// Renders review sheets on dark + light backgrounds so sizes/contrast are honest.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "design-review", "app-icon");
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let t = crc32.t;
  if (!t) {
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
const cov = (d) => Math.min(1, Math.max(0, 0.5 - d));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const put = (buf, i, rgb, a) => {
  if (a <= 0) return;
  const ia = buf[i + 3] / 255;
  const outA = a + ia * (1 - a);
  if (outA <= 0) return;
  buf[i] = (rgb[0] * a + buf[i] * ia * (1 - a)) / outA;
  buf[i + 1] = (rgb[1] * a + buf[i + 1] * ia * (1 - a)) / outA;
  buf[i + 2] = (rgb[2] * a + buf[i + 2] * ia * (1 - a)) / outA;
  buf[i + 3] = outA * 255;
};

const P = {
  classic: { a: [0x4f, 0x46, 0xe5], b: [0x93, 0x33, 0xea] },
  emerald: { a: [0x05, 0x9f, 0x69], b: [0x0d, 0x94, 0x88] },
  sunset:  { a: [0xf9, 0x73, 0x16], b: [0xec, 0x48, 0x99] },
  ocean:   { a: [0x25, 0x63, 0xeb], b: [0x06, 0xb6, 0xd4] },
  mono:    { a: [0x2b, 0x2b, 0x31], b: [0x17, 0x17, 0x1c] },
  pearl:   { a: [0xf4, 0xf4, 0xf8], b: [0xd8, 0xd8, 0xe6] },
};
const WHITE = [255, 255, 255];

// ============ Design 1: "Squircle + clipboard" (modern app tile) ============
// Flat squircle with a diagonal gradient, large white clipboard with
// overhanging clip — the current icon's geometry but with much better
// proportions and softer corners.
function draw1(size, pal) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 256;
  const cx = size / 2;
  const corner = size * 0.228; // iOS squircle-ish radius
  const bodyHw = 52 * s, bodyHh = 66 * s, bodyR = 16 * s;
  const bodyCy = cx + 8 * s;
  const clipHw = 34 * s, clipHh = 11 * s, clipR = 5.5 * s;
  const clipCy = bodyCy - bodyHh + clipHh * 0.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const i = (y * size + x) * 4;
      const dT = sdRoundRect(px, py, cx, cx, size / 2 - 2 * s, size / 2 - 2 * s, corner);
      const aT = cov(dT);
      if (aT <= 0) { rgba[i + 3] = 0; continue; }
      const t = Math.min(1, Math.max(0, (px + py) / (size * 2)));
      const bg = mix(pal.a, pal.b, t);
      put(rgba, i, bg, aT);

      const dClip = sdRoundRect(px, py, cx, clipCy, clipHw, clipHh, clipR);
      const aClip = cov(dClip);
      const dBody = sdRoundRect(px, py, cx, bodyCy, bodyHw, bodyHh, bodyR);
      const aBody = cov(dBody);
      const glyph = Math.max(aBody, aClip);
      if (glyph > 0) put(rgba, i, WHITE, glyph);
      for (const L of [
        { cy: bodyCy - 20 * s, hw: 24 * s },
        { cy: bodyCy - 2 * s, hw: 24 * s },
        { cy: bodyCy + 16 * s, hw: 14 * s },
      ]) {
        const dL = sdRoundRect(px, py, cx, L.cy, L.hw, 5 * s, 2.5 * s);
        put(rgba, i, bg, cov(dL) * aBody);
      }
    }
  }
  return rgba;
}

// ============ Design 2: "Layered history" (two offset cards, no tile) ============
// Glassy rounded tile as backdrop is dropped; two stacked rounded cards
// back card accent + front card white with lines — reads as "history".
function draw2(size, pal) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 256;
  const cx = size / 2;
  const cy = size / 2;
  const hw = 62 * s, hh = 80 * s, r = 18 * s;
  const off = 20 * s;
  const accent = mix(pal.a, pal.b, 0.5);
  const accentDark = mix(accent, [0x00, 0x00, 0x20], 0.35);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const i = (y * size + x) * 4;
      // back card (accent, offset up-right)
      const dBack = sdRoundRect(px, py, cx + off * 0.55, cy - off * 0.55, hw, hh, r);
      put(rgba, i, accent, cov(dBack));
      // front card white
      const dFront = sdRoundRect(px, py, cx, cy, hw, hh, r);
      put(rgba, i, WHITE, cov(dFront));
      for (const L of [
        { cy: cy - 16 * s, hw: 32 * s },
        { cy: cy + 4 * s, hw: 32 * s },
        { cy: cy + 24 * s, hw: 20 * s },
      ]) {
        const dL = sdRoundRect(px, py, cx, L.cy, L.hw, 6 * s, 3 * s);
        put(rgba, i, accent, cov(dL) * cov(dFront));
      }
    }
  }
  return rgba;
}

// ============ Design 3: "Gradient clipboard" (glyph IS the icon) ============
// No tile, no white: the clipboard itself carries the gradient (clipped to
// its shape) with white lines and a white clip — vivid and unmistakable.
function draw3(size, pal) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 256;
  const cx = size / 2;
  const bodyHw = 64 * s, bodyHh = 84 * s, bodyR = 20 * s;
  const bodyCy = cx + 6 * s;
  const clipHw = 38 * s, clipHh = 14 * s, clipR = 7 * s;
  const clipCy = bodyCy - bodyHh + clipHh * 0.15;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const i = (y * size + x) * 4;
      const dClip = sdRoundRect(px, py, cx, clipCy, clipHw, clipHh, clipR);
      const aClip = cov(dClip);
      const dBody = sdRoundRect(px, py, cx, bodyCy, bodyHw, bodyHh, bodyR);
      const aBody = cov(dBody);
      if (aBody <= 0 && aClip <= 0) { rgba[i + 3] = 0; continue; }
      const t = Math.min(1, Math.max(0, (px + py) / (size * 2)));
      const g = mix(pal.a, pal.b, t);
      put(rgba, i, g, Math.max(aBody, aClip));
      put(rgba, i, WHITE, aClip); // clip stays white for contrast
      for (const L of [
        { cy: bodyCy - 24 * s, hw: 30 * s },
        { cy: bodyCy - 2 * s, hw: 30 * s },
        { cy: bodyCy + 20 * s, hw: 18 * s },
      ]) {
        const dL = sdRoundRect(px, py, cx, L.cy, L.hw, 7 * s, 3.5 * s);
        put(rgba, i, WHITE, cov(dL) * aBody);
      }
    }
  }
  return rgba;
}

// ============ Design 4: "Deep glass" (dark tile + gradient clipboard) ========
// Dark navy squircle, gradient clipboard glyph, white clip — premium look,
// strong on both taskbars and in the start menu grid.
function draw4(size, pal) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 256;
  const cx = size / 2;
  const corner = size * 0.228;
  const bodyHw = 56 * s, bodyHh = 72 * s, bodyR = 18 * s;
  const bodyCy = cx + 8 * s;
  const clipHw = 34 * s, clipHh = 12 * s, clipR = 6 * s;
  const clipCy = bodyCy - bodyHh + clipHh * 0.2;
  const navyA = [0x1e, 0x1e, 0x2e], navyB = [0x14, 0x14, 0x1f];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const i = (y * size + x) * 4;
      const dT = sdRoundRect(px, py, cx, cx, size / 2 - 2 * s, size / 2 - 2 * s, corner);
      const aT = cov(dT);
      if (aT <= 0) { rgba[i + 3] = 0; continue; }
      const t = Math.min(1, Math.max(0, (px + py) / (size * 2)));
      put(rgba, i, mix(navyA, navyB, t), aT);

      const dClip = sdRoundRect(px, py, cx, clipCy, clipHw, clipHh, clipR);
      const aClip = cov(dClip);
      const dBody = sdRoundRect(px, py, cx, bodyCy, bodyHw, bodyHh, bodyR);
      const aBody = cov(dBody);
      const tt = Math.min(1, Math.max(0, (px + py) / (size * 2)));
      const g = mix(pal.a, pal.b, tt);
      const glyph = Math.max(aBody, aClip);
      if (glyph > 0) put(rgba, i, g, glyph);
      put(rgba, i, WHITE, aClip);
      for (const L of [
        { cy: bodyCy - 20 * s, hw: 26 * s },
        { cy: bodyCy - 2 * s, hw: 26 * s },
        { cy: bodyCy + 16 * s, hw: 16 * s },
      ]) {
        const dL = sdRoundRect(px, py, cx, L.cy, L.hw, 5.5 * s, 2.75 * s);
        put(rgba, i, WHITE, cov(dL) * aBody);
      }
    }
  }
  return rgba;
}

const DESIGNS = [
  ["1-squircle", draw1],
  ["2-layered", draw2],
  ["3-gradient-glyph", draw3],
  ["4-deep-glass", draw4],
];

// 64px standalone renders
for (const [name, draw] of DESIGNS) {
  for (const palName of Object.keys(P)) {
    writeFileSync(join(outDir, `${name}-${palName}.png`), encodePng(64, 64, draw(64, P[palName])));
  }
}

// Review sheet: 4 rows (designs) x 6 cols (palettes) at 96px on neutral bg
const pad = 18;
const cell = 96;
const cols = 6;
const W = pad + cols * (cell + 10) + pad;
const H = pad + DESIGNS.length * (cell + 26) + pad;
const sheet = Buffer.alloc(W * H * 4);
sheet.fill(0x2a, 0, sheet.length); sheet.fill(255, 3, sheet.length, 4);
// mid gray so both white and colored shapes read honestly
sheet.fill(0x55, 0, sheet.length, 4);
sheet.fill(0xff, 3, sheet.length, 4);

DESIGNS.forEach(([name, draw], row) => {
  Object.keys(P).forEach((palName, col) => {
    const icon = draw(cell, P[palName]);
    const ox = pad + col * (cell + 10);
    const oy = pad + row * (cell + 26) + 14;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const si = (y * cell + x) * 4;
        const di = ((oy + y) * W + ox + x) * 4;
        put(sheet, di, [icon[si], icon[si + 1], icon[si + 2]], icon[si + 3] / 255);
      }
  });
});
writeFileSync(join(outDir, "app-icon-review.png"), encodePng(W, H, sheet));
console.log("written to", outDir);
