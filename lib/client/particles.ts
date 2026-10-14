"use client";

/** A one-shot particle burst on a canvas (sparks with gravity). Returns a stop function. */
export function burst(
  canvas: HTMLCanvasElement,
  opts: { colors: string[]; count?: number; x?: number; y?: number; power?: number; ms?: number },
): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const cx = (opts.x ?? 0.5) * w;
  const cy = (opts.y ?? 0.5) * h;
  const power = opts.power ?? 1;
  const parts = Array.from({ length: opts.count ?? 90 }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = (2 + Math.random() * 7) * power;
    return {
      x: cx,
      y: cy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 2 * power,
      r: 1.5 + Math.random() * 3.2,
      c: opts.colors[Math.floor(Math.random() * opts.colors.length)],
      life: 1,
      decay: 0.008 + Math.random() * 0.014,
      star: Math.random() < 0.3,
    };
  });
  let raf = 0;
  const end = performance.now() + (opts.ms ?? 1800);
  const frame = (now: number) => {
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of parts) {
      if (p.life <= 0) continue;
      alive++;
      p.vy += 0.16;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      if (p.star) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(now / 200);
        ctx.fillRect(-p.r * 1.6, -p.r * 0.35, p.r * 3.2, p.r * 0.7);
        ctx.fillRect(-p.r * 0.35, -p.r * 1.6, p.r * 0.7, p.r * 3.2);
        ctx.restore();
      } else {
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (alive && now < end) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, w, h);
  };
}
