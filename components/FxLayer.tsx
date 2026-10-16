"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Effect } from "@/lib/client/fx";
import { useLatest } from "@/lib/client/hooks";
import { burst } from "@/lib/client/particles";
import { sounds } from "@/lib/client/sound";

export interface FxHandle {
  play(effects: Effect[]): void;
}

const GOLD = ["#F4CF87", "#FFE6A8", "#D9A654", "#FFFFFF", "#65E2BC"];
const MINT = ["#65E2BC", "#B6F5E1", "#F7F1E6", "#9DB7FF"];
const EMBER = ["#FF6B81", "#FFA8B6", "#FFD3A1", "#FFFFFF"];

type Spot = { x: number; y: number };
// The particle canvas overhangs the board by 10% on every side.
const toCanvas = (v: number) => (v + 0.1) / 1.2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const DURATION: Record<Effect["kind"], number> = {
  doubles: 1700,
  hit: 1250,
  "cube-offer": 1500,
  "cube-take": 900,
  "cube-drop": 900,
  banner: 1900,
  "your-turn": 1700,
  "game-win": 1800,
  "match-win": 2600,
};
const duration = (e: Effect) => (e.kind === "doubles" ? (e.tier === "huge" ? 2100 : e.tier === "big" ? 1700 : 1100) : DURATION[e.kind]);
const blocking = (e: Effect) => (e.kind === "doubles" && e.tier !== "chip") || e.kind === "match-win";

// Rotation that turns each face of the CSS die towards the viewer.
const FACE_ROT: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] };
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACES: [number, string][] = [
  [1, "front"],
  [6, "back"],
  [3, "right"],
  [4, "left"],
  [5, "top"],
  [2, "bottom"],
];

/** `value` 0 draws a blank die (no pips), for moments with no real roll to show. */
function Die3D({ value, delay = 0, mini = false }: { value: number; delay?: number; mini?: boolean }) {
  const [rx, ry] = FACE_ROT[value] ?? [0, 0];
  return (
    <div className={`die3d-wrap${mini ? " mini" : ""}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="die3d" style={{ "--rx": `${rx}deg`, "--ry": `${ry}deg`, animationDelay: `${delay}ms` } as React.CSSProperties}>
        {FACES.map(([n, side]) => (
          <div key={side} className={`face ${side}`}>
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} className={value > 0 && PIPS[n].includes(i) ? "pip" : undefined} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function reducedMotion() {
  return document.documentElement.dataset.reducedMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Overlay over the board that plays effects one at a time. Never blocks the game for long: big
 * moments can be tapped away, and everything else ignores taps.
 */
export default function FxLayer({
  ref,
  sound,
  locate,
  bar,
}: {
  ref?: Ref<FxHandle>;
  sound: boolean;
  /** Board position (fractions) of a point given in `seat`'s own numbering. */
  locate?: (seat: 0 | 1, rel: number) => Spot;
  bar?: Spot;
}) {
  const locateRef = useLatest(locate);
  const [current, setCurrent] = useState<{ id: number; e: Effect; calm: boolean } | null>(null);
  const queue = useRef<Effect[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const nextId = useRef(1);
  const busy = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const soundRef = useLatest(sound);

  const advance = useCallback(function step() {
    window.clearTimeout(timer.current);
    const e = queue.current.shift();
    if (!e) {
      busy.current = false;
      setCurrent(null);
      return;
    }
    busy.current = true;
    const calm = reducedMotion();
    setCurrent({ id: nextId.current++, e, calm });
    timer.current = window.setTimeout(step, calm ? Math.min(1200, duration(e)) : duration(e));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      play(effects) {
        if (!effects.length) return;
        // A long backlog (e.g. returning to the tab) keeps only the latest few moments.
        queue.current = [...queue.current, ...effects].slice(-4);
        if (!busy.current) advance();
      },
    }),
    [advance],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Side effects of the effect now showing: sound, vibration, particles, shake.
  useEffect(() => {
    if (!current) return;
    const { e, calm } = current;
    const s = soundRef.current;
    let stop: (() => void) | undefined;
    const shake = (cls: string) => {
      const wrap = host.current?.parentElement;
      if (!wrap || calm) return;
      wrap.classList.remove("fx-shake", "fx-quake");
      void wrap.offsetWidth;
      wrap.classList.add(cls);
    };
    const sparks = (colors: string[], power: number, count: number, y = 0.45, x = 0.5) => {
      if (!calm && canvas.current) stop = burst(canvas.current, { colors, power, count, y, x });
    };
    switch (e.kind) {
      case "doubles":
        if (e.tier === "chip") {
          if (s) sounds.doubles();
        } else {
          if (s) sounds.bigRoll(e.tier === "huge" ? 2 : 1);
          navigator.vibrate?.(e.tier === "huge" ? [40, 60, 120] : [40, 50, 80]);
          window.setTimeout(() => {
            sparks(GOLD, e.tier === "huge" ? 1.5 : 1.1, e.tier === "huge" ? 170 : 110);
            shake("fx-quake");
          }, 520);
        }
        break;
      case "hit": {
        if (s) sounds.hit();
        navigator.vibrate?.(e.mine ? 35 : [50, 40, 70]);
        shake(e.mine ? "fx-shake" : "fx-quake");
        const spot = locateRef.current?.(e.seat, e.spots[0]);
        if (spot) sparks(e.mine ? GOLD : EMBER, 0.75, 70, toCanvas(spot.y), toCanvas(spot.x));
        break;
      }
      case "cube-offer":
        if (s) sounds.heartbeat();
        if (e.toYou) navigator.vibrate?.([30, 80, 30]);
        break;
      case "cube-take":
        if (s) sounds.cubeSlam();
        shake("fx-shake");
        break;
      case "banner":
        if (s) sounds.banner();
        break;
      case "your-turn":
        window.setTimeout(() => sparks(MINT, 0.55, 46, 0.5), 260);
        break;
      case "game-win":
        if (s) sounds.banner();
        if (e.mine !== false) sparks(GOLD, 1, 90);
        break;
      case "match-win":
        if (e.mine !== false) {
          sparks(GOLD, 1.4, 160, 0.4);
          window.setTimeout(() => sparks(MINT, 1.1, 120, 0.55), 450);
        }
        break;
    }
    return () => stop?.();
  }, [current, locateRef, soundRef]);

  const e = current?.e;
  const calm = current?.calm ?? false;
  return (
    <div ref={host} className={`fx-layer${e && blocking(e) && !calm ? " blocking" : ""}`} onClick={() => e && blocking(e) && advance()} aria-hidden>
      <canvas ref={canvas} className="fx-canvas" />
      {e && (
        <div key={current!.id} className={`fx ${calm ? "calm" : ""}`}>
          {e.kind === "doubles" &&
            (e.tier === "chip" || calm ? (
              <span className="fx-chip gold">
                {e.label} · {e.sub}
              </span>
            ) : (
              <div className={`fx-doubles ${e.tier}`}>
                <div className="fx-dim" />
                <div className="fx-rays" />
                <div className="fx-dice">
                  <Die3D value={e.value} />
                  <Die3D value={e.value} delay={90} />
                </div>
                <div className="fx-stamp">
                  <strong>{e.label}!</strong>
                  <span>{e.sub}</span>
                </div>
                <span className="fx-skip">tap to continue</span>
              </div>
            ))}
          {e.kind === "hit" &&
            (() => {
              const spots = e.spots.map((r) => locate?.(e.seat, r)).filter((s): s is Spot => !!s);
              const first = spots[0] ?? { x: 0.5, y: 0.5 };
              // The label sits toward the middle of the board from the impact so it never covers the edge.
              const labelY = first.y < 0.5 ? first.y + 0.2 : first.y - 0.2;
              return (
                <>
                  {!e.mine && <div className="fx-vignette hurt" />}
                  {spots.map((s, i) => (
                    <div key={i} className="fx-impact" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, animationDelay: `${i * 120}ms` }}>
                      <i />
                      <i />
                      <i />
                      <b />
                    </div>
                  ))}
                  {bar && <div className={`fx-bar-glow ${e.mine ? "gold" : "red"}`} style={{ left: `${bar.x * 100}%` }} />}
                  <div className={`fx-hit-label ${e.mine ? "gold" : "red"}`} style={{ left: `${clamp(first.x, 0.2, 0.8) * 100}%`, top: `${labelY * 100}%` }}>
                    <strong>{e.spots.length > 1 ? `DOUBLE HIT!` : "HIT!"}</strong>
                    <span>{e.mine ? "Sent to the bar" : "Your checker is on the bar"}</span>
                  </div>
                </>
              );
            })()}
          {e.kind === "cube-offer" && (
            <>
              <div className="fx-vignette" />
              <div className="fx-cube">{e.value}</div>
              <span className="fx-chip red">{e.toYou ? `Double to ${e.value} — your call` : `Doubled to ${e.value}`}</span>
            </>
          )}
          {e.kind === "cube-take" && (
            <>
              <div className="fx-cube slam">{e.value}</div>
              <span className="fx-chip mint">Taken · game worth {e.value}</span>
            </>
          )}
          {e.kind === "cube-drop" && <span className="fx-chip">Double declined</span>}
          {e.kind === "banner" && <div className={`fx-banner ${e.tone}`}>{e.text}</div>}
          {e.kind === "your-turn" && (
            <div className="fx-turn">
              <div className="fx-turn-ring" />
              <div className="fx-turn-sweep" />
              <div className="fx-turn-card">
                <span className="fx-turn-dice">
                  <Die3D value={e.dice?.[0] ?? 0} mini />
                  <Die3D value={e.dice?.[1] ?? 0} delay={90} mini />
                </span>
                {e.caption && <span className="fx-turn-caption">{e.caption}</span>}
                <strong>Your turn</strong>
                <span>{e.sub}</span>
              </div>
            </div>
          )}
          {e.kind === "game-win" && (
            <div className="fx-stamp solo">
              <strong>{e.label}</strong>
            </div>
          )}
          {e.kind === "match-win" && (
            <div className="fx-trophy">
              <div className="fx-dim" />
              <div className="fx-rays" />
              <svg viewBox="0 0 64 64" width="96" height="96" className="cup">
                <path d="M18 8h28v10a14 14 0 0 1-28 0z" fill="#F4CF87" />
                <path d="M18 12H9a8 8 0 0 0 9 10M46 12h9a8 8 0 0 1-9 10" fill="none" stroke="#F4CF87" strokeWidth="4" />
                <path d="M28 32h8v10h-8z" fill="#D9A654" />
                <path d="M20 44h24v8H20z" fill="#F4CF87" />
              </svg>
              <div className="fx-stamp">
                <strong>{e.mine === true ? "You win the match!" : e.mine === false ? "Match over" : `${e.name} wins!`}</strong>
                {e.mine === false && <span>{e.name} takes it. Good game.</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
