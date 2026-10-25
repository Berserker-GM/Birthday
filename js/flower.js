import { clamp, mulberry32, profile, randn, sinc } from "./util.js";

// Growth keys from Flowers/flow.py: stem, size, bloom, wilt, leaf, glow.
// Wilting keys are intentionally absent — this piece ends on the open flower.
const KEYS = [
  [0, 0, 0, 0, 0, 0, 0],
  [5, 0.42, 0.22, 0, 0, 0.25, 0],
  [10, 0.62, 0.42, 0, 0, 0.5, 0.35],
  [16, 0.8, 0.68, 0.5, 0, 0.72, 0.55],
  [24, 1, 1, 1, 0, 1, 1],
  [30, 1, 1, 1, 0, 1, 1],
];

const SOIL_PAL = [
  [34, 25, 20],
  [50, 36, 28],
  [68, 50, 37],
  [88, 65, 47],
  [108, 82, 60],
  [64, 58, 52],
];
const STEM_PAL = [
  [62, 38, 120],
  [100, 58, 165],
  [140, 84, 200],
  [60, 160, 140],
];
const LEAF_PAL = [
  [60, 150, 140],
  [80, 120, 175],
  [130, 80, 195],
  [175, 105, 215],
];
const RIB_PAL = [
  [210, 180, 255],
  [170, 230, 220],
];
const RIM_PAL = [
  [205, 165, 255],
  [255, 190, 250],
  [170, 140, 255],
];
const HI_PAL = [
  [235, 215, 255],
  [255, 225, 250],
];
const GOLD_PAL = [
  [255, 214, 110],
  [255, 238, 170],
  [255, 184, 90],
];
const STAMEN_PAL = [
  [255, 240, 255],
  [255, 215, 235],
  [255, 230, 150],
  [255, 190, 80],
];

// Outer petals are deeper violet; inner petals blush toward white and gold.
const LAYERS = [
  {
    n: 8,
    ac: 0.6,
    ao: 1,
    kc: -1.2,
    ko: 0.45,
    L: 1,
    wc: 0.2,
    wo: 0.34,
    off: 0,
    pal: [
      [210, 80, 225],
      [170, 58, 225],
      [128, 50, 218],
      [96, 44, 205],
      [78, 42, 185],
    ],
  },
  {
    n: 6,
    ac: 0.48,
    ao: 0.68,
    kc: -1.05,
    ko: 0.15,
    L: 0.88,
    wc: 0.19,
    wo: 0.31,
    off: 0.4,
    pal: [
      [255, 150, 235],
      [245, 92, 218],
      [205, 62, 218],
      [150, 52, 222],
    ],
  },
  {
    n: 5,
    ac: 0.36,
    ao: 0.46,
    kc: -0.85,
    ko: -0.05,
    L: 0.72,
    wc: 0.17,
    wo: 0.27,
    off: 0.2,
    pal: [
      [255, 205, 245],
      [255, 135, 232],
      [238, 84, 216],
      [195, 62, 226],
    ],
  },
  {
    n: 4,
    ac: 0.22,
    ao: 0.32,
    kc: -0.5,
    ko: -0.1,
    L: 0.46,
    wc: 0.14,
    wo: 0.22,
    off: 0.55,
    pal: [
      [255, 238, 252],
      [255, 185, 242],
      [255, 125, 228],
    ],
  },
];

const LEAF_DEFS = [
  [0.1, 1, 1, 0.55, -0.8],
  [0.16, -1, 0.9, 0.5, -0.85],
  [0.4, 1, 0.7, 0.95, -0.7],
  [0.33, -1, 0.62, 0.9, -0.65],
];

function state(time) {
  const t = clamp(time, 0, 24);
  let i = 0;
  for (let k = 0; k < KEYS.length; k++) if (KEYS[k][0] <= t) i = k;
  i = clamp(i, 0, KEYS.length - 2);
  const span = KEYS[i + 1][0] - KEYS[i][0];
  const u = span === 0 ? 0 : (t - KEYS[i][0]) / span;
  const row = (index) => KEYS[clamp(index, 0, KEYS.length - 1)];
  const p0 = row(i - 1);
  const p1 = row(i);
  const p2 = row(i + 1);
  const p3 = row(i + 2);
  const out = new Array(6);
  for (let k = 0; k < 6; k++) {
    const a = p0[k + 1];
    const b = p1[k + 1];
    const c = p2[k + 1];
    const d = p3[k + 1];
    const v =
      0.5 *
      (2 * b +
        (c - a) * u +
        (2 * a - 5 * b + 4 * c - d) * u * u +
        (3 * b - a - 3 * c + d) * u ** 3);
    out[k] = clamp(v, 0, 1);
  }
  return out;
}

function pick(rng, pal, g, spread = 0.55, jitter = 0.07) {
  const last = pal.length - 1;
  const x = clamp(g, 0, 1) * last + randn(rng) * spread;
  const idx = clamp(Math.round(x), 0, last);
  const j = 1 + randn(rng) * jitter;
  const c = pal[idx];
  return [c[0] * j, c[1] * j, c[2] * j];
}

function areaU(rng, n) {
  const out = new Float32Array(n);
  let i = 0;
  let guard = 0;
  while (i < n && guard < n * 24) {
    const u = rng();
    if (rng() < profile(u)) out[i++] = u;
    guard++;
  }
  while (i < n) out[i++] = rng();
  return out;
}

function sampleV(rng, n, rim = 0.14) {
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let val = rng() * 2 - 1;
    if (rng() < rim) val = (val < 0 ? -1 : 1) * (0.88 + rng() * 0.12);
    v[i] = val;
  }
  return v;
}

function plot(data, w, h, x, y, r, g, b, rad) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  const rr = rad * rad + 0.2;
  const R = rad >= 2.4 ? 3 : rad >= 1.6 ? 2 : 1;
  const cr = clamp(r, 0, 255);
  const cg = clamp(g, 0, 255);
  const cb = clamp(b, 0, 255);
  for (let dy = -R; dy <= R; dy++) {
    const py = iy + dy;
    if (py < 0 || py >= h) continue;
    const row = py * w;
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > rr) continue;
      const px = ix + dx;
      if (px < 0 || px >= w) continue;
      const i = (row + px) << 2;
      data[i] = cr;
      data[i + 1] = cg;
      data[i + 2] = cb;
      data[i + 3] = 255;
    }
  }
}

function layout(viewW, viewH) {
  const size = Math.round(clamp(Math.min(viewW * 0.86, viewH * 0.74), 280, 860));
  const soilScreen = viewH * (viewH > viewW * 1.05 ? 0.9 : 0.88);
  const top = soilScreen - size * 0.8;
  const left = (viewW - size) / 2;
  return { size, left, top };
}

function build(size, quality) {
  const rng = mulberry32(5);
  const W = size;
  const H = size;
  const cx = W / 2;
  const y0 = H * 0.8;
  const Ls = H * 0.38;
  const Lf = H * 0.235;
  const q = quality;

  const surface = (x) =>
    y0 -
    0.022 * H * Math.exp(-(((x - cx) / (0.2 * W)) ** 2)) -
    0.003 * H * Math.sin(x * 0.045) -
    0.002 * H * Math.sin(x * 0.13 + 1.3);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.createImageData(W, H);
  const soil = new Uint8ClampedArray(image.data.length);
  const nSoil = Math.round(5600 * q);
  for (let i = 0; i < nSoil; i++) {
    const x = rng() * W;
    const depth = rng() ** 1.5;
    const y = surface(x) + depth * 0.14 * H;
    const edge = clamp(Math.min(x, W - x) / (0.2 * W), 0, 1) ** 0.8;
    const clump = 0.5 + 0.5 * Math.sin(x * 0.07 + y * 0.05) * Math.sin(y * 0.11 - x * 0.03);
    const bright = (1 - depth) ** 0.8 * edge * (0.55 + 0.35 * clump + 0.35 * rng());
    const col = pick(rng, SOIL_PAL, rng(), 1, 0.07);
    plot(soil, W, H, x, y, col[0] * bright, col[1] * bright, col[2] * bright, rng() < 0.2 ? 2.4 : 1.8);
  }
  const pebbles = Math.round(140 * q);
  for (let i = 0; i < pebbles; i++) {
    const x = W * (0.05 + rng() * 0.9);
    const y = surface(x) + rng() ** 1.3 * 0.1 * H;
    const edge = clamp(Math.min(x, W - x) / (0.2 * W), 0, 1) ** 0.8;
    const col = pick(rng, [[58, 52, 48], [84, 74, 64], [104, 90, 76], [46, 38, 32]], rng(), 0.7, 0.05);
    plot(soil, W, H, x, y, col[0] * edge, col[1] * edge, col[2] * edge, rng() < 0.4 ? 3.1 : 2.3);
  }

  const stemN = Math.round(1500 * q);
  const stem = { s: new Float32Array(stemN), lat: new Float32Array(stemN), col: new Float32Array(stemN * 3), rad: new Float32Array(stemN) };
  for (let i = 0; i < stemN; i++) {
    const s = rng();
    let lat = rng() * 2 - 1;
    if (rng() < 0.18) lat = (lat < 0 ? -1 : 1) * (0.85 + rng() * 0.15);
    const col = rng() < 0.12 ? pick(rng, [STEM_PAL[3]], 0, 0.1, 0.08) : pick(rng, STEM_PAL.slice(0, 3), s * 0.8 + rng() * 0.2, 0.55, 0.07);
    stem.s[i] = s;
    stem.lat[i] = lat;
    stem.col[i * 3] = col[0];
    stem.col[i * 3 + 1] = col[1];
    stem.col[i * 3 + 2] = col[2];
    stem.rad[i] = rng() < 0.2 ? 2.5 : rng() < 0.6 ? 2 : 1.5;
  }

  const perLeaf = Math.round(420 * q);
  const leafN = perLeaf * LEAF_DEFS.length;
  const leaf = {
    lid: new Uint8Array(leafN),
    u: new Float32Array(leafN),
    v: new Float32Array(leafN),
    col: new Float32Array(leafN * 3),
    rad: new Float32Array(leafN),
  };
  let leafCursor = 0;
  for (let j = 0; j < LEAF_DEFS.length; j++) {
    const u = areaU(rng, perLeaf);
    const v = sampleV(rng, perLeaf, 0.1);
    for (let i = 0; i < perLeaf; i++) {
      const rib = rng() < 0.09;
      const vv = rib ? randn(rng) * 0.03 : v[i];
      const col = rib ? pick(rng, RIB_PAL, rng(), 0.4, 0.05) : pick(rng, LEAF_PAL, u[i] + randn(rng) * 0.1, 0.55, 0.07);
      const k = leafCursor++;
      leaf.lid[k] = j;
      leaf.u[k] = u[i];
      leaf.v[k] = vv;
      leaf.col[k * 3] = col[0];
      leaf.col[k * 3 + 1] = col[1];
      leaf.col[k * 3 + 2] = col[2];
      leaf.rad[k] = rng() < 0.25 ? 2.4 : 1.7;
    }
  }

  const perPetal = Math.round(150 * q);
  let petalN = 0;
  for (const layer of LAYERS) petalN += layer.n * perPetal;
  const petal = {
    n: petalN,
    th: new Float32Array(petalN),
    aj: new Float32Array(petalN),
    u: new Float32Array(petalN),
    v: new Float32Array(petalN),
    ac: new Float32Array(petalN),
    ao: new Float32Array(petalN),
    kc: new Float32Array(petalN),
    ko: new Float32Array(petalN),
    L: new Float32Array(petalN),
    wc: new Float32Array(petalN),
    wo: new Float32Array(petalN),
    sp: new Float32Array(petalN),
    col: new Float32Array(petalN * 3),
    rad: new Float32Array(petalN),
  };
  let p = 0;
  for (const layer of LAYERS) {
    for (let i = 0; i < layer.n; i++) {
      const th = (Math.PI * 2 * i) / layer.n + layer.off + randn(rng) * 0.1;
      const aj = randn(rng) * 0.06;
      const lj = 0.92 + rng() * 0.16;
      const u = areaU(rng, perPetal);
      const v = sampleV(rng, perPetal, 0.14);
      for (let k = 0; k < perPetal; k++) {
        let col = pick(rng, layer.pal, u[k] + randn(rng) * 0.1, 0.5, 0.06);
        if (Math.abs(v[k]) > 0.86 && rng() < 0.55) col = pick(rng, RIM_PAL, rng(), 0.45, 0.05);
        if (rng() < 0.04) col = pick(rng, HI_PAL, rng(), 0.3, 0.04);
        if (rng() < 0.02 && u[k] < 0.55) col = pick(rng, GOLD_PAL, rng(), 0.35, 0.05);
        petal.th[p] = th;
        petal.aj[p] = aj;
        petal.u[p] = u[k];
        petal.v[p] = v[k];
        petal.ac[p] = layer.ac;
        petal.ao[p] = layer.ao;
        petal.kc[p] = layer.kc;
        petal.ko[p] = layer.ko;
        petal.L[p] = layer.L * lj;
        petal.wc[p] = layer.wc;
        petal.wo[p] = layer.wo;
        petal.sp[p] = profile(u[k]);
        petal.col[p * 3] = col[0];
        petal.col[p * 3 + 1] = col[1];
        petal.col[p * 3 + 2] = col[2];
        petal.rad[p] = rng() < 0.25 ? 2.5 : rng() < 0.65 ? 2 : 1.5;
        p++;
      }
    }
  }

  const stN = Math.round(320 * q);
  const stamen = {
    th: new Float32Array(stN),
    beta: new Float32Array(stN),
    ell: new Float32Array(stN),
    t: new Float32Array(stN),
    col: new Float32Array(stN * 3),
    rad: new Float32Array(stN),
  };
  const filaments = 48;
  const fTh = new Float32Array(filaments);
  const fBeta = new Float32Array(filaments);
  const fEll = new Float32Array(filaments);
  for (let i = 0; i < filaments; i++) {
    fTh[i] = rng() * Math.PI * 2;
    fBeta[i] = 0.2 + rng() * 0.65;
    fEll[i] = 0.3 + rng() * 0.25;
  }
  for (let i = 0; i < stN; i++) {
    const id = Math.floor(rng() * filaments);
    const t = 1 - rng() ** 1.6;
    const col = pick(rng, STAMEN_PAL, t, 0.35, 0.05);
    stamen.th[i] = fTh[id];
    stamen.beta[i] = fBeta[id];
    stamen.ell[i] = fEll[id];
    stamen.t[i] = t;
    stamen.col[i * 3] = col[0];
    stamen.col[i * 3 + 1] = col[1];
    stamen.col[i * 3 + 2] = col[2];
    stamen.rad[i] = t > 0.88 ? 2.6 : 1.6;
  }

  const haloN = Math.round(420 * q);
  const halo = { a: new Float32Array(haloN), r: new Float32Array(haloN), b: new Float32Array(haloN), fl: new Float32Array(haloN) };
  for (let i = 0; i < haloN; i++) {
    const r = Math.min(Math.abs(randn(rng) * 0.55), 1.6);
    halo.a[i] = rng() * Math.PI * 2;
    halo.r[i] = r;
    halo.b[i] = (1 - r / 1.6) ** 1.5 * 0.55;
    halo.fl[i] = rng();
  }

  const sparkN = Math.round(110 * q);
  const spark = {
    a: new Float32Array(sparkN),
    rho: new Float32Array(sparkN),
    ph: new Float32Array(sparkN),
    sp: new Float32Array(sparkN),
    hue: new Float32Array(sparkN),
    rad: new Float32Array(sparkN),
  };
  for (let i = 0; i < sparkN; i++) {
    spark.a[i] = rng() * Math.PI * 2;
    spark.rho[i] = rng();
    spark.ph[i] = rng();
    spark.sp[i] = 0.6 + rng() * 0.8;
    spark.hue[i] = rng();
    spark.rad[i] = rng() < 0.3 ? 2.4 : 1.4;
  }

  const moteN = Math.round(36 * q);
  const motes = { a: new Float32Array(moteN), rad: new Float32Array(moteN), sp: new Float32Array(moteN), ph: new Float32Array(moteN), hue: new Float32Array(moteN) };
  for (let i = 0; i < moteN; i++) {
    motes.a[i] = rng() * Math.PI * 2;
    motes.rad[i] = 0.35 + rng() * 1.1;
    motes.sp[i] = 0.15 + rng() * 0.45;
    motes.ph[i] = rng() * Math.PI * 2;
    motes.hue[i] = rng();
  }

  const crumbleN = Math.round(180 * q);
  const crumble = {
    x: new Float32Array(crumbleN),
    amp: new Float32Array(crumbleN),
    delay: new Float32Array(crumbleN),
    col: new Float32Array(crumbleN * 3),
    rad: new Float32Array(crumbleN),
  };
  for (let i = 0; i < crumbleN; i++) {
    const x = cx + randn(rng) * 0.03 * H;
    const col = pick(rng, SOIL_PAL, 0.3 + rng() * 0.7, 0.8, 0.06);
    crumble.x[i] = x;
    crumble.amp[i] = H * 0.05 * rng() ** 2.2;
    crumble.delay[i] = rng() * 2.5;
    crumble.col[i * 3] = col[0] * 0.8;
    crumble.col[i * 3 + 1] = col[1] * 0.8;
    crumble.col[i * 3 + 2] = col[2] * 0.8;
    crumble.rad[i] = rng() < 0.5 ? 1.8 : 1.3;
  }

  const scratch = {
    px: new Float32Array(petalN),
    py: new Float32Array(petalN),
    pz: new Float32Array(petalN),
    order: new Uint32Array(petalN),
    shade: new Float32Array(petalN),
  };

  return {
    W,
    H,
    cx,
    y0,
    Ls,
    Lf,
    surface,
    canvas,
    ctx,
    image,
    soil,
    stem,
    leaf,
    petal,
    stamen,
    halo,
    spark,
    motes,
    crumble,
    scratch,
    cache: null,
    cacheKey: "",
  };
}

function ctrl(plant, L, sway) {
  const { cx, y0 } = plant;
  return [
    [cx, y0 + 4],
    [cx - 0.06 * L, y0 - 0.33 * L],
    [cx + 0.05 * L + sway * 0.5, y0 - L * 0.74],
    [cx + sway, y0 - L],
  ];
}

function bez(P, s) {
  const q = 1 - s;
  const x = q ** 3 * P[0][0] + 3 * q * q * s * P[1][0] + 3 * q * s * s * P[2][0] + s ** 3 * P[3][0];
  const y = q ** 3 * P[0][1] + 3 * q * q * s * P[1][1] + 3 * q * s * s * P[2][1] + s ** 3 * P[3][1];
  const dx = 3 * q * q * (P[1][0] - P[0][0]) + 6 * q * s * (P[2][0] - P[1][0]) + 3 * s * s * (P[3][0] - P[2][0]);
  const dy = 3 * q * q * (P[1][1] - P[0][1]) + 6 * q * s * (P[2][1] - P[1][1]) + 3 * s * s * (P[3][1] - P[2][1]);
  return [x, y, dx, dy];
}

function poseOf(plant, flowerT, time, swayAmt) {
  const [stem, size, bloom, wilt, leaf, glow] = state(flowerT);
  const sway = 0.012 * plant.H * Math.sin(time * 0.9) * stem * swayAmt;
  const L = plant.Ls * stem;
  const P = ctrl(plant, L, sway);
  const hx = P[3][0];
  const hy = P[3][1];
  const Ls = plant.Lf * size;
  const phi = 0.035 * Math.sin(time * 0.9 + 1);
  return {
    stem,
    size,
    bloom,
    wilt,
    leaf,
    glow,
    sway,
    L,
    P,
    hx,
    hy,
    heartX: hx + Math.sin(phi) * 0.5 * Ls,
    heartY: hy - Math.cos(phi) * 0.5 * Ls,
    Ls,
    phi,
  };
}

function paint(plant, pose, flowerT) {
  const { W, H, image, soil, stem, leaf, petal, stamen, crumble, scratch } = plant;
  image.data.set(soil);
  const data = image.data;
  const { stem: stemAmt, size, bloom, leaf: leafAmt, P, hx, hy, Ls } = pose;

  if (stemAmt > 0.01) {
    const nv = Math.floor(stem.s.length * clamp(stemAmt, 0.08, 1));
    const thick = clamp(0.4 + stemAmt * 1.2, 0.4, 1);
    for (let i = 0; i < nv; i++) {
      const s = stem.s[i];
      const [x, y, dx, dy] = bez(P, s);
      const nn = Math.hypot(dx, dy) + 1e-6;
      const wst = 0.0085 * H * (1 - 0.3 * s) * thick;
      const lat = stem.lat[i] * wst;
      plot(data, W, H, x - (dy / nn) * lat, y + (dx / nn) * lat, stem.col[i * 3], stem.col[i * 3 + 1], stem.col[i * 3 + 2], stem.rad[i]);
    }
  }

  if (leafAmt > 0.02 && stemAmt > 0.05) {
    const nv = Math.floor(leaf.u.length * clamp(leafAmt, 0.15, 1));
    const ax = new Float64Array(LEAF_DEFS.length);
    const ay = new Float64Array(LEAF_DEFS.length);
    for (let j = 0; j < LEAF_DEFS.length; j++) {
      const p = bez(P, LEAF_DEFS[j][0]);
      ax[j] = p[0];
      ay[j] = p[1];
    }
    for (let i = 0; i < nv; i++) {
      const def = LEAF_DEFS[leaf.lid[i]];
      const u = leaf.u[i];
      const v = leaf.v[i];
      const m = def[1];
      const LL = 0.19 * H * def[2] * leafAmt;
      const a0 = def[3] + (1 - leafAmt) * 0.8;
      const c = def[4];
      const am = a0 + c * u * 0.5;
      const al = a0 + c * u;
      const sc = sinc(c * u * 0.5);
      const lat = v * 0.27 * LL * profile(u);
      const x = ax[leaf.lid[i]] + LL * u * m * Math.cos(am) * sc - lat * Math.sin(al);
      const yup = LL * u * Math.sin(am) * sc + lat * m * Math.cos(al);
      plot(data, W, H, x, ay[leaf.lid[i]] - yup, leaf.col[i * 3], leaf.col[i * 3 + 1], leaf.col[i * 3 + 2], leaf.rad[i]);
    }
  }

  if (stemAmt > 0.01 && size > 0.05) {
    const phi = pose.phi;
    const tau = 0.2 + 0.36 * bloom;
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    const ct = Math.cos(tau);
    const st = Math.sin(tau);
    const vis = clamp(size ** 2 * 1.15, 0.2, 1);
    const nv = Math.floor(petal.n * vis);
    const { px, py, pz, shade, order } = scratch;
    for (let i = 0; i < nv; i++) {
      const u = petal.u[i];
      const v = petal.v[i];
      const A0 = petal.ac[i] + (petal.ao[i] - petal.ac[i]) * bloom + petal.aj[i];
      const K = petal.kc[i] + (petal.ko[i] - petal.kc[i]) * bloom;
      const Lp = Ls * petal.L[i];
      const am = A0 + K * u * 0.5;
      const sc = sinc(K * u * 0.5);
      let rr = Lp * u * Math.sin(am) * sc;
      const hh = Lp * u * Math.cos(am) * sc;
      const lat = v * (petal.wc[i] + (petal.wo[i] - petal.wc[i]) * bloom) * Lp * petal.sp[i];
      rr = rr + 0.025 * Ls - (0.5 * lat * lat) / (Lp + 1);
      const cth = Math.cos(petal.th[i]);
      const sth = Math.sin(petal.th[i]);
      const xl = cth * rr - sth * lat;
      const yl = hh;
      const zl = sth * rr + cth * lat;
      const yp = yl * ct - zl * st;
      const zp = yl * st + zl * ct;
      px[i] = hx + xl * cphi + yp * sphi;
      py[i] = hy - (-xl * sphi + yp * cphi);
      pz[i] = zp;
      shade[i] = clamp(0.72 + 0.28 * clamp((zp / (Ls || 1)) * 0.5 + 0.5, 0, 1) + 0.12 * (hh / (Ls || 1)), 0.5, 1.2);
    }
    // Insertion sort is unnecessary; bucket by depth.
    const bins = 16;
    const counts = paint.counts || (paint.counts = new Int32Array(bins));
    const start = paint.start || (paint.start = new Int32Array(bins));
    counts.fill(0);
    const zSpan = Ls * 2 + 1;
    for (let i = 0; i < nv; i++) {
      const b = clamp(Math.floor(((pz[i] + Ls) / zSpan) * bins), 0, bins - 1);
      counts[b]++;
      order[i] = b;
    }
    let sum = 0;
    for (let b = 0; b < bins; b++) {
      start[b] = sum;
      sum += counts[b];
    }
    if (!paint.packed || paint.packed.length < petal.n) paint.packed = new Uint32Array(petal.n);
    const packed = paint.packed;
    const cursor = paint.cursor || (paint.cursor = new Int32Array(bins));
    cursor.set(start);
    for (let i = 0; i < nv; i++) packed[cursor[order[i]]++] = i;
    for (let n = 0; n < nv; n++) {
      const i = packed[n];
      const s = shade[i];
      plot(data, W, H, px[i], py[i], petal.col[i * 3] * s, petal.col[i * 3 + 1] * s, petal.col[i * 3 + 2] * s, petal.rad[i]);
    }

    const ss = smoothBloom(bloom);
    if (ss > 0.02) {
      const nv2 = Math.floor(stamen.t.length * clamp(size ** 2, 0.25, 1));
      for (let i = 0; i < nv2; i++) {
        const ell = Ls * ss * stamen.ell[i];
        const beta = stamen.beta[i] * (0.6 + 0.4 * bloom);
        const r = ell * stamen.t[i] * Math.sin(beta) + 0.02 * Ls;
        const yl = 0.05 * Ls + ell * stamen.t[i] * Math.cos(beta);
        const xl = Math.cos(stamen.th[i]) * r;
        const zl = Math.sin(stamen.th[i]) * r;
        const yp = yl * ct - zl * st;
        const zp = yl * st + zl * ct;
        const x = hx + xl * cphi + yp * sphi;
        const y = hy - (-xl * sphi + yp * cphi);
        plot(data, W, H, x, y, stamen.col[i * 3], stamen.col[i * 3 + 1], stamen.col[i * 3 + 2], stamen.rad[i] + (zp > 0 ? 0.4 : 0));
      }
    }
  }

  if (flowerT < 8) {
    for (let i = 0; i < crumble.x.length; i++) {
      const e = clamp((flowerT - crumble.delay[i]) / 3, 0, 1);
      if (e <= 0) continue;
      const y = plant.surface(crumble.x[i]) - crumble.amp[i] * Math.sin(Math.PI * e);
      plot(data, W, H, crumble.x[i], y, crumble.col[i * 3], crumble.col[i * 3 + 1], crumble.col[i * 3 + 2], crumble.rad[i]);
    }
  }

  plant.ctx.putImageData(image, 0, 0);
}

function smoothBloom(bloom) {
  const t = clamp((bloom - 0.3) / 0.55, 0, 1);
  return t * t * (3 - 2 * t);
}

function drawAtmosphere(ctx, plant, pose, origin, time) {
  const { glow, Ls, heartX, heartY } = pose;
  if (glow < 0.02 || Ls < 2) return;
  const hx = origin.left + heartX * origin.scale;
  const hy = origin.top + heartY * origin.scale;
  const unit = Ls * origin.scale;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = plant.halo;
  for (let i = 0; i < halo.a.length; i++) {
    const br = halo.b[i] * glow * (0.85 + 0.3 * Math.sin(time * 1.3 + halo.fl[i] * 6.28));
    if (br < 0.04) continue;
    const rh = halo.r[i] * unit * 1.1;
    ctx.fillStyle = `rgba(170, 90, 255, ${br})`;
    ctx.fillRect(hx + Math.cos(halo.a[i]) * rh, hy + Math.sin(halo.a[i]) * rh, 1.6, 1.6);
  }
  const rings = 7;
  const Rs = unit * 1.25;
  for (let j = 1; j < rings; j++) {
    const cang = (Math.PI * 2 * (j - 1)) / 6 + time * 0.15;
    const count = 18;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + time * 0.05;
      const rho = 0.5;
      const x = hx + Rs * (0.5 * Math.cos(cang) + rho * Math.cos(a));
      const y = hy + Rs * (0.5 * Math.sin(cang) + rho * Math.sin(a));
      const bb = (0.25 + 0.35 * glow) * (0.55 + 0.45 * Math.sin(time * 2 + i));
      ctx.fillStyle = `rgba(210, 145, 255, ${bb})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  for (let j = 0; j < 6; j++) {
    const a = (Math.PI * 2 * j) / 6 + time * 0.15;
    ctx.fillStyle = `rgba(255, 220, 255, ${0.35 + glow * 0.5})`;
    ctx.beginPath();
    ctx.arc(hx + Rs * Math.cos(a), hy + Rs * Math.sin(a), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const spark = plant.spark;
  for (let i = 0; i < spark.a.length; i++) {
    const life = (time * 0.1 * spark.sp[i] + spark.ph[i]) % 1;
    const rho = (0.25 + 1.15 * spark.rho[i]) * unit * (0.6 + 0.6 * life);
    const x = hx + Math.cos(spark.a[i]) * rho;
    const y = hy + Math.sin(spark.a[i]) * rho - life * 0.25 * unit;
    const br = Math.sin(Math.PI * life) ** 0.8 * glow;
    ctx.fillStyle = spark.hue[i] < 0.5 ? `rgba(255, 215, 255, ${br})` : `rgba(255, 160, 230, ${br})`;
    ctx.fillRect(x, y, spark.rad[i], spark.rad[i]);
  }
  if (pose.bloom > 0.8) {
    const motes = plant.motes;
    for (let i = 0; i < motes.a.length; i++) {
      const ang = motes.a[i] + time * motes.sp[i];
      const rad = unit * (0.9 + motes.rad[i]) + Math.sin(time * 0.7 + motes.ph[i]) * 8;
      const y = hy + Math.sin(ang) * rad * 0.55 - ((time * 8 + motes.ph[i] * 20) % (unit * 1.4));
      const x = hx + Math.cos(ang) * rad;
      const hue = motes.hue[i];
      ctx.fillStyle = hue < 0.5 ? "rgba(255, 190, 240, 0.45)" : "rgba(190, 160, 255, 0.4)";
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.restore();
}

export function createFlower(quality) {
  let plant = null;

  function ensure(size) {
    const bucket = Math.max(280, Math.round(size / 24) * 24);
    if (!plant || plant.W !== bucket) {
      plant = build(bucket, quality);
    }
    return plant;
  }

  function place(viewW, viewH) {
    const box = layout(viewW, viewH);
    const grown = ensure(box.size);
    const scale = box.size / grown.W;
    return {
      left: (viewW - grown.W * scale) / 2,
      top: box.top + (box.size - grown.W * scale) * 0.15,
      scale,
      plant: grown,
    };
  }

  function sample(viewW, viewH, flowerT, time, sway) {
    const origin = place(viewW, viewH);
    const pose = poseOf(origin.plant, flowerT, time, sway);
    return {
      x: origin.left + pose.heartX * origin.scale,
      y: origin.top + pose.heartY * origin.scale,
      pose,
      origin,
    };
  }

  function draw(ctx, viewW, viewH, flowerT, time, sway) {
    const origin = place(viewW, viewH);
    const { plant: grown } = origin;
    const pose = poseOf(grown, flowerT, time, sway);
    const key = `${grown.W}:${flowerT.toFixed(2)}:${sway > 0 ? Math.round(time * 12) : "still"}`;
    if (grown.cacheKey !== key) {
      paint(grown, pose, flowerT);
      if (sway === 0 && flowerT >= 24) {
        grown.cacheKey = key;
      } else {
        grown.cacheKey = "";
      }
    }
    ctx.save();
    ctx.drawImage(grown.canvas, origin.left, origin.top, grown.W * origin.scale, grown.H * origin.scale);
    ctx.restore();
    drawAtmosphere(ctx, grown, pose, origin, time);
    return {
      x: origin.left + pose.heartX * origin.scale,
      y: origin.top + pose.heartY * origin.scale,
    };
  }

  return { draw, sample };
}
