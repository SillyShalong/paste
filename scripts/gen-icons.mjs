// Generates every icon from SVG design sources:
//   src-tauri/icons/app-icon.png        1024px app-icon source (run `npx tauri icon` on it
//                                       to produce icon.icns / icon.ico / the PNG set)
//   public/app-icon.png                 512px preview shown in Settings → About
//   src-tauri/icons/tray/<name>.png     64px tray variants (IDs must match AppSettings.tray_icon)
//
// Design: layered translucent history cards behind a white clipboard with an
// accent clip — the "stack of things you copied" motif, shared by the app
// icon and every tray variant.
//
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Minimal PNG encoder (no dependencies) — same approach as the old script.
// ---------------------------------------------------------------------------
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

async function renderSvg(svg, size) {
  // Render at 4× and downscale with Lanczos for crisp small-size antialiasing.
  const ss = await sharp(Buffer.from(svg), { density: 384 })
    .resize(size * 4, size * 4)
    .png()
    .toBuffer();
  return sharp(ss).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
}

async function writePngRaw(path, size, svg) {
  const { data, info } = await sharp(await renderSvg(svg, size))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  writeFileSync(path, encodePng(info.width, info.height, data));
  console.log("wrote", path);
}

async function writePng(path, size, svg) {
  writeFileSync(path, await renderSvg(svg, size));
  console.log("wrote", path);
}

// ---------------------------------------------------------------------------
// App icon (1024, macOS rounded-square tile)
// ---------------------------------------------------------------------------
function appIconSvg() {
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#5B54E8"/>
      <stop offset="55%" stop-color="#8A5CF6"/>
      <stop offset="100%" stop-color="#BC5CF0"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7C5CF6"/>
      <stop offset="100%" stop-color="#A855F7"/>
    </linearGradient>
    <radialGradient id="hl" cx="22%" cy="14%" r="75%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.20"/>
      <stop offset="60%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#180F42" flood-opacity="0.35"/>
    </filter>
    <clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <rect width="1024" height="1024" fill="url(#hl)"/>
    <rect x="392" y="352" width="380" height="500" rx="60" fill="#FFFFFF" opacity="0.38"/>
    <g filter="url(#shadow)">
      <rect x="252" y="270" width="400" height="510" rx="64" fill="#FFFFFF"/>
    </g>
    <rect x="386" y="226" width="132" height="104" rx="38" fill="url(#accent)"/>
    <rect x="424" y="266" width="56" height="24" rx="12" fill="#FFFFFF"/>
    <rect x="312" y="415" width="280" height="46" rx="23" fill="url(#accent)"/>
    <rect x="312" y="493" width="280" height="46" rx="23" fill="#C9CDE6"/>
    <rect x="312" y="571" width="280" height="46" rx="23" fill="#E2E5F2"/>
    <rect x="312" y="649" width="176" height="46" rx="23" fill="#EEF0F9"/>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Tray variants — bold glyph that survives 16px. Board carries the variant
// gradient, bars stay white (dark for the light "pearl" variant).
// ---------------------------------------------------------------------------
const TRAY_VARIANTS = [
  { id: "classic", c1: "#6C5CE7", c2: "#A45CF7", clip: "#5B4BD4", bar: "#FFFFFF" },
  { id: "emerald", c1: "#0EA371", c2: "#34D399", clip: "#0B8A60", bar: "#FFFFFF" },
  { id: "sunset",  c1: "#F97316", c2: "#FB7185", clip: "#E05E0F", bar: "#FFFFFF" },
  { id: "ocean",   c1: "#3B82F6", c2: "#22D3EE", clip: "#2F6FD4", bar: "#FFFFFF" },
  { id: "mono",    c1: "#424754", c2: "#23262F", clip: "#191C24", bar: "#FFFFFF" },
  { id: "pearl",   c1: "#F7F7FA", c2: "#E6E6EE", clip: "#D8D8E2", bar: "#262A35" },
];

function traySvg({ c1, c2, clip, bar }) {
  return `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect x="28" y="15" width="26" height="36" rx="6" fill="${c1}" opacity="0.4"/>
  <rect x="12" y="12" width="30" height="40" rx="7" fill="url(#g)"/>
  <rect x="21" y="8" width="12" height="11" rx="3.5" fill="${clip}"/>
  <rect x="17" y="24" width="20" height="4.5" rx="2.25" fill="${bar}"/>
  <rect x="17" y="32" width="20" height="4.5" rx="2.25" fill="${bar}" opacity="0.82"/>
  <rect x="17" y="40" width="13" height="4.5" rx="2.25" fill="${bar}" opacity="0.66"/>
</svg>`;
}

// ---------------------------------------------------------------------------
const trayDir = join(root, "src-tauri", "icons", "tray");
mkdirSync(trayDir, { recursive: true });

await writePngRaw(join(root, "src-tauri", "icons", "app-icon.png"), 1024, appIconSvg());
await writePng(join(root, "public", "app-icon.png"), 512, appIconSvg());
for (const v of TRAY_VARIANTS) {
  await writePngRaw(join(trayDir, `${v.id}.png`), 64, traySvg(v));
}
console.log("done — run `npx tauri icon src-tauri/icons/app-icon.png` for the platform set");
