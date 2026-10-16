"use client";

import { useState } from "react";

const COLORS = ["#65E2BC", "#F4CF87", "#F7F1E6", "#9DB7FF", "#FFA8B6"];

/** One-shot CSS confetti burst (skipped automatically under reduced motion). */
export default function Confetti({ pieces = 90 }: { pieces?: number }) {
  // Random layout chosen once when the burst mounts.
  const [items] = useState(() =>
    Array.from({ length: pieces }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 1.8 + Math.random() * 1.6,
      drift: (Math.random() - 0.5) * 240,
      spin: 360 + Math.random() * 900,
      color: COLORS[i % COLORS.length],
      round: Math.random() < 0.3,
    })),
  );
  return (
    <div className="confetti" aria-hidden>
      {items.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              borderRadius: p.round ? "50%" : 2,
              "--delay": `${p.delay}s`,
              "--dur": `${p.dur}s`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
