import { clamp, smoothstep } from "./util.js";

const ORDER = ["dawn", "flower", "emerge", "hover", "journey", "ascend", "burst"];

export function createClock(timing) {
  let cursor = 0;
  const phases = ORDER.map((name) => {
    const dur = Math.max(0.001, timing[name]);
    const start = cursor;
    cursor += dur;
    return { name, start, end: cursor, dur };
  });
  const total = cursor;
  const byName = Object.fromEntries(phases.map((phase) => [phase.name, phase]));

  function phaseU(name, time) {
    const phase = byName[name];
    if (time <= phase.start) return 0;
    if (time >= phase.end) return 1;
    return (time - phase.start) / phase.dur;
  }

  function at(time) {
    const t = Math.max(0, time);
    let current = phases[phases.length - 1];
    for (const phase of phases) {
      if (t < phase.end) {
        current = phase;
        break;
      }
    }
    const u = clamp((t - current.start) / current.dur, 0, 1);
    const flower = byName.flower;
    let flowerT = 0;
    if (t >= flower.end) flowerT = 24;
    else if (t > flower.start) flowerT = ((t - flower.start) / flower.dur) * 24;

    const pastBurst = t >= byName.burst.end;
    const burstU = pastBurst ? 1 : current.name === "burst" ? u : 0;
    const text = pastBurst ? 1 : current.name === "burst" ? smoothstep(u, 0.36, 0.74) : 0;
    const message = pastBurst ? 1 : current.name === "burst" ? smoothstep(u, 0.52, 0.9) : 0;
    const hold = t >= total;

    return {
      name: hold ? "hold" : current.name,
      time: t,
      u,
      flowerT,
      // The plant keeps breathing through the hover, then rests so the flight stays smooth.
      sway: t < byName.journey.start ? 1 : 0,
      showButterfly: t >= byName.emerge.start,
      emergeU: phaseU("emerge", t),
      hoverU: phaseU("hover", t),
      journeyU: phaseU("journey", t),
      ascendU: phaseU("ascend", t),
      burstU,
      text,
      message,
      emitTrail: t >= byName.journey.start && t < byName.burst.start + byName.burst.dur * 0.18,
      converge: (current.name === "ascend" && u > 0.62) || (current.name === "burst" && u < 0.28),
      explode: !hold && current.name === "burst" && u >= 0.2,
      glowBoost: current.name === "ascend" ? u : current.name === "burst" || hold ? 1 : 0,
      hold,
      total,
    };
  }

  return { at, total, phases };
}
