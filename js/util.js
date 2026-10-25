export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t, edge0, edge1) {
  const x = clamp((t - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

export function easeInOut(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
}

export function easeOutCubic(t) {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}

export function sinc(x) {
  return Math.abs(x) < 1e-4 ? 1 : Math.sin(x) / x;
}

export function profile(u) {
  const c = clamp(u, 0, 1);
  return Math.sin(Math.PI * c ** 0.75) ** 0.85;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(rng) {
  let u = 1 - rng();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * rng());
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function qualityFactor() {
  const cores = navigator.hardwareConcurrency || 4;
  const small = Math.min(window.innerWidth, window.innerHeight) < 760;
  let q = small ? 0.68 : 1;
  if (cores <= 4) q *= 0.82;
  return clamp(q, 0.48, 1);
}
