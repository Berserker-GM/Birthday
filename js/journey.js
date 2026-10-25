import { clamp, easeInOut, easeOutCubic, lerp, mulberry32, randn, smoothstep } from "./util.js";

const HISTORY = 960;
const MASK_W = 480;
const MASK_H = 580;
// Photo footprints: padding between photos, the float drift from draw(), and the smallest a photo may shrink to.
const PAD = 16;
const DRIFT_X = 5;
const DRIFT_Y = 7;
const MIN_SCALE = 0.8;
const SPRITE = 32;
const sprites = new Map();

// One soft glow per colour, quantised to 4 bits a channel so photo colours share sprites.
function sprite(r, g, b) {
  const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  let canvas = sprites.get(key);
  if (canvas) return canvas;
  const qr = ((r >> 4) << 4) | 8;
  const qg = ((g >> 4) << 4) | 8;
  const qb = ((b >> 4) << 4) | 8;
  canvas = document.createElement("canvas");
  canvas.width = SPRITE;
  canvas.height = SPRITE;
  const ctx = canvas.getContext("2d");
  const half = SPRITE / 2;
  const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
  const core = (v) => Math.round(lerp(v, 255, 0.55));
  glow.addColorStop(0, `rgba(${core(qr)}, ${core(qg)}, ${core(qb)}, 1)`);
  glow.addColorStop(0.16, `rgba(${qr}, ${qg}, ${qb}, 0.82)`);
  glow.addColorStop(0.42, `rgba(${qr}, ${qg}, ${qb}, 0.24)`);
  glow.addColorStop(1, `rgba(${qr}, ${qg}, ${qb}, 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SPRITE, SPRITE);
  sprites.set(key, canvas);
  return canvas;
}

// Curl of a layered sin/cos stream function: divergence-free, so dust swirls instead of bunching.
const flowOut = { x: 0, y: 0 };
function flow(x, y, t) {
  const a = 0.011;
  const b = 0.013;
  const c = 0.023;
  const d = 0.019;
  const c1 = Math.cos(a * x + t);
  const s1 = Math.sin(a * x + t);
  const c2 = Math.cos(b * y - t * 0.8);
  const s2 = Math.sin(b * y - t * 0.8);
  const c3 = Math.cos(c * x - d * y + t * 1.3);
  const dpdx = a * c1 * c2 + 0.5 * c * c3;
  const dpdy = -b * s1 * s2 - 0.5 * d * c3;
  flowOut.x = dpdy;
  flowOut.y = -dpdx;
  return flowOut;
}

function catmull(points, t) {
  const n = points.length;
  if (n === 1) return points[0];
  const scaled = clamp(t, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(scaled));
  const u = scaled - i;
  const at = (index) => points[clamp(index, 0, n - 1)];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  const axis = (k) =>
    0.5 *
    (2 * p1[k] +
      (p2[k] - p0[k]) * u +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u +
      (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u ** 3);
  return { x: axis("x"), y: axis("y") };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ ok: true, image });
    image.onerror = () => resolve({ ok: false, image: null });
    image.src = src;
  });
}

function cover(ctx, image, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function feather(source) {
  const canvas = document.createElement("canvas");
  canvas.width = MASK_W;
  canvas.height = MASK_H;
  const ctx = canvas.getContext("2d");
  cover(ctx, source, MASK_W, MASK_H);
  ctx.globalCompositeOperation = "destination-in";
  ctx.save();
  ctx.translate(MASK_W / 2, MASK_H / 2);
  ctx.scale(1, MASK_H / MASK_W);
  ctx.translate(-MASK_W / 2, -MASK_H / 2);
  const fade = ctx.createRadialGradient(MASK_W / 2, MASK_H / 2, MASK_W * 0.05, MASK_W / 2, MASK_H / 2, MASK_W * 0.46);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.5, "rgba(0,0,0,0.92)");
  fade.addColorStop(0.78, "rgba(0,0,0,0.28)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, MASK_W, MASK_H);
  ctx.restore();
  return canvas;
}

function gradientPlate(index) {
  const palettes = [
    ["#ffe0a8", "#e36a3a", "#2a100c"],
    ["#b9fff6", "#3d7cff", "#120821"],
    ["#ffd0ea", "#c44ad4", "#2a0c22"],
    ["#fff4c8", "#ff8bd2", "#241238"],
    ["#d8fff8", "#7a5cff", "#160c28"],
    ["#ffe7b0", "#ff6ea8", "#1a1028"],
  ];
  const [a, b, c] = palettes[index % palettes.length];
  const canvas = document.createElement("canvas");
  canvas.width = MASK_W;
  canvas.height = MASK_H;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(MASK_W * 0.45, MASK_H * 0.4, 20, MASK_W * 0.5, MASK_H * 0.5, MASK_H * 0.7);
  g.addColorStop(0, a);
  g.addColorStop(0.48, b);
  g.addColorStop(1, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, MASK_W, MASK_H);
  return canvas;
}

function samplePlate(plate, count, rng) {
  const ctx = plate.getContext("2d");
  const data = ctx.getImageData(0, 0, plate.width, plate.height).data;
  const picks = [];
  const step = 5;
  for (let y = 0; y < plate.height; y += step) {
    for (let x = 0; x < plate.width; x += step) {
      const i = (y * plate.width + x) * 4;
      if (data[i + 3] < 40) continue;
      const lum = data[i] * 0.3 + data[i + 1] * 0.5 + data[i + 2] * 0.2;
      if (lum < 28) continue;
      if (rng() > 0.42) continue;
      const jitter = 0.86 + rng() * 0.28;
      picks.push({
        lx: x / plate.width - 0.5,
        ly: y / plate.height - 0.5,
        r: clamp(data[i] * jitter, 0, 255),
        g: clamp(data[i + 1] * jitter, 0, 255),
        b: clamp(data[i + 2] * jitter, 0, 255),
      });
    }
  }
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  const chosen = picks.slice(0, count);
  for (const pick of chosen) sprite(pick.r, pick.g, pick.b);
  return chosen;
}

function sampleGlyphs(heading, width) {
  const lines = heading.trim().split(/\s+/).filter(Boolean);
  if (!lines.length) return [];
  const fontSize = clamp(width * 0.072, 34, 96);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(320, Math.floor(Math.min(width * 0.92, 1200)));
  canvas.height = Math.floor(fontSize * lines.length * 1.22 + 24);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${fontSize}px "Cormorant Garamond", Palatino, "Palatino Linotype", Georgia, serif`;
  lines.forEach((line, index) => {
    const y = canvas.height / 2 + (index - (lines.length - 1) / 2) * fontSize * 1.05;
    ctx.fillText(line, canvas.width / 2, y);
  });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const points = [];
  const step = 4;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if (data[(y * canvas.width + x) * 4 + 3] > 150 && Math.random() < 0.62) {
        points.push({ x: x - canvas.width / 2, y: y - canvas.height / 2 });
      }
    }
  }
  if (points.length > 680) {
    const stride = Math.ceil(points.length / 680);
    return points.filter((_, index) => index % stride === 0);
  }
  return points;
}

function createPool(count) {
  return {
    count,
    alive: new Uint8Array(count),
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    life: new Float32Array(count),
    max: new Float32Array(count),
    size: new Float32Array(count),
    r: new Uint8Array(count),
    g: new Uint8Array(count),
    b: new Uint8Array(count),
    mode: new Uint8Array(count),
    tx: new Float32Array(count),
    ty: new Float32Array(count),
    seed: new Float32Array(count),
    cursor: 0,
  };
}

export function createJourney(config, quality) {
  const rng = mulberry32(21);
  const colors = config.colors.trail;
  const pool = createPool(Math.round(820 * quality));
  const hx = new Float32Array(HISTORY);
  const hy = new Float32Array(HISTORY);
  let hStart = 0;
  let hCount = 0;
  let path = null;
  let pathLength = 1;
  let traveled = 0;
  let spacing = 1;
  let dirX = 1;
  let dirY = 0;
  let lastX = null;
  let lastY = null;
  let viewW = 0;
  let viewH = 0;
  const photos = [];
  let nextPhoto = 0;
  let plates = config.photos.map(() => null);
  let burstArmed = false;
  let glyphs = [];
  let emitX = null;
  let emitY = 0;
  let emitCarry = 0;
  const partBudget = Math.round(230 * quality);
  for (const color of colors) sprite(color[0], color[1], color[2]);

  const ready = Promise.all(config.photos.map((src) => loadImage(src))).then((results) => {
    plates = results.map((result, index) => {
      const source = result.ok ? result.image : gradientPlate(index);
      const plate = feather(source);
      return { plate, samples: samplePlate(plate, partBudget, rng), ok: result.ok };
    });
  });

  function reset() {
    pool.alive.fill(0);
    pool.cursor = 0;
    hStart = 0;
    hCount = 0;
    path = null;
    traveled = 0;
    lastX = null;
    lastY = null;
    photos.length = 0;
    nextPhoto = 0;
    burstArmed = false;
    glyphs = [];
    dirX = 1;
    dirY = 0;
    emitX = null;
    emitCarry = 0;
  }

  function historyAt(index) {
    const slot = (hStart + index) % HISTORY;
    return { x: hx[slot], y: hy[slot], index };
  }

  function pushHistory(x, y) {
    if (hCount) {
      const last = historyAt(hCount - 1);
      if (Math.hypot(x - last.x, y - last.y) < 3.5) return;
    }
    if (hCount < HISTORY) {
      const slot = (hStart + hCount) % HISTORY;
      hx[slot] = x;
      hy[slot] = y;
      hCount++;
    } else {
      hx[hStart] = x;
      hy[hStart] = y;
      hStart = (hStart + 1) % HISTORY;
    }
  }

  function behind(x, y, distance) {
    for (let i = hCount - 1; i >= 0; i--) {
      const point = historyAt(i);
      if (Math.hypot(point.x - x, point.y - y) >= distance) return point;
    }
    return hCount ? historyAt(0) : { x, y, index: 0 };
  }

  function tangent(index) {
    const a = historyAt(Math.max(0, index - 2));
    const b = historyAt(Math.min(hCount - 1, index + 2));
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const mag = Math.hypot(dx, dy) || 1;
    return { x: dx / mag, y: dy / mag };
  }

  function ensurePath(head, w, h) {
    if (path) return;
    const hoverY = clamp((head.y - h * 0.12) / h, 0.24, 0.5);
    const hoverX = head.x / w;
    path = [
      { x: hoverX, y: hoverY },
      { x: clamp(hoverX - 0.16, 0.14, 0.86), y: clamp(hoverY - 0.05, 0.2, 0.48) },
      { x: 0.16, y: clamp(hoverY - 0.01, 0.22, 0.5) },
      { x: 0.34, y: clamp(hoverY - 0.1, 0.18, 0.44) },
      { x: 0.56, y: clamp(hoverY - 0.12, 0.18, 0.42) },
      { x: 0.84, y: clamp(hoverY - 0.04, 0.2, 0.46) },
      { x: 0.7, y: clamp(hoverY - 0.14, 0.16, 0.4) },
      { x: 0.5, y: clamp(hoverY - 0.12, 0.18, 0.4) },
    ];
    let length = 0;
    let prev = null;
    for (let i = 0; i <= 96; i++) {
      const point = catmull(path, i / 96);
      const x = point.x * w;
      const y = point.y * h;
      if (prev) length += Math.hypot(x - prev.x, y - prev.y);
      prev = { x, y };
    }
    pathLength = Math.max(length, 1);
    spacing = pathLength / (Math.max(config.photos.length, 1) + 0.7);
  }

  function photoBox(w, h) {
    const pw = clamp(Math.min(w, h) * 0.3, 108, 292);
    return { w: pw, h: pw * (MASK_H / MASK_W) };
  }

  // Screen-space bounds of a photo at its anchor: breathing scale and tilt, float drift, and half the padding.
  function footprint(x, y, box, scale) {
    const hw = box.w * scale * 0.525 + DRIFT_X + PAD / 2;
    const hh = box.h * scale * 0.525 + DRIFT_Y + PAD / 2;
    return { left: x - hw, right: x + hw, top: y - hh, bottom: y + hh };
  }

  function collides(rect, placed) {
    for (const other of placed) {
      if (rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top) return true;
    }
    return false;
  }

  function flightBounds(w, h) {
    return [
      (box, s) => ({
        minX: box.w * s * 0.62,
        maxX: w - box.w * s * 0.62,
        minY: box.h * s * 0.46,
        maxY: Math.min(h * 0.46, h - box.h * s * 0.55),
      }),
      // Only when the upper band is full: let photos settle lower, still above the ground.
      (box, s) => ({
        minX: box.w * s * 0.56,
        maxX: w - box.w * s * 0.56,
        minY: box.h * s * 0.5,
        maxY: h * 0.84 - box.h * s * 0.5,
      }),
    ];
  }

  // Nearest spot to `want` that clears every placed photo: the given candidates first, then a scan of free space.
  // Shrinks the photo (not below MIN_SCALE) before widening to the next set of bounds.
  function settle(want, candidates, box, tiers, placed) {
    for (const tier of tiers) {
      for (const scale of [1, 0.93, 0.86, MIN_SCALE]) {
        const b = tier(box, scale);
        if (b.maxX < b.minX || b.maxY < b.minY) continue;
        let best = null;
        let bestD = Infinity;
        const consider = (px, py) => {
          const x = clamp(px, b.minX, b.maxX);
          const y = clamp(py, b.minY, b.maxY);
          const d = Math.hypot(x - want.x, y - want.y);
          if (d >= bestD || collides(footprint(x, y, box, scale), placed)) return;
          best = { x, y, scale };
          bestD = d;
        };
        for (const point of candidates) consider(point.x, point.y);
        // Free-space scan about a quarter of a photo apart, so gaps between earlier photos are found.
        const nx = clamp(Math.ceil((b.maxX - b.minX) / (box.w * scale * 0.25)), 1, 40);
        const ny = clamp(Math.ceil((b.maxY - b.minY) / (box.h * scale * 0.25)), 1, 40);
        for (let gy = 0; gy <= ny; gy++) {
          for (let gx = 0; gx <= nx; gx++) consider(lerp(b.minX, b.maxX, gx / nx), lerp(b.minY, b.maxY, gy / ny));
        }
        if (best) return best;
      }
    }
    // Nothing is free even at MIN_SCALE: take the spot that overlaps least.
    const b = tiers[tiers.length - 1](box, MIN_SCALE);
    let best = { x: clamp(want.x, b.minX, b.maxX), y: clamp(want.y, b.minY, b.maxY), scale: MIN_SCALE };
    let least = Infinity;
    for (let gy = 0; gy <= 12; gy++) {
      for (let gx = 0; gx <= 12; gx++) {
        const x = lerp(b.minX, b.maxX, gx / 12);
        const y = lerp(b.minY, b.maxY, gy / 12);
        const rect = footprint(x, y, box, MIN_SCALE);
        let area = 0;
        for (const o of placed) {
          area += Math.max(0, Math.min(rect.right, o.right) - Math.max(rect.left, o.left)) * Math.max(0, Math.min(rect.bottom, o.bottom) - Math.max(rect.top, o.top));
        }
        if (area < least) {
          least = area;
          best = { x, y, scale: MIN_SCALE };
        }
      }
    }
    return best;
  }

  function placedRects(box, upTo = photos.length) {
    const rects = [];
    for (let i = 0; i < upTo; i++) rects.push(footprint(photos[i].anchorX, photos[i].anchorY, box, photos[i].scale));
    return rects;
  }

  function flight(scene, head, w, h) {
    viewW = w;
    viewH = h;
    if (!scene.showButterfly) {
      return { x: head.x, y: head.y, vx: 0, vy: -1, show: false };
    }
    ensurePath(head, w, h);
    const hover = { x: path[0].x * w, y: path[0].y * h };
    const end = path[path.length - 1];
    const dest = { x: w * 0.5, y: h * 0.22 };
    let x;
    let y;
    if (scene.name === "emerge") {
      const t = easeOutCubic(scene.emergeU);
      x = lerp(head.x, hover.x, t);
      y = lerp(head.y, hover.y, t);
    } else if (scene.name === "hover") {
      x = hover.x;
      y = hover.y + Math.sin(scene.time * 2.1) * 5;
    } else if (scene.name === "journey") {
      const point = catmull(path, easeInOut(scene.journeyU));
      x = point.x * w;
      y = point.y * h + Math.sin(scene.time * 5.4) * 6;
    } else {
      const from = { x: end.x * w, y: end.y * h };
      const t = scene.name === "ascend" ? easeInOut(scene.ascendU) : 1;
      x = lerp(from.x, dest.x, t);
      y = lerp(from.y, dest.y, t) + (1 - t) * Math.sin(scene.time * 8) * 6;
    }
    const vx = lastX == null ? 0 : x - lastX;
    const vy = lastY == null ? 0 : y - lastY;
    const speed = Math.hypot(vx, vy);
    if (speed > 0.35) {
      dirX = vx / speed;
      dirY = vy / speed;
    }
    if (scene.name === "journey" && lastX != null) traveled += Math.hypot(x - lastX, y - lastY);
    lastX = x;
    lastY = y;
    pushHistory(x, y);
    return { x, y, vx, vy, show: true };
  }

  function alloc(props) {
    let slot = -1;
    for (let n = 0; n < pool.count; n++) {
      const i = (pool.cursor + n) % pool.count;
      if (!pool.alive[i]) {
        slot = i;
        pool.cursor = (i + 1) % pool.count;
        break;
      }
    }
    if (slot < 0) return;
    pool.alive[slot] = 1;
    pool.x[slot] = props.x;
    pool.y[slot] = props.y;
    pool.vx[slot] = props.vx || 0;
    pool.vy[slot] = props.vy || 0;
    pool.life[slot] = props.life;
    pool.max[slot] = props.max || props.life;
    pool.size[slot] = props.size;
    pool.r[slot] = props.r;
    pool.g[slot] = props.g;
    pool.b[slot] = props.b;
    pool.mode[slot] = props.mode || 0;
    pool.tx[slot] = props.tx || 0;
    pool.ty[slot] = props.ty || 0;
    pool.seed[slot] = rng();
  }

  function emit(x, y, count, spread, aged = 0) {
    for (let i = 0; i < count; i++) {
      const color = colors[Math.floor(rng() * colors.length)];
      const along = -1;
      const life = 0.95 + rng() * 1.8;
      alloc({
        x: x + randn(rng) * spread,
        y: y + randn(rng) * spread,
        vx: dirX * along * (24 + rng() * 60) + -dirY * randn(rng) * 30,
        vy: dirY * along * (24 + rng() * 60) + dirX * randn(rng) * 30,
        life: life - aged,
        max: life,
        size: 1.2 + rng() ** 2 * 3.4,
        r: color[0],
        g: color[1],
        b: color[2],
        mode: 0,
      });
    }
  }

  // One mote every `step` pixels of the emitter's path, interpolated between frames so slow frames leave no gaps.
  function emitAlong(x, y, step, dt) {
    if (emitX == null) {
      emitX = x;
      emitY = y;
      emitCarry = 0;
      emit(x, y, 1, 6);
      return;
    }
    const dx = x - emitX;
    const dy = y - emitY;
    const dist = Math.hypot(dx, dy);
    let next = step - emitCarry;
    let made = 0;
    while (next <= dist && made < 48) {
      const t = next / dist;
      emit(emitX + dx * t, emitY + dy * t, 1, 6, (1 - t) * dt);
      next += step;
      made++;
    }
    emitCarry = made >= 48 ? 0 : step - (next - dist);
    emitX = x;
    emitY = y;
  }

  function spawnPhoto(index, w, h, wingspan) {
    const plate = plates[index];
    if (!plate) return false;
    const box = photoBox(w, h);
    const lag = wingspan * 0.95 + box.w * 0.42;
    const back = behind(lastX, lastY, lag);
    let side = index % 2 === 0 ? 1 : -1;
    const gap = box.w * 0.58 + wingspan * 0.28;
    const tiers = flightBounds(w, h);
    const atSide = (point, which, reach) => {
      const tan = tangent(point.index);
      return { x: point.x + -tan.y * which * reach, y: point.y + tan.x * which * reach };
    };
    const first = tiers[0](box, 1);
    const inside = (point) => point.x >= first.minX && point.x <= first.maxX && point.y >= first.minY && point.y <= first.maxY;
    let want = atSide(back, side, gap);
    if (!inside(want)) {
      const flipped = atSide(back, -side, gap);
      if (inside(flipped) || flipped.y < want.y) {
        side *= -1;
        want = flipped;
      }
    }
    // The preferred side, the other side, then further back along the path and further away from it.
    const candidates = [];
    for (const step of [0, 0.5, 1, 1.6]) {
      const point = step ? behind(lastX, lastY, lag + box.w * step) : back;
      for (const reach of [1, 1.35, 1.75]) {
        candidates.push(atSide(point, side, gap * reach), atSide(point, -side, gap * reach));
      }
    }
    const spot = settle(want, candidates, box, tiers, placedRects(box));
    const target = { x: spot.x, y: spot.y };
    const parts = plate.samples.map((sample) => {
      const x0 = back.x + randn(rng) * 36 - dirX * rng() * 70;
      const y0 = back.y + randn(rng) * 36 - dirY * rng() * 70;
      // Bow each mote's path sideways so the photo gathers along curves rather than straight lines.
      const ex = target.x + sample.lx * box.w * spot.scale - x0;
      const ey = target.y + sample.ly * box.h * spot.scale - y0;
      const bow = side * 0.18 + randn(rng) * 0.14;
      return {
        x0,
        y0,
        bx: -ey * bow,
        by: ex * bow,
        delay: rng() * 0.32,
        lx: sample.lx,
        ly: sample.ly,
        size: 1.3 + rng() * 2.4,
        r: sample.r,
        g: sample.g,
        b: sample.b,
        ph: rng() * Math.PI * 2,
      };
    });
    photos.push({
      index,
      anchorX: spot.x,
      anchorY: spot.y,
      scale: spot.scale,
      age: 0,
      plate: plate.plate,
      parts,
      side,
    });
    return true;
  }

  function explode(x, y, w, h, butterfly, wingspan, flap) {
    burstArmed = true;
    glyphs = sampleGlyphs(config.heading, w);
    const originX = w * 0.5;
    const originY = h * 0.2;
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i] || pool.mode[i] !== 0) continue;
      const ang = Math.atan2(pool.y[i] - y, pool.x[i] - x) + randn(rng) * 0.35;
      const speed = 90 + rng() * 460;
      pool.vx[i] = Math.cos(ang) * speed;
      pool.vy[i] = Math.sin(ang) * speed;
      pool.life[i] = 1.1 + rng() * 1.5;
      pool.max[i] = pool.life[i];
      pool.mode[i] = 2;
    }
    if (butterfly) {
      const seeds = butterfly.sample(x, y, wingspan, flap.bank, flap.time, flap.freq, flap.amp, 360);
      for (const seed of seeds) {
        const ang = Math.atan2(seed.y - y, seed.x - x) + randn(rng) * 0.2;
        const speed = 40 + rng() * 380;
        alloc({
          x: seed.x,
          y: seed.y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 1.2 + rng() * 1.3,
          size: 1.6 + rng() * 2.2,
          r: seed.color[0] * 255,
          g: seed.color[1] * 255,
          b: seed.color[2] * 255,
          mode: 2,
        });
      }
    }
    const glyphColors = [
      [255, 244, 220],
      [255, 214, 150],
      [230, 190, 255],
    ];
    for (const glyph of glyphs) {
      const color = glyphColors[Math.floor(rng() * glyphColors.length)];
      alloc({
        x: x + randn(rng) * 16,
        y: y + randn(rng) * 16,
        vx: randn(rng) * 40,
        vy: randn(rng) * 40,
        life: 8,
        size: 1.5 + rng() * 1.8,
        r: color[0],
        g: color[1],
        b: color[2],
        mode: 1,
        tx: originX + glyph.x,
        ty: originY + glyph.y,
      });
    }
  }

  function update(dt, scene, pose, w, h, wingspan, butterfly, flap) {
    if (config.photos.length && scene.name === "journey" && nextPhoto < config.photos.length) {
      if (traveled > spacing * (nextPhoto + 0.42) && hCount > 6) {
        if (spawnPhoto(nextPhoto, w, h, wingspan)) nextPhoto++;
      }
    }
    if ((scene.name === "emerge" || scene.name === "hover") && pose.show) {
      if (rng() < dt * 24) emit(pose.x - dirX * 8, pose.y + wingspan * 0.12, 1, 8);
    } else if (scene.emitTrail && pose.show && !scene.explode) {
      const step = (scene.name === "ascend" ? 3.4 : 4.4) / clamp(quality, 0.6, 1);
      if (dt > 0) emitAlong(pose.x - dirX * wingspan * 0.46, pose.y - dirY * wingspan * 0.46, step, dt);
    } else {
      emitX = null;
    }
    if (scene.explode && !burstArmed) explode(pose.x, pose.y, w, h, butterfly, wingspan, flap);

    const minBack = wingspan * 0.26;
    const dustDamp = 0.96 ** (dt * 60);
    const burstDamp = 0.992 ** (dt * 60);
    const glyphDamp = dustDamp;
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i]) continue;
      pool.life[i] -= dt;
      if (pool.life[i] <= 0 && pool.mode[i] !== 1) {
        pool.alive[i] = 0;
        continue;
      }
      if (pool.mode[i] === 1) {
        pool.vx[i] *= glyphDamp;
        pool.vy[i] *= glyphDamp;
        pool.x[i] += pool.vx[i] * dt;
        pool.y[i] += pool.vy[i] * dt;
        const pull = scene.burstU > 0.18 ? 1.8 : 0.4;
        pool.x[i] = lerp(pool.x[i], pool.tx[i], clamp(dt * pull, 0, 0.18));
        pool.y[i] = lerp(pool.y[i], pool.ty[i], clamp(dt * pull, 0, 0.18));
        continue;
      }
      if (pool.mode[i] === 0 && scene.converge && !scene.explode) {
        pool.vx[i] = lerp(pool.vx[i], (pose.x - pool.x[i]) * 2.4, 0.12);
        pool.vy[i] = lerp(pool.vy[i], (pose.y - pool.y[i]) * 2.4, 0.12);
      }
      // Fairy dust meanders on the flow field and drifts gently upward; burst sparks keep their momentum.
      const dust = pool.mode[i] === 0;
      const swirl = flow(pool.x[i], pool.y[i], scene.time * 0.9 + pool.seed[i] * 0.6);
      const push = dust ? 2600 : 900;
      pool.vx[i] += swirl.x * push * dt;
      pool.vy[i] += (swirl.y * push - (dust ? 18 : 6)) * dt;
      const damp = dust ? dustDamp : burstDamp;
      pool.vx[i] *= damp;
      pool.vy[i] *= damp;
      pool.x[i] += pool.vx[i] * dt;
      pool.y[i] += pool.vy[i] * dt;
      if (pool.mode[i] === 0 && pose.show && !scene.explode && !scene.converge) {
        const along = (pool.x[i] - pose.x) * dirX + (pool.y[i] - pose.y) * dirY;
        if (along > -minBack) {
          pool.x[i] -= dirX * (along + minBack);
          pool.y[i] -= dirY * (along + minBack);
        }
      }
    }

    for (const photo of photos) photo.age += dt;
  }

  function resize(w, h) {
    if (!viewW || !viewH) return;
    const sx = w / viewW;
    const sy = h / viewH;
    if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
    for (let i = 0; i < hCount; i++) {
      const slot = (hStart + i) % HISTORY;
      hx[slot] *= sx;
      hy[slot] *= sy;
    }
    if (lastX != null) {
      lastX *= sx;
      lastY *= sy;
    }
    for (let i = 0; i < pool.count; i++) {
      pool.x[i] *= sx;
      pool.y[i] *= sy;
      pool.tx[i] *= sx;
      pool.ty[i] *= sy;
      pool.vx[i] *= sx;
      pool.vy[i] *= sy;
    }
    for (const photo of photos) {
      photo.anchorX *= sx;
      photo.anchorY *= sy;
      for (const part of photo.parts) {
        part.x0 *= sx;
        part.y0 *= sy;
        part.bx *= sx;
        part.by *= sy;
      }
    }
    // The photo size follows min(w, h), so re-settle every photo in order after a rotation.
    const box = photoBox(w, h);
    const tiers = flightBounds(w, h);
    photos.forEach((photo, index) => {
      const want = { x: photo.anchorX, y: photo.anchorY };
      const spot = settle(want, [want], box, tiers, placedRects(box, index));
      photo.anchorX = spot.x;
      photo.anchorY = spot.y;
      photo.scale = spot.scale;
    });
    if (emitX != null) {
      emitX *= sx;
      emitY *= sy;
    }
    traveled *= (sx + sy) / 2;
    spacing *= (sx + sy) / 2;
    pathLength *= (sx + sy) / 2;
    viewW = w;
    viewH = h;
    if (burstArmed) glyphs = sampleGlyphs(config.heading, w);
  }

  function drawParticle(ctx, x, y, size, r, g, b, alpha) {
    if (alpha < 0.02) return;
    const radius = size * 1.9 + 2;
    ctx.globalAlpha = Math.min(alpha, 1);
    ctx.drawImage(sprite(r | 0, g | 0, b | 0), x - radius, y - radius, radius * 2, radius * 2);
  }

  function draw(ctx, scene, pose, w, h, wingspan) {
    const unit = photoBox(w, h);
    const fade = scene.burstU > 0 ? lerp(1, 0.2, smoothstep(scene.burstU, 0.05, 0.55)) : scene.hold ? 0.2 : 1;
    photos.forEach((photo, index) => {
      const box = { w: unit.w * photo.scale, h: unit.h * photo.scale };
      const progress = clamp(photo.age / 2.75, 0, 1);
      const floatX = Math.cos(scene.time * 0.45 + index * 1.7) * DRIFT_X;
      const floatY = Math.sin(scene.time * 0.62 + index) * DRIFT_Y;
      const ax = photo.anchorX + floatX;
      const ay = photo.anchorY + floatY;
      const ease = easeOutCubic(progress);
      const remain = 1 - smoothstep(progress, 0.5, 1) * 0.78;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const part of photo.parts) {
        // Staggered start, a quadratic arc bowed off the straight line, and an ease-out landing.
        const u = easeOutCubic((progress - part.delay) / 0.6);
        const inv = 1 - u;
        const tx = ax + part.lx * box.w;
        const ty = ay + part.ly * box.h;
        const mx = (part.x0 + tx) * 0.5 + part.bx;
        const my = (part.y0 + ty) * 0.5 + part.by;
        const jx = Math.sin(scene.time * 1.8 + part.ph) * inv * 9;
        const jy = Math.cos(scene.time * 1.4 + part.ph) * inv * 9;
        const x = inv * inv * part.x0 + 2 * inv * u * mx + u * u * tx + jx;
        const y = inv * inv * part.y0 + 2 * inv * u * my + u * u * ty + jy;
        const appear = smoothstep(progress, part.delay - 0.06, part.delay + 0.04);
        const size = part.size * (1.15 - u * 0.25);
        drawParticle(ctx, x, y, size, part.r, part.g, part.b, appear * remain * fade * 0.8);
      }
      ctx.restore();
      const imageAlpha = smoothstep(progress, 0.34, 0.92) * fade;
      if (imageAlpha > 0.01) {
        const scale = lerp(1.08, 1, ease) * (1 + Math.sin(scene.time * 0.5 + index) * 0.012);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(Math.sin(scene.time * 0.28 + index) * 0.025);
        ctx.scale(scale, scale);
        ctx.globalAlpha = imageAlpha;
        ctx.drawImage(photo.plate, -box.w / 2, -box.h / 2, box.w, box.h);
        ctx.restore();
      }
    });

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i]) continue;
      if (pool.mode[i] === 0 && pose.show && !scene.explode) {
        const along = (pool.x[i] - pose.x) * dirX + (pool.y[i] - pose.y) * dirY;
        if (along > -wingspan * 0.2) continue;
      }
      if (pool.mode[i] === 1) {
        const alpha = smoothstep(scene.burstU, 0.16, 0.55) * (0.35 + (1 - scene.text) * 0.65);
        drawParticle(ctx, pool.x[i], pool.y[i], pool.size[i], pool.r[i], pool.g[i], pool.b[i], alpha * 0.85);
        continue;
      }
      // Quick fade in, long slow fade out, shrinking with age, with a little per-mote twinkle.
      const age = 1 - clamp(pool.life[i] / pool.max[i], 0, 1);
      const fadeIn = clamp(age / 0.07, 0, 1);
      const fadeOut = age < 0.15 ? 1 : ((1 - age) / 0.85) ** 1.6;
      const seed = pool.seed[i];
      const twinkle = 0.74 + 0.26 * Math.sin(scene.time * (5 + seed * 5) + seed * 40);
      const size = pool.size[i] * (1 - age * 0.6);
      drawParticle(ctx, pool.x[i], pool.y[i], size, pool.r[i], pool.g[i], pool.b[i], fadeIn * fadeOut * twinkle * 0.78);
    }
    ctx.globalAlpha = 1;
    if (scene.burstU > 0.12 && scene.burstU < 0.72 && pose.show) {
      const flash = Math.sin(clamp((scene.burstU - 0.12) / 0.42, 0, 1) * Math.PI);
      const radius = Math.min(w, h) * (0.12 + scene.burstU * 0.55);
      const g = ctx.createRadialGradient(pose.x, pose.y, 0, pose.x, pose.y, radius);
      g.addColorStop(0, `rgba(255, 250, 244, ${flash * 0.8})`);
      g.addColorStop(0.28, `rgba(255, 186, 230, ${flash * 0.38})`);
      g.addColorStop(0.62, `rgba(120, 90, 255, ${flash * 0.16})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  function layoutStill(head, w, h, ink) {
    reset();
    ensurePath(head, w, h);
    const box = photoBox(w, h);
    const soil = h * (h > w * 1.05 ? 0.9 : 0.88);
    const rows = Math.ceil(config.photos.length / 2);
    const left = w * 0.14;
    const right = w * 0.86;
    // Rows go in the band between the words and the ground. When that band would shrink the photos below
    // MIN_SCALE (tall phones), some rows move to the empty band above the heading instead.
    const below = { top: clamp(ink.bottom + PAD, 0, soil - 1), bottom: soil };
    const above = { top: PAD, bottom: Math.max(PAD, ink.top - PAD) };
    const fitW = Math.min((right - left - PAD - DRIFT_X * 2) / (box.w * 1.05), (w * 0.28 - DRIFT_X * 2) / (box.w * 0.96));
    const fitBand = (band, count) => {
      if (!count) return Infinity;
      const pitch = (band.bottom - band.top) / count;
      return (pitch - PAD - DRIFT_Y * 2) / (box.h * 1.05);
    };
    const scaleFor = (up) => Math.min(1, fitW, fitBand(above, up), fitBand(below, rows - up));
    let up = 0;
    if (scaleFor(0) < MIN_SCALE) {
      for (let k = 1; k <= rows; k++) if (scaleFor(k) > scaleFor(up)) up = k;
    }
    // On wide screens the margins beside the words are free from top to ground: use them when photos come out larger.
    const full = { top: PAD, bottom: soil };
    const margin = Math.min(ink.left, w - ink.right) - PAD;
    const besideScale = Math.min(1, (margin - PAD - DRIFT_X * 2) / (box.w * 1.05), fitBand(full, rows));
    const beside = besideScale > scaleFor(up);
    const scale = clamp(beside ? besideScale : scaleFor(up), 0.2, 1);
    const half = box.w * scale * 0.48;
    const rowY = (row) => {
      if (beside) return full.top + ((full.bottom - full.top) / rows) * (row + 0.5);
      const band = row < up ? above : below;
      const count = row < up ? up : rows - up;
      const slot = row < up ? row : row - up;
      return band.top + ((band.bottom - band.top) / count) * (slot + 0.5);
    };
    const colX = (side) => {
      if (beside) return side < 0 ? ink.left / 2 : (ink.right + w) / 2;
      return clamp(side < 0 ? left : right, half, w - half);
    };
    config.photos.forEach((_, index) => {
      const plate = plates[index];
      if (!plate) return;
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      photos.push({
        index,
        anchorX: colX(side),
        anchorY: rowY(row),
        scale,
        age: 10,
        plate: plate.plate,
        parts: [],
        side,
      });
    });
    return { x: head.x, y: head.y };
  }

  // For ?debug: each photo's drawn box (before drift) so overlap can be checked from the console.
  function inspect(w, h) {
    const unit = photoBox(w, h);
    return photos.map((photo) => ({ x: photo.anchorX, y: photo.anchorY, w: unit.w * photo.scale, h: unit.h * photo.scale, scale: photo.scale }));
  }

  return { ready, reset, flight, update, draw, resize, layoutStill, inspect };
}
