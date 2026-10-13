"use client";

import { useEffect, useRef, useState } from "react";

interface Stats {
  players: number;
  liveMatches: number;
  gamesPlayed: number;
}

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString("en-US")}</>;
}

/** Real numbers from this server — no inflated marketing figures. */
export default function LiveStats() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/stats", { cache: "no-store" })
        .then((r) => r.json())
        .then(setS)
        .catch(() => {});
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, []);
  const items = [
    { label: "Live matches", value: s?.liveMatches ?? 0, live: true },
    { label: "Games played", value: s?.gamesPlayed ?? 0 },
    { label: "Players", value: s?.players ?? 0 },
  ];
  return (
    <dl className="l-stats">
      {items.map((it) => (
        <div key={it.label}>
          <dt>
            {it.live && <span className="badge live" style={{ padding: 0, border: 0, background: "none" }} />}
            {it.label}
          </dt>
          <dd className="mono">{s ? <CountUp value={it.value} /> : "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
