"use client";

import { useEffect, useRef, useState } from "react";

/** A number that counts to its new value (instant under reduced motion). */
export default function CountUp({ value, format = (n) => String(n), ms = 700 }: { value: number; format?: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    const reduced =
      document.documentElement.dataset.reducedMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (from === value || reduced) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className="count-up">{format(shown)}</span>;
}
