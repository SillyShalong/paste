// Tray icon redesign proposals: 3 design directions x 6 palettes.
// Renders review sheets (dark + light taskbar simulation) at real tray sizes.
// Nothing here touches the shipped icons until the user approves a design.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "design-review");
mkdirSync(outDir, { recursive: true });

// ---------- PNG encode ----------
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

// ---------- SDF ----------
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

const PALETTES = {
  classic: { a: [0x4f, 0x46, 0xe5], b: [0x93, 0x33, 0xea] },
  emerald: { a: [0x05, 0x9f, 0x69], b: [0x0d, 0x94, 0x88] },
  sunset:  { a: [0xf9, 0x73, 0x16], b: [0xec, 0x48, 0x99] },
  ocean:   { a: [0x25, 0x63, 0xeb], b: [0x06, 0xb6, 0xd4] },
  mono:    { a: [0x2b, 0x2b, 0x31], b: [0x17, 0x17, 0x1c] },
  pearl:   { a: [0xf4, 0xf4, 0xf8], b: [0xd8, 0xd8, 0xe6] },
};
const WHITE = [255, 255, 255];
const INDIGO = [0x4f, 0x46, 0xe5];
const DARK = [0x1c, 0x1c, 0x22];

// ---------- Design A: glyph-only clipboard, clip overhangs the top ----------
function drawA(size, pal, light) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 64;
  const cx = size / 2, cy = size / 2 + 2 * s;
  const bodyHw = 17 * s, bodyHh = 21 * s, bodyR = 5 * s;
  const clipHw = 11 * s, clipHh = 4.5 * s, clipR = 2 * s;
  const clipCy = cy - bodyHh + 1 * s; // straddles the body's top edge
  const accent = mix(pal.a, pal.b, 0.5);
  const dark = pal === PALETTES.pearl || pal === PALETTES.mono;
  const bodyCol = dark ? DARK : WHITE;
  const lineCol = dark ? WHITE : accent;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const i = (y * size + x) * 4;
      const dB = sdRoundRect(px, py, cx, cy, bodyHw, bodyHh, bodyR);
      const aB = cov(dB);
      const dC = sdRoundRect(px, py, cx, clipCy, clipHw, clipHh, clipR);
      const aC = cov(dC);
      if (aB <= 0 && aC <= 0) continue;
      // body white; clip accent on top of body
      put(rgba, i, bodyCol, aB);
      put(rgba, i, accent, aC);
      // content lines punched in accent color
      for (const L of [
        { cy: cy - 6 * s, hw: 9 * s },
        { cy: cy + 1 * s, hw: 9 * s },
        { cy: cy + 8 * s, hw: 5.5 * s },
      ]) {
        const dL = sdRoundRect(px, py, cx, L.cy, L.hw, 1.7 * s, 0.85 * s);
        put(rgba, i, lineCol, cov(dL) * aB);
      }
    }
  }
  return rgba;
}

// ---------- Design B: stacked history cards ----------
function drawB(size, pal, light) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 64;
  const cx = size / 2, cy = size / 2;
  const hw = 15 * s, hh = 19 * s, r = 4.5 * s;
  const off = 5 * s;
  const accent = mix(pal.a, pal.b, 0.5);
  const dark = pal === PALETTES.pearl || pal === PALETTES.mono;
  const frontCol = dark ? DARK : WHITE;
  const lineCol = dark ? WHITE : accent;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const i = (y * size + x) * 4;
      // back card (accent), offset up-right
      const dBack = sdRoundRect(px, py, cx + off * 0.6, cy - off * 0.6, hw, hh, r);
      put(rgba, i, accent, cov(dBack) * 0.85);
      // mid shadow card (darker accent) offset less
      const dMid = sdRoundRect(px, py, cx + off * 0.3, cy - off * 0.3, hw, hh, r);
      put(rgba, i, mix(accent, DARK, 0.25), cov(dMid));
      // front card white with lines
      const dFront = sdRoundRect(px, py, cx, cy, hw, hh, r);
      put(rgba, i, frontCol, cov(dFront));
      for (const L of [
        { cy: cy - 5 * s, hw: 8 * s },
        { cy: cy + 2 * s, hw: 8 * s },
        { cy: cy + 9 * s, hw: 5 * s },
      ]) {
        const dL = sdRoundRect(px, py, cx, L.cy, L.hw, 1.7 * s, 0.85 * s);
        put(rgba, i, lineCol, cov(dL) * cov(dFront));
      }
    }
  }
  return rgba;
}

// ---------- Design C: gradient tile + big clipboard, overhanging clip ----------
function drawC(size, pal) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 64;
  const cx = size / 2, cy = size / 2 + 1 * s;
  const tileHw = size / 2 - 1 * s, tileR = 12 * s;
  const bodyHw = 15 * s, bodyHh = 18 * s, bodyR = 4.5 * s;
  const clipHw = 10 * s, clipHh = 4 * s, clipR = 2 * s;
  const clipCy = cy - bodyHh + 1 * s;
  const accent = mix(pal.a, pal.b, 0.5);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const i = (y * size + x) * 4;
      const dT = sdRoundRect(px, py, size / 2, size / 2, tileHw, tileHw, tileR);
      const aT = cov(dT);
      if (aT <= 0) continue;
      const t = Math.min(1, Math.max(0, (px + py) / (size * 2)));
      const bg = mix(pal.a, pal.b, t);
      put(rgba, i, bg, aT);

      const dClip = sdRoundRect(px, py, cx, clipCy, clipHw, clipHh, clipR);
      const aClip = cov(dClip);
      const dBody = sdRoundRect(px, py, cx, cy, bodyHw, bodyHh, bodyR);
      const aBody = cov(dBody);
      const glyph = Math.max(aBody, aClip);
      if (glyph > 0) put(rgba, i, WHITE, glyph);
      for (const L of [
        { cy: cy - 5 * s, hw: 7.5 * s },
        { cy: cy + 2 * s, hw: 7.5 * s },
        { cy: cy + 9 * s, hw: 5 * s },
      ]) {
        const dL = sdRoundRect(px, py, cx, L.cy, L.hw, 1.6 * s, 0.8 * s);
        put(rgba, i, bg, cov(dL) * aBody);
      }
    }
  }
  return rgba;
}

// ---------- Review sheet ----------
const DESIGNS = [
  ["A glyph-clipboard", drawA],
  ["B stacked-cards", drawB],
  ["C tile-clipboard", drawC],
];

function composeSheet(bg, bgName) {
  const pad = 14;
  const cell = 34;
  const small = 18;
  const cols = 6;
  const rowH = cell + 18;
  const W = pad + cols * (cell + 10) + 30 + cols * (small + 8) + pad;
  const H = pad + DESIGNS.length * rowH + pad;
  const buf = Buffer.alloc(W * H * 4);
  buf.fill(bg[0]); buf.fill(bg[1], 1, buf.length, 4); buf.fill(bg[2], 2, buf.length, 4);
  buf.fill(255, 3, buf.length, 4);

  DESIGNS.forEach(([name, draw], row) => {
    const y0 = pad + row * rowH;
    Object.keys(PALETTES).forEach((palName, col) => {
      const pal = PALETTES[palName];
      // 34px cell
      {
        const icon = draw(cell, pal, bgName === "light");
        const ox = pad + col * (cell + 10);
        const oy = y0;
        for (let y = 0; y < cell; y++)
          for (let x = 0; x < cell; x++) {
            const si = (y * cell + x) * 4;
            const di = ((oy + y) * W + ox + x) * 4;
            put(buf, di, [icon[si], icon[si + 1], icon[si + 2]], icon[si + 3] / 255);
          }
      }
      // 18px cell (real tray size)
      {
        const icon = draw(small, pal, bgName === "light");
        const ox = pad + cols * (cell + 10) + 30 + col * (small + 8);
        const oy = y0 + Math.floor((cell - small) / 2);
        for (let y = 0; y < small; y++)
          for (let x = 0; x < small; x++) {
            const si = (y * small + x) * 4;
            const di = ((oy + y) * W + ox + x) * 4;
            put(buf, di, [icon[si], icon[si + 1], icon[si + 2]], icon[si + 3] / 255);
          }
      }
    });
  });
  return { buf, W, H };
}

for (const [bgName, bg] of [["dark", [0x20, 0x20, 0x24]], ["light", [0xf2, 0xf2, 0xf4]]]) {
  const { buf, W, H } = composeSheet(bg, bgName);
  const file = join(outDir, `tray-review-${bgName}.png`);
  writeFileSync(file, encodePng(W, H, buf));
  console.log("wrote", file);
}

// standalone 64px renders of every design+palette for closer inspection
for (const [name, draw] of DESIGNS) {
  for (const palName of Object.keys(PALETTES)) {
    const rgba = draw(64, PALETTES[palName], false);
    writeFileSync(join(outDir, `${name[0]}-${palName}.png`), encodePng(64, 64, rgba));
  }
}
console.log("proposals in", outDir);
