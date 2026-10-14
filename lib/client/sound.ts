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

export const sounds = {
  dice() {
    for (let i = 0; i < 5; i++) clack(i * 0.06 + Math.random() * 0.03, 0.18 + Math.random() * 0.1);
  },
  move() {
    clack(0, 0.3);
    tone(180, 0, 0.08, 0.05, "triangle");
  },
  turn() {
    tone(660, 0, 0.18);
    tone(880, 0.12, 0.25);
  },
  joined() {
    [392, 523, 659].forEach((f, i) => tone(f, i * 0.09, 0.22, 0.08, "triangle"));
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, 0.07, "triangle"));
  },
};
