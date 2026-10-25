import { config } from "./config.js";
import { createButterfly } from "./butterfly.js";
import { createFlower } from "./flower.js";
import { createJourney } from "./journey.js";
import { createClock } from "./timeline.js";
import { clamp, easeOutCubic, lerp, qualityFactor, smoothstep } from "./util.js";

const params = new URLSearchParams(location.search);
const debug = params.has("debug");
const seekTo = Number(params.get("at"));
const motion = params.get("motion");
const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.getElementById("view");
const finale = document.getElementById("finale");
const headingEl = document.getElementById("heading");
const messageEl = document.getElementById("message");
const replay = document.getElementById("replay");
const pausedEl = document.getElementById("paused");
const fallback = document.getElementById("fallback");

let ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (!ctx) ctx = canvas.getContext("2d", { alpha: false });

fillCopy(headingEl, config.heading);
messageEl.textContent = config.message;
fillCopy(fallback.querySelector("h1"), config.heading);
fallback.querySelector("p").textContent = config.message;

if (!ctx) {
  showFallback();
} else {
  boot(ctx);
}

function fillCopy(node, heading) {
  node.replaceChildren();
  for (const line of heading.split(/\s+/).filter(Boolean)) {
    const span = document.createElement("span");
    span.textContent = line;
    node.append(span);
  }
}

function showFallback() {
  canvas.hidden = true;
  finale.hidden = true;
  replay.hidden = true;
  fallback.hidden = false;
}

function boot(ctx) {
  const quality = qualityFactor();
  const clock = createClock(config.timing);
  const flower = createFlower(quality);
  const butterfly = createButterfly(quality);
  const journey = createJourney(config, quality);
  const stars = createStars();

  let reduced = motion === "full" ? false : motion === "reduce" || prefersReduce;
  let time = 0;
  let paused = params.has("pause");
  let last = performance.now();
  let booted = false;
  let lastW = 0;
  let lastH = 0;
  let stillKey = "";
  let sky = null;
  let skyInk = null;
  let shoot = null;
  let fps = 60;

  replay.addEventListener("click", () => restart(true));
  window.addEventListener("keydown", (event) => {
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      restart(true);
      return;
    }
    if (event.key === " " && event.target === document.body) {
      event.preventDefault();
      if (reduced) restart(true);
      else paused = !paused;
    }
  });
  window.addEventListener("resize", () => {
    stillKey = "";
  });

  journey.ready.then(() => requestAnimationFrame(frame)).catch((error) => {
    console.error(error);
    showFallback();
  });

  function restart(forcePlay) {
    if (forcePlay) reduced = false;
    time = 0;
    paused = false;
    booted = true;
    stillKey = "";
    journey.reset();
    last = performance.now();
    replay.textContent = "Replay";
  }

  function wingspan(w, h) {
    return clamp(Math.min(w, h) * 0.25, 108, 250);
  }

  function flapOf(scene, pose, dt) {
    let freq = 3;
    let amp = 0.45;
    if (scene.name === "emerge") {
      freq = lerp(2.4, 4.8, scene.emergeU);
      amp = lerp(0.32, 0.72, scene.emergeU);
    } else if (scene.name === "hover") {
      freq = 3.1;
      amp = 0.5;
    } else if (scene.name === "journey") {
      freq = 5.6;
      amp = 0.94;
    } else if (scene.name === "ascend" || scene.name === "burst" || scene.name === "hold") {
      const u = scene.name === "ascend" ? scene.ascendU : 1;
      freq = lerp(5.6, 9.6, u);
      amp = lerp(0.94, 1.14, u);
    }
    const speedX = pose.vx / Math.max(dt, 1 / 120);
    return {
      freq,
      amp,
      bank: clamp(-speedX * 0.00115, -0.46, 0.46),
      time: scene.time,
    };
  }

  function headingInk() {
    const stamp = performance.now();
    if (skyInk && stamp - skyInk.at < 1000) return skyInk;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const node of headingEl.querySelectorAll("span")) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      left = Math.min(left, rect.left - 14);
      right = Math.max(right, rect.right + 14);
      top = Math.min(top, rect.top - 10);
      bottom = Math.max(bottom, rect.bottom + 10);
    }
    skyInk = { at: stamp, left, right, top, bottom };
    return skyInk;
  }

  function inInk(x, y, pad, ink) {
    return x > ink.left - pad && x < ink.right + pad && y > ink.top - pad && y < ink.bottom + pad;
  }

  // Upper right, nudged clear of the heading when the words reach that far,
  // and clear of the resting photos in the still layout.
  function moonSpot(w, h, ink) {
    const r = Math.min(w, h) * 0.045;
    const photos = reduced ? journey.inspect(w, h) : [];
    const clear = (x, y) =>
      !inInk(x, y, r * 1.4, ink) &&
      photos.every((p) => Math.abs(p.x - x) > p.w / 2 + r * 1.4 || Math.abs(p.y - y) > p.h / 2 + r * 1.4);
    const spots = [
      { x: w * 0.82, y: h * 0.14 },
      { x: Math.min(ink.right + r * 1.6, w - r * 1.5), y: h * 0.14 },
      { x: w * 0.82, y: Math.max(ink.top - r * 1.6, r * 1.5) },
      { x: w * 0.5, y: Math.max(ink.top - r * 1.8, r * 1.5) },
    ];
    const spot = spots.find((s) => clear(s.x, s.y)) || spots[0];
    return { x: spot.x, y: spot.y, r };
  }

  function drawStars(w, h, now, ink) {
    ctx.save();
    for (const star of stars) {
      const x = ((((star.x + (reduced ? 0 : now * star.drift)) % 1) + 1) % 1) * w;
      const y = star.y * h;
      if (inInk(x, y, 0, ink)) continue;
      const twinkle = reduced ? 0.85 : 0.7 + 0.3 * Math.sin(now * star.speed + star.phase);
      const alpha = star.alpha * twinkle;
      if (star.glow) {
        const halo = star.r * 7;
        ctx.globalAlpha = alpha * 0.22;
        ctx.drawImage(star.sprite, x - halo, y - halo, halo * 2, halo * 2);
      }
      const size = star.r * 2.6;
      ctx.globalAlpha = alpha;
      ctx.drawImage(star.sprite, x - size / 2, y - size / 2, size, size);
    }
    ctx.restore();
  }

  // A faint streak every 8-15 seconds, kept off the heading. None under reduced motion.
  function drawShootingStar(w, h, now, ink) {
    if (reduced) return;
    if (!shoot || now < shoot.t0 - 16) shoot = { t0: now + 8 + Math.random() * 7, live: null };
    if (now >= shoot.t0 && !shoot.live) {
      shoot.live = launchShootingStar(w, h, ink);
      if (!shoot.live) shoot = { t0: now + 8 + Math.random() * 7, live: null };
    }
    const live = shoot.live;
    if (!live) return;
    const p = (now - shoot.t0) / live.dur;
    if (p >= 1) {
      shoot = { t0: now + 8 + Math.random() * 7, live: null };
      return;
    }
    const travel = easeOutCubic(p) * live.dist;
    const hx = live.x + live.dx * travel;
    const hy = live.y + live.dy * travel;
    const tail = Math.min(travel, live.dist * 0.32);
    const alpha = Math.sin(p * Math.PI) * 0.32;
    const g = ctx.createLinearGradient(hx - live.dx * tail, hy - live.dy * tail, hx, hy);
    g.addColorStop(0, "rgba(220, 230, 255, 0)");
    g.addColorStop(1, `rgba(240, 244, 255, ${alpha})`);
    ctx.save();
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hx - live.dx * tail, hy - live.dy * tail);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.restore();
  }

  function launchShootingStar(w, h, ink) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const leftward = Math.random() < 0.5;
      const angle = (leftward ? Math.PI - 0.5 : 0.5) + (Math.random() - 0.5) * 0.3;
      const dist = Math.min(w, h) * (0.22 + Math.random() * 0.12);
      const x = w * (leftward ? 0.35 + Math.random() * 0.6 : 0.05 + Math.random() * 0.6);
      const y = h * (0.04 + Math.random() * 0.3);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let clear = true;
      for (let k = 0; k <= 8 && clear; k++) clear = !inInk(x + dx * dist * (k / 8), y + dy * dist * (k / 8), 12, ink);
      if (clear) return { x, y, dx, dy, dist, dur: 0.9 + Math.random() * 0.4 };
    }
    return null;
  }

  function drawSky(w, h, now, heart, glow) {
    if (!sky || sky.w !== w || sky.h !== h) {
      sky = { w, h, base: ctx.createLinearGradient(0, 0, 0, h), moon: null };
      sky.base.addColorStop(0, "#070612");
      sky.base.addColorStop(0.42, config.colors.skyLift);
      sky.base.addColorStop(1, config.colors.sky);
      skyInk = null;
    }
    ctx.fillStyle = sky.base;
    ctx.fillRect(0, 0, w, h);
    const ink = headingInk();
    drawStars(w, h, now, ink);
    drawShootingStar(w, h, now, ink);
    const moon = moonSpot(w, h, ink);
    if (!sky.moon) sky.moon = renderMoon(moon.r, Math.min(window.devicePixelRatio || 1, 1.75));
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.drawImage(sky.moon.canvas, moon.x - sky.moon.half, moon.y - sky.moon.half, sky.moon.half * 2, sky.moon.half * 2);
    ctx.restore();
    const glowRadius = Math.min(w, h) * (0.18 + glow * 0.22);
    const aura = ctx.createRadialGradient(heart.x, heart.y, 0, heart.x, heart.y, glowRadius);
    aura.addColorStop(0, `rgba(186, 92, 214, ${0.05 + glow * 0.22})`);
    aura.addColorStop(0.45, `rgba(86, 42, 140, ${0.04 + glow * 0.1})`);
    aura.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, w, h);
    const ground = ctx.createLinearGradient(0, h * 0.78, 0, h);
    ground.addColorStop(0, "rgba(0, 0, 0, 0)");
    ground.addColorStop(0.55, "rgba(18, 10, 14, 0.28)");
    ground.addColorStop(1, "rgba(8, 5, 8, 0.72)");
    ctx.fillStyle = ground;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
  }

  function vignette(w, h) {
    const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.28, w / 2, h * 0.5, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(1, "rgba(0, 0, 0, 0.48)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function syncDom(scene) {
    const text = reduced ? 1 : scene.text;
    const message = reduced ? 1 : scene.message;
    headingEl.style.opacity = String(text);
    messageEl.style.opacity = String(message);
    finale.style.visibility = text > 0.02 ? "visible" : "hidden";
    finale.setAttribute("aria-hidden", text > 0.04 ? "false" : "true");
    replay.textContent = reduced ? "Play" : "Replay";
    pausedEl.hidden = !paused || reduced;
  }

  function resizeTo(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (lastW && (lastW !== w || lastH !== h)) journey.resize(w, h);
    lastW = w;
    lastH = h;
  }

  function simulate(target, w, h) {
    const step = 1 / 30;
    let t = 0;
    while (t < target - 1e-4) {
      const dt = Math.min(step, target - t);
      t += dt;
      const scene = clock.at(t);
      const heart = flower.sample(w, h, scene.flowerT, t, scene.sway);
      const pose = journey.flight(scene, heart, w, h);
      const span = wingspan(w, h);
      journey.update(dt, scene, pose, w, h, span, butterfly, flapOf(scene, pose, dt));
    }
    time = target;
  }

  function textInk() {
    const nodes = [...headingEl.querySelectorAll("span"), messageEl];
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    if (!Number.isFinite(left)) return { left: 0, right: 0, top: 0, bottom: 0 };
    return { left, right, top, bottom };
  }

  function overlapsInk(x, y, halfW, halfH, ink) {
    return x + halfW > ink.left - 12 && x - halfW < ink.right + 12 && y + halfH > ink.top - 8 && y - halfH < ink.bottom + 10;
  }

  function placeStillButterfly(heart, w, h) {
    const ink = textInk();
    let span = Math.min(wingspan(w, h) * 0.78, Math.min(w, h) * 0.22);
    const centered = { x: heart.x, y: clamp(heart.y - span * 0.5, span * 0.4, h - span * 0.4) };
    if (!overlapsInk(centered.x, centered.y, span * 0.5, span * 0.38, ink)) return { ...centered, span };

    const rooms = [
      { side: 1, room: w - ink.right },
      { side: -1, room: ink.left },
    ].sort((a, b) => b.room - a.room);
    for (const choice of rooms) {
      const fit = Math.min(span, Math.max(0, choice.room - 18));
      if (fit < 78) continue;
      const x = choice.side > 0 ? ink.right + choice.room * 0.52 : choice.room * 0.48;
      const y = clamp(ink.top * 0.4 + ink.bottom * 0.6, fit * 0.4 + 8, h * 0.62);
      const pose = { x: clamp(x, fit * 0.5 + 6, w - fit * 0.5 - 6), y };
      if (!overlapsInk(pose.x, pose.y, fit * 0.5, fit * 0.38, ink)) return { ...pose, span: fit };
    }

    const fit = clamp(heart.y - ink.bottom - 16, 64, span);
    return {
      x: heart.x,
      y: clamp(ink.bottom + fit * 0.42 + 6, fit * 0.4, heart.y - 6),
      span: fit,
    };
  }

  function drawStill(w, h) {
    const heart = flower.sample(w, h, 24, 1, 0);
    drawSky(w, h, 1, heart, 1);
    flower.draw(ctx, w, h, 24, 1, 0);
    const guest = placeStillButterfly(heart, w, h);
    const ink = textInk();
    const key = `${w}x${h}:${Math.round(ink.bottom)}`;
    if (stillKey !== key) {
      journey.layoutStill(heart, w, h, ink);
      stillKey = key;
    }
    journey.draw(
      ctx,
      { time: 1, burstU: 0, hold: false, text: 1, explode: false },
      { x: guest.x, y: guest.y, show: false },
      w,
      h,
      guest.span,
    );
    butterfly.draw(ctx, guest.x, guest.y, guest.span, 0, 0.65, 2.4, 0.7, 1, 0.55);
    vignette(w, h);
    if (debug) canvas.dataset.photos = JSON.stringify(journey.inspect(w, h));
  }

  function frame(now) {
    try {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) {
        requestAnimationFrame(frame);
        return;
      }
      resizeTo(w, h);
      if (!booted) {
        booted = true;
        if (!reduced && Number.isFinite(seekTo) && seekTo > 0) simulate(seekTo, w, h);
        last = now;
      }

      if (reduced) {
        drawStill(w, h);
        syncDom(clock.at(clock.total));
        requestAnimationFrame(frame);
        return;
      }

      let dt = (now - last) / 1000;
      last = now;
      if (document.hidden || paused) dt = 0;
      else dt = clamp(dt, 0, 0.05);
      time += dt;
      const scene = clock.at(time);
      const heart = flower.sample(w, h, scene.flowerT, scene.time, scene.sway);
      drawSky(w, h, scene.time, heart, heart.pose.glow);
      flower.draw(ctx, w, h, scene.flowerT, scene.time, scene.sway);
      const pose = journey.flight(scene, heart, w, h);
      const span = wingspan(w, h);
      const flap = flapOf(scene, pose, dt || 1 / 60);
      journey.update(dt, scene, pose, w, h, span, butterfly, flap);
      journey.draw(ctx, scene, pose, w, h, span);
      if (scene.name === "emerge" && scene.emergeU < 0.65) {
        const flash = Math.sin((scene.emergeU / 0.65) * Math.PI);
        const light = ctx.createRadialGradient(heart.x, heart.y, 0, heart.x, heart.y, span * 0.55);
        light.addColorStop(0, `rgba(255, 236, 210, ${flash * 0.45})`);
        light.addColorStop(0.4, `rgba(255, 170, 220, ${flash * 0.16})`);
        light.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(heart.x, heart.y, span * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (scene.showButterfly && scene.name !== "hold") {
        const alpha = scene.name === "burst" ? 1 - smoothstep(scene.burstU, 0.05, 0.3) : scene.name === "emerge" ? smoothstep(scene.emergeU, 0.02, 0.2) : 1;
        const scale = scene.name === "emerge" ? easeOutCubic(scene.emergeU) : 1 + (scene.name === "ascend" ? scene.ascendU * 0.04 : 0);
        const glow = clamp(0.4 + scene.glowBoost * 1.15 + (scene.name === "journey" ? 0.15 : 0), 0, 1.7);
        butterfly.draw(ctx, pose.x, pose.y, span * Math.max(scale, 0.04), flap.bank, scene.time, flap.freq, flap.amp, alpha, glow);
      }
      vignette(w, h);
      if (debug) {
        canvas.dataset.photos = JSON.stringify(journey.inspect(w, h));
        fps = fps * 0.9 + (dt > 0 ? 0.1 * (1 / dt) : 6);
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.font = "13px Outfit, Segoe UI, sans-serif";
        ctx.fillText(`${scene.name}  ${scene.time.toFixed(1)}s  ${Math.round(fps)} fps`, 16, 24);
      }
      syncDom(scene);
      requestAnimationFrame(frame);
    } catch (error) {
      console.error(error);
      showFallback();
    }
  }
}

function starSprite(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const c = canvas.getContext("2d");
  const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, `rgba(${color}, 1)`);
  g.addColorStop(0.42, `rgba(${color}, 0.9)`);
  g.addColorStop(0.7, `rgba(${color}, 0.22)`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 16, 16);
  return canvas;
}

// Three depths: many faint pinpricks, fewer small stars, and a handful of brighter ones with a soft glow.
function createStars() {
  const sprites = [starSprite("196, 212, 255"), starSprite("255, 222, 240"), starSprite("255, 240, 214")];
  const layers = [
    { count: 140, r: [0.35, 0.7], alpha: [0.15, 0.3], drift: 0.0005, glow: false },
    { count: 72, r: [0.7, 1.1], alpha: [0.25, 0.45], drift: 0.0009, glow: false },
    { count: 14, r: [1.1, 1.6], alpha: [0.45, 0.6], drift: 0.0014, glow: true },
  ];
  const stars = [];
  for (const layer of layers) {
    for (let i = 0; i < layer.count; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random() * 0.82,
        r: lerp(layer.r[0], layer.r[1], Math.random()),
        alpha: lerp(layer.alpha[0], layer.alpha[1], Math.random()),
        drift: layer.drift,
        glow: layer.glow,
        speed: 0.35 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
        sprite: sprites[Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2],
      });
    }
  }
  return stars;
}

// A gently shaded full moon in warm off-white with faint craters and a wide, soft halo. Drawn once per size.
function renderMoon(r, dpr) {
  const half = r * 3.2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(half * 2 * dpr);
  canvas.height = canvas.width;
  const c = canvas.getContext("2d");
  c.scale(dpr, dpr);
  const cx = half;
  const cy = half;
  const halo = c.createRadialGradient(cx, cy, r * 0.8, cx, cy, half);
  halo.addColorStop(0, "rgba(244, 236, 223, 0.2)");
  halo.addColorStop(0.3, "rgba(244, 236, 223, 0.07)");
  halo.addColorStop(1, "rgba(244, 236, 223, 0)");
  c.fillStyle = halo;
  c.fillRect(0, 0, half * 2, half * 2);
  const body = c.createRadialGradient(cx - r * 0.35, cy - r * 0.38, r * 0.1, cx, cy, r * 1.05);
  body.addColorStop(0, "#fdf8ef");
  body.addColorStop(0.65, "#f4ecdf");
  body.addColorStop(1, "#d8cbb6");
  c.fillStyle = body;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.clip();
  const craters = [
    [-0.32, -0.18, 0.22, 0.16],
    [0.18, -0.4, 0.13, 0.12],
    [0.3, 0.12, 0.2, 0.13],
    [-0.12, 0.38, 0.15, 0.12],
    [-0.5, 0.22, 0.1, 0.1],
    [0.05, 0.02, 0.09, 0.08],
  ];
  for (const [dx, dy, size, alpha] of craters) {
    const x = cx + dx * r;
    const y = cy + dy * r;
    const g = c.createRadialGradient(x, y, 0, x, y, size * r);
    g.addColorStop(0, `rgba(150, 132, 116, ${alpha})`);
    g.addColorStop(0.7, `rgba(150, 132, 116, ${alpha * 0.6})`);
    g.addColorStop(1, "rgba(150, 132, 116, 0)");
    c.fillStyle = g;
    c.fillRect(x - size * r, y - size * r, size * r * 2, size * r * 2);
  }
  const shade = c.createRadialGradient(cx - r * 0.55, cy - r * 0.5, r * 0.6, cx - r * 0.2, cy - r * 0.2, r * 1.6);
  shade.addColorStop(0, "rgba(30, 20, 44, 0)");
  shade.addColorStop(1, "rgba(30, 20, 44, 0.42)");
  c.fillStyle = shade;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);
  c.restore();
  return { canvas, half, r };
}
