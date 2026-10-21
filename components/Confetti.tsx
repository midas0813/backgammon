"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const COLORS = ["#65E2BC", "#F4CF87", "#F7F1E6", "#9DB7FF", "#FFA8B6"];

/**
 * One-shot CSS confetti burst (skipped automatically under reduced motion). It falls through the part
 * of the page that was on screen when it fired and scrolls away with the page, then removes itself.
 */
export default function Confetti({ pieces = 90 }: { pieces?: number }) {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured once, on the client, when the burst starts
    setArea({ top: window.scrollY, height: window.innerHeight });
    const t = window.setTimeout(() => setArea(null), 4200);
    return () => window.clearTimeout(t);
  }, []);
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
  if (!area) return null;
  return createPortal(
    <div className="confetti" style={{ top: area.top, height: area.height, "--fall": `${area.height}px` } as React.CSSProperties} aria-hidden>
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
    </div>,
    document.body,
  );
}
