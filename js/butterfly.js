import { clamp, mix, mulberry32 } from "./util.js";

// Temple H. Fay's butterfly curve, the same equation neonButterfly draws with turtle.
function fay(angle, scale) {
  const radius =
    (Math.exp(Math.cos(angle)) - 2 * Math.cos(4 * angle) + Math.sin(angle / 12) ** 5) * scale;
  return [radius * Math.sin(angle), radius * Math.cos(angle)];
}

function strokeColor(scale) {
  let color;
  if (scale < 41) color = mix([0.32, 0.95, 1], [0.22, 0.42, 1], scale / 41);
  else if (scale < 74) color = mix([0.22, 0.42, 1], [0.88, 0.2, 1], (scale - 41) / 33);
  else {
    let amount = (scale - 74) / 18;
    amount = amount * amount * (3 - 2 * amount);
    color = mix([0.88, 0.2, 1], [0.24, 0.025, 0.42], amount);
  }
  return color;
}

function build(quality) {
  const rng = mulberry32(12);
  const count = Math.round(2800 * quality);
  const seeds = [];
  for (let i = 0; i < count; i++) seeds.push([rng() * Math.PI * 2, 3 + rng() * 89]);
  seeds.sort((a, b) => a[1] - b[1]);

  const groups = { LU: [], LL: [], RU: [], RL: [], body: [] };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [angle, scale] of seeds) {
    const [x, y] = fay(angle, scale);
    const jitter = (rng() - 0.5) * 0.36;
    const theta = Math.atan2(y, x) + jitter;
    const length = 3 + rng() * 5;
    const x2 = x + length * Math.cos(theta);
    const y2 = y + length * Math.sin(theta);
    const midX = (x + x2) / 2;
    const midY = (y + y2) / 2;
    minX = Math.min(minX, x, x2);
    maxX = Math.max(maxX, x, x2);
    minY = Math.min(minY, y, y2);
    maxY = Math.max(maxY, y, y2);
    let color = strokeColor(scale);
    const lower = midY < -18;
    let group = "body";
    if (Math.abs(midX) > 26) {
      if (midX < 0) group = lower ? "LL" : "LU";
      else group = lower ? "RL" : "RU";
    } else {
      color = mix(color, [0.82, 1, 1], 0.22);
    }
    groups[group].push({ x, y, x2, y2, color, width: 0.7 + rng() * 0.6 });
  }

  const span = Math.max(maxX - minX, maxY - minY);
  return { groups, minX, maxX, minY, maxY, span, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function openness(phase, amp) {
  const sine = 0.5 + 0.5 * Math.sin(phase);
  const depth = clamp(amp, 0, 1.25);
  const floor = 1 - depth * 0.52;
  return floor + (1 - floor) * sine;
}

function deform(x, y, open, lower, sign) {
  const hingeY = lower ? -78 : 36;
  const fold = (1 - open) * 0.5 * sign;
  const dy = y - hingeY;
  const x2 = x * (0.2 + 0.8 * open);
  const y2 = hingeY + dy * Math.cos(fold) - x * Math.sin(fold) * 0.1;
  return [x2, y2];
}

export function createButterfly(quality) {
  const model = build(quality);
  const size = quality > 0.8 ? 780 : 560;
  const board = document.createElement("canvas");
  board.width = size;
  board.height = size;
  const pen = board.getContext("2d");
  const fit = (size * 0.78) / model.span;
  const canFilter = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;

  function project(x, y) {
    return [(x - model.cx) * fit + size / 2, (model.cy - y) * fit + size / 2];
  }

  function pose(time, freq, amp) {
    const wobble = time * freq;
    return {
      LU: openness(wobble, amp),
      RU: openness(wobble + 0.68, amp),
      LL: openness(wobble * 1.06 + 0.42, amp * 1.08),
      RL: openness(wobble * 1.06 + 1.12, amp * 1.08),
    };
  }

  function point(group, x, y, open) {
    if (group === "body") return [x, y];
    const lower = group === "LL" || group === "RL";
    const sign = group === "LU" || group === "LL" ? -1 : 1;
    return deform(x, y, open, lower, sign);
  }

  function paintBoard(time, freq, amp, glow) {
    const open = pose(time, freq, amp);
    pen.clearRect(0, 0, size, size);
    pen.lineCap = "round";
    pen.globalCompositeOperation = "lighter";
    const order = ["LU", "LL", "RU", "RL"].sort((a, b) => open[a] - open[b]);
    order.push("body");
    for (const name of order) {
      const amount = name === "body" ? 1 : open[name];
      for (const stroke of model.groups[name]) {
        const [x1, y1] = point(name, stroke.x, stroke.y, amount);
        const [x2, y2] = point(name, stroke.x2, stroke.y2, amount);
        const a = project(x1, y1);
        const b = project(x2, y2);
        const boost = 0.82 + glow * 0.35;
        pen.strokeStyle = `rgba(${(stroke.color[0] * 255 * boost) | 0}, ${(stroke.color[1] * 255 * boost) | 0}, ${(stroke.color[2] * 255 * boost) | 0}, 0.92)`;
        pen.lineWidth = stroke.width * (name === "body" ? 5.2 : 7.4);
        pen.beginPath();
        pen.moveTo(a[0], a[1]);
        pen.lineTo(b[0], b[1]);
        pen.stroke();
      }
    }
  }

  function draw(ctx, x, y, wingspan, bank, time, freq, amp, alpha, glow) {
    if (alpha < 0.01 || wingspan < 8) return;
    paintBoard(time, freq, amp, glow);
    const dw = wingspan / 0.78;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bank);
    if (canFilter) {
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = `blur(${7 + glow * 8}px)`;
      ctx.globalAlpha = alpha * (0.55 + glow * 0.35);
      ctx.drawImage(board, -dw / 2, -dw / 2, dw, dw);
      ctx.filter = "none";
    } else {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha * 0.28;
      ctx.drawImage(board, -dw * 0.56, -dw * 0.56, dw * 1.12, dw * 1.12);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    ctx.drawImage(board, -dw / 2, -dw / 2, dw, dw);
    ctx.restore();
  }

  function sample(x, y, wingspan, bank, time, freq, amp, limit = 420) {
    const open = pose(time, freq, amp);
    const dw = wingspan / 0.78;
    const cos = Math.cos(bank);
    const sin = Math.sin(bank);
    const out = [];
    const names = ["LU", "LL", "RU", "RL", "body"];
    let seen = 0;
    const total = names.reduce((sum, name) => sum + model.groups[name].length, 0);
    const stride = Math.max(1, Math.floor(total / limit));
    for (const name of names) {
      const amount = name === "body" ? 1 : open[name];
      const strokes = model.groups[name];
      for (let i = 0; i < strokes.length; i += stride) {
        const stroke = strokes[i];
        const [lx, ly] = point(name, (stroke.x + stroke.x2) / 2, (stroke.y + stroke.y2) / 2, amount);
        const p = project(lx, ly);
        let ox = (p[0] / size - 0.5) * dw;
        let oy = (p[1] / size - 0.5) * dw;
        const wx = ox * cos - oy * sin;
        const wy = ox * sin + oy * cos;
        out.push({ x: x + wx, y: y + wy, color: stroke.color });
        if (++seen >= limit) return out;
      }
    }
    return out;
  }

  return { draw, sample };
}
