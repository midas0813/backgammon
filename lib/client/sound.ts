"use client";

/**
 * Tiny synthesized sound effects (Web Audio, no files). Played only when the player's "Sound"
 * setting is on; browsers also require a prior tap before audio can start.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, gain = 0.08, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

function clack(start: number, gain = 0.25) {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.04);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  const filter = a.createBiquadFilter();
  const g = a.createGain();
  filter.type = "bandpass";
  filter.frequency.value = 1800 + Math.random() * 900;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(a.currentTime + start);
}

function sweep(from: number, to: number, start: number, dur: number, gain = 0.25, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, a.currentTime + start);
  o.frequency.exponentialRampToValueAtTime(to, a.currentTime + start + dur);
  g.gain.setValueAtTime(gain, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

export const sounds = {
  /** Big doubles: drum roll, bass hit, rising chord. `power` 1–2. */
  bigRoll(power = 1) {
    for (let i = 0; i < 8; i++) clack(i * 0.045, 0.12 + i * 0.02);
    sweep(140, 42, 0.42, 0.55, 0.35 * power);
    clack(0.42, 0.5);
    const base = power > 1 ? [523, 659, 784, 1047, 1319] : [440, 554, 659, 880];
    base.forEach((f, i) => tone(f, 0.5 + i * 0.07, 0.5, 0.06, "triangle"));
  },
  /** Small doubles chip. */
  doubles() {
    tone(784, 0, 0.12, 0.06, "triangle");
    tone(1047, 0.08, 0.18, 0.06, "triangle");
  },
  hit() {
    sweep(220, 60, 0, 0.22, 0.3, "triangle");
    clack(0, 0.45);
  },
  heartbeat() {
    for (const t of [0, 0.22, 0.9, 1.12]) sweep(90, 45, t, 0.16, 0.32);
  },
  cubeSlam() {
    sweep(180, 50, 0, 0.3, 0.35, "square");
    clack(0, 0.5);
  },
  banner() {
    tone(587, 0, 0.16, 0.05, "triangle");
    tone(880, 0.1, 0.3, 0.05, "triangle");
  },
  dice() {
    for (let i = 0; i < 5; i++) clack(i * 0.06 + Math.random() * 0.03, 0.18 + Math.random() * 0.1);
  },
  move() {
    clack(0, 0.3);
    tone(180, 0, 0.08, 0.05, "triangle");
  },
  turn() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.3, 0.05, "triangle"));
    tone(1568, 0.3, 0.45, 0.025);
  },
  joined() {
    [392, 523, 659].forEach((f, i) => tone(f, i * 0.09, 0.22, 0.08, "triangle"));
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, 0.07, "triangle"));
  },
};
