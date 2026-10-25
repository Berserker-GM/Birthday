// Star-shaped QR code: node tools/star-qr.js <url> [outDir]
// Needs (outside the site): npm i qrcode@1.5.4 sharp@0.33 jsqr@1.4.0
// Writes star-qr.svg and star-qr.png (2048px), then decodes the PNG at several sizes and fails if any read differs.
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const sharp = require("sharp");
const jsQR = require("jsqr");

const url = process.argv[2];
const outDir = process.argv[3] || process.cwd();
if (!url) throw new Error("usage: node tools/star-qr.js <url> [outDir]");

const SIZE = 2048;
const INK = "#1a0c2e";
const STAR = "#fff3d6";
const EDGE = "#d9a441";
const QUIET = 4;

const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
const n = qr.modules.size;
const dark = (x, y) => qr.modules.get(y, x) === 1;

// Five-point star, point up, centred on the canvas.
const R = SIZE * 0.485;
const RATIO = 0.56;
const cx = SIZE / 2;
const cy = SIZE / 2 + SIZE * 0.035;
const star = [];
for (let i = 0; i < 10; i++) {
  const r = i % 2 ? R * RATIO : R;
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  star.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
}
function inside(x, y) {
  let hit = false;
  for (let i = 0, j = star.length - 1; i < star.length; j = i++) {
    const [xi, yi] = star[i];
    const [xj, yj] = star[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Largest square (QR grid plus quiet zone) that sits wholly inside the star, searched over its vertical centre.
function squareFits(half, sy) {
  const steps = 64;
  for (let k = 0; k <= steps; k++) {
    const t = -half + (2 * half * k) / steps;
    if (!inside(cx + t, sy - half) || !inside(cx + t, sy + half) || !inside(cx - half, sy + t) || !inside(cx + half, sy + t)) return false;
  }
  return true;
}
let best = { half: 0, sy: cy };
for (let sy = cy - R * 0.2; sy <= cy + R * 0.2; sy += 2) {
  let lo = 0;
  let hi = R;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (squareFits(mid, sy)) lo = mid;
    else hi = mid;
  }
  if (lo > best.half) best = { half: lo, sy };
}
const m = (best.half * 2) / (n + QUIET * 2);
const gx = cx - (n * m) / 2;
const gy = best.sy - (n * m) / 2;
const qz = { left: gx - QUIET * m, top: gy - QUIET * m, right: gx + (n + QUIET) * m, bottom: gy + (n + QUIET) * m };

const finders = [
  [0, 0],
  [n - 7, 0],
  [0, n - 7],
];
const inFinder = (x, y) => finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);

// Small crescent moon in the centre, at most ~6% of the grid (well under H's 30% recovery).
const logoModules = n >= 33 ? 9 : 7;
const logoStart = Math.floor((n - logoModules) / 2);
const inLogo = (x, y) => x >= logoStart && x < logoStart + logoModules && y >= logoStart && y < logoStart + logoModules;

const f = (v) => +v.toFixed(2);
const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`);
parts.push(`<polygon points="${star.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="${STAR}" stroke="${EDGE}" stroke-width="${f(m * 0.55)}" stroke-linejoin="round"/>`);

// Decorative dots: same lattice as the code, only outside the quiet zone and fully inside the star, fainter and smaller.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const span = Math.ceil(R / m) + 2;
for (let j = -span; j <= n + span; j++) {
  for (let i = -span; i <= n + span; i++) {
    const x = gx + (i + 0.5) * m;
    const y = gy + (j + 0.5) * m;
    if (x > qz.left - m * 0.5 && x < qz.right + m * 0.5 && y > qz.top - m * 0.5 && y < qz.bottom + m * 0.5) continue;
    const r = m * 0.3;
    const clear = m * 0.9;
    if (!inside(x, y) || !inside(x - clear, y) || !inside(x + clear, y) || !inside(x, y - clear) || !inside(x, y + clear)) continue;
    if (rand() > 0.42) continue;
    parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${INK}" fill-opacity="0.38"/>`);
  }
}

// Data modules as round dots.
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    if (!dark(x, y) || inFinder(x, y) || inLogo(x, y)) continue;
    parts.push(`<circle cx="${f(gx + (x + 0.5) * m)}" cy="${f(gy + (y + 0.5) * m)}" r="${f(m * 0.5)}" fill="${INK}"/>`);
  }
}

// Finder squares: solid rounded ring and solid rounded core.
const ring = (x, y, s, r) =>
  `M${f(x + r)},${f(y)}h${f(s - 2 * r)}a${f(r)},${f(r)} 0 0 1 ${f(r)},${f(r)}v${f(s - 2 * r)}a${f(r)},${f(r)} 0 0 1 ${f(-r)},${f(r)}h${f(-(s - 2 * r))}a${f(r)},${f(r)} 0 0 1 ${f(-r)},${f(-r)}v${f(-(s - 2 * r))}a${f(r)},${f(r)} 0 0 1 ${f(r)},${f(-r)}z`;
for (const [fx, fy] of finders) {
  const x = gx + fx * m;
  const y = gy + fy * m;
  parts.push(`<path fill="${INK}" fill-rule="evenodd" d="${ring(x, y, 7 * m, 1.6 * m)} ${ring(x + m, y + m, 5 * m, 1.0 * m)}"/>`);
  parts.push(`<path fill="${INK}" d="${ring(x + 2 * m, y + 2 * m, 3 * m, 0.8 * m)}"/>`);
}

// Centre crescent.
{
  const size = logoModules * m;
  const lx = gx + logoStart * m + size / 2;
  const ly = gy + logoStart * m + size / 2;
  const r = size * 0.36;
  parts.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(size * 0.48)}" fill="${STAR}"/>`);
  parts.push(`<mask id="crescent"><rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="#fff"/><circle cx="${f(lx + r * 0.42)}" cy="${f(ly - r * 0.3)}" r="${f(r * 0.86)}" fill="#000"/></mask>`);
  parts.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(r)}" fill="${EDGE}" mask="url(#crescent)"/>`);
}
parts.push("</svg>");
const svg = parts.join("\n");

(async () => {
  const svgPath = path.join(outDir, "star-qr.svg");
  const pngPath = path.join(outDir, "star-qr.png");
  fs.writeFileSync(svgPath, svg);
  await sharp(Buffer.from(svg)).png().toFile(pngPath);

  // Decode the PNG as printed on white and on a dark page, at full size and at phone-camera sizes.
  const results = [];
  for (const bg of ["#ffffff", "#140a24"]) {
    for (const px of [2048, 800, 400, 260]) {
      const { data, info } = await sharp(pngPath).flatten({ background: bg }).resize(px, px).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      results.push({ bg, px, text: code ? code.data : null });
    }
  }
  const failed = results.filter((r) => r.text !== url);
  console.log(`version ${qr.version}, ${n}x${n} modules, module ${m.toFixed(1)}px, quiet zone ${QUIET} modules`);
  for (const r of results) console.log(`${r.bg} @${r.px}px -> ${r.text === url ? "OK" : "FAIL"} ${r.text ?? "(no read)"}`);
  if (failed.length) process.exit(1);
})();
