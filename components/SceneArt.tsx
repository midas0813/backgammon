import { useId } from "react";

/**
 * Built-in vector scenes used until the AI images are added. Same palette as the brief so the
 * layout already reads as designed. Pure SVG + CSS animation; no client JS.
 */
type Variant = "hero" | "quick" | "computer" | "ranked" | "tournament" | "history" | "fair" | "wallet" | "cta" | "auth";

const GLOW: Record<Variant, [string, string]> = {
  hero: ["#65E2BC", "#F4CF87"],
  quick: ["#65E2BC", "#9DB7FF"],
  computer: ["#65E2BC", "#8EE3F5"],
  ranked: ["#F4CF87", "#D9A654"],
  tournament: ["#F4CF87", "#65E2BC"],
  history: ["#E8C98F", "#B88A4A"],
  fair: ["#65E2BC", "#F4CF87"],
  wallet: ["#F4CF87", "#65E2BC"],
  cta: ["#65E2BC", "#F4CF87"],
  auth: ["#F4CF87", "#65E2BC"],
};

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.25],
    [0.73, 0.25],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.75],
    [0.73, 0.75],
  ],
};

function Die({ x, y, s, v, rot = 0, cls = "floaty", delay = 0 }: { x: number; y: number; s: number; v: number; rot?: number; cls?: string; delay?: number }) {
  return (
    <g className={cls} style={{ animationDelay: `${delay}s` }}>
      <g transform={`translate(${x} ${y}) rotate(${rot} ${s / 2} ${s / 2})`}>
        <rect width={s} height={s} rx={s * 0.18} fill="#F7F1E6" stroke="#CDBF9F" strokeWidth={2} />
        <rect width={s} height={s * 0.45} rx={s * 0.18} fill="#fff" opacity={0.35} />
        {PIPS[v].map(([px, py], i) => (
          <circle key={i} cx={px * s} cy={py * s} r={s * 0.075} fill="#0B1220" />
        ))}
      </g>
    </g>
  );
}

function Checker({ x, y, r, dark, delay = 0 }: { x: number; y: number; r: number; dark?: boolean; delay?: number }) {
  return (
    <g className="floaty" style={{ animationDelay: `${delay}s` }}>
      <circle cx={x} cy={y + 4} r={r} fill="#000" opacity={0.35} />
      <circle cx={x} cy={y} r={r} fill={dark ? "#101A2E" : "#F7F1E6"} stroke={dark ? "#61758B" : "#CDBF9F"} strokeWidth={3} />
      <circle cx={x} cy={y} r={r * 0.62} fill="none" stroke={dark ? "#61758B" : "#CDBF9F"} strokeOpacity={0.6} strokeWidth={2} />
    </g>
  );
}

function Points({ y, flip, color, opacity = 0.12 }: { y: number; flip?: boolean; color: string; opacity?: number }) {
  return (
    <g opacity={opacity}>
      {Array.from({ length: 16 }, (_, i) => {
        const x = i * 52 - 16;
        const tip = flip ? y - 170 : y + 170;
        return <polygon key={i} points={`${x},${y} ${x + 46},${y} ${x + 23},${tip}`} fill={i % 2 ? color : "#F7F1E6"} />;
      })}
    </g>
  );
}

function Glyph({ v, g1, g2 }: { v: Variant; g1: string; g2: string }) {
  switch (v) {
    case "quick":
      return (
        <>
          <path className="floaty" d="M430 120 L330 320 L400 320 L360 480 L480 260 L410 260 L450 120 Z" fill={g1} opacity={0.95} />
          <Die x={190} y={250} s={120} v={5} rot={-18} delay={0.3} />
          <Die x={500} y={300} s={110} v={3} rot={14} delay={0.9} />
        </>
      );
    case "computer":
      return (
        <g className="floaty">
          <rect x={290} y={190} width={220} height={220} rx={26} fill="#101A2E" stroke={g1} strokeWidth={4} />
          {Array.from({ length: 5 }, (_, i) => (
            <g key={i} stroke={g1} strokeWidth={4} opacity={0.8}>
              <line x1={320 + i * 40} y1={150} x2={320 + i * 40} y2={190} />
              <line x1={320 + i * 40} y1={410} x2={320 + i * 40} y2={450} />
              <line x1={250} y1={220 + i * 40} x2={290} y2={220 + i * 40} />
              <line x1={510} y1={220 + i * 40} x2={550} y2={220 + i * 40} />
            </g>
          ))}
          <path d="M120 300 H250 M550 300 H690 M400 450 V560 M400 40 V150" stroke={g2} strokeWidth={3} opacity={0.5} strokeDasharray="10 8" />
          <Die x={345} y={245} s={110} v={6} cls="" />
        </g>
      );
    case "ranked":
      return (
        <g className="floaty">
          <path d="M310 170 H490 V250 Q490 360 400 370 Q310 360 310 250 Z" fill={g1} />
          <path d="M310 190 Q240 190 250 250 Q260 300 320 300 M490 190 Q560 190 550 250 Q540 300 480 300" fill="none" stroke={g1} strokeWidth={14} />
          <rect x={385} y={370} width={30} height={60} fill={g2} />
          <rect x={330} y={430} width={140} height={34} rx={8} fill={g2} />
          <path d="M400 205 l14 28 31 4 -23 21 6 31 -28 -15 -28 15 6 -31 -23 -21 31 -4z" fill="#fff" opacity={0.85} />
          {[
            [200, 160],
            [600, 180],
            [640, 400],
            [170, 420],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={6} fill={g1} opacity={0.7} />
          ))}
        </g>
      );
    case "tournament":
      return (
        <g className="floaty" stroke={g2} strokeWidth={5} fill="none" strokeLinecap="round">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <line key={`a${i}`} x1={140} y1={110 + i * 55} x2={250} y2={110 + i * 55} />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <path key={`b${i}`} d={`M250 ${110 + i * 110} V${165 + i * 110} M250 ${137 + i * 110} H360`} />
          ))}
          {[0, 1].map((i) => (
            <path key={`c${i}`} d={`M360 ${137 + i * 220} V${247 + i * 220} M360 ${192 + i * 220} H470`} />
          ))}
          <path d="M470 192 V412 M470 302 H580" />
          <circle cx={620} cy={302} r={40} fill={g1} stroke="none" />
          <path d="M604 290 h32 v10 q0 22 -16 24 q-16 -2 -16 -24 z M614 324 h12 v10 h-12z" fill="#0B1220" stroke="none" />
        </g>
      );
    case "history":
      return (
        <g className="floaty">
          <rect x={150} y={200} width={500} height={200} rx={18} fill="#3B2A1C" stroke={g1} strokeWidth={4} />
          {Array.from({ length: 24 }, (_, i) => {
            const col = i % 8;
            const row = Math.floor(i / 8);
            if (row !== 1 && (col === 4 || col === 5)) return null;
            const x = 165 + col * 60;
            const y = 212 + row * 60;
            const rosette = (row !== 1 && (col === 0 || col === 6)) || (row === 1 && col === 3);
            return (
              <g key={i}>
                <rect x={x} y={y} width={52} height={52} rx={6} fill="#5B3E31" stroke={g2} strokeOpacity={0.5} />
                {rosette && (
                  <g transform={`translate(${x + 26} ${y + 26})`} fill={g1}>
                    {[0, 45, 90, 135].map((a) => (
                      <ellipse key={a} rx={18} ry={6} transform={`rotate(${a})`} opacity={0.9} />
                    ))}
                    <circle r={6} fill="#3B2A1C" />
                  </g>
                )}
              </g>
            );
          })}
          <polygon points="400,40 520,170 280,170" fill={g2} opacity={0.35} />
        </g>
      );
    case "fair":
      return (
        <g className="floaty">
          <path d="M400 110 L560 170 V300 Q560 420 400 490 Q240 420 240 300 V170 Z" fill="rgb(101 226 188 / 0.12)" stroke={g1} strokeWidth={5} />
          <Die x={340} y={240} s={120} v={4} rot={8} cls="" />
          <path d="M300 160 Q400 120 500 160" stroke="#fff" strokeOpacity={0.4} strokeWidth={4} fill="none" />
        </g>
      );
    case "wallet":
      return (
        <>
          <g className="floaty">
            <rect x={380} y={170} width={260} height={170} rx={22} fill="#172439" stroke={g2} strokeWidth={3} />
            <rect x={380} y={210} width={260} height={30} fill={g2} opacity={0.25} />
            <circle cx={600} cy={300} r={14} fill={g1} />
          </g>
          {[0, 1, 2].map((stack) => (
            <g key={stack} className="floaty" style={{ animationDelay: `${stack * 0.4}s` }}>
              {Array.from({ length: 5 - stack }, (_, i) => (
                <g key={i}>
                  <ellipse cx={200 + stack * 90} cy={430 - i * 22} rx={44} ry={14} fill={g1} stroke="#B58435" strokeWidth={2} />
                  <ellipse cx={200 + stack * 90} cy={426 - i * 22} rx={30} ry={8} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={2} />
                </g>
              ))}
            </g>
          ))}
        </>
      );
    default:
      // hero / cta / auth: a board fragment with checkers and dice
      return (
        <>
          <g transform="translate(400 300) rotate(-8) translate(-330 -190)">
            <rect width={660} height={380} rx={26} fill="#9D7951" />
            <rect x={14} y={14} width={632} height={352} rx={16} fill="#7A5A3B" />
            {Array.from({ length: 12 }, (_, i) => {
              const x = 24 + i * 52 + (i >= 6 ? 20 : 0);
              return (
                <g key={i}>
                  <polygon points={`${x},24 ${x + 46},24 ${x + 23},170`} fill={i % 2 ? "#EAD7B5" : "#5B3E31"} />
                  <polygon points={`${x},356 ${x + 46},356 ${x + 23},210`} fill={i % 2 ? "#5B3E31" : "#EAD7B5"} />
                </g>
              );
            })}
            <rect x={326} y={14} width={20} height={352} fill="#5B3E31" />
            {[0, 1, 2, 3, 4].map((i) => (
              <Checker key={`w${i}`} x={47} y={48 + i * 44} r={21} delay={i * 0.15} />
            ))}
            {[0, 1, 2].map((i) => (
              <Checker key={`b${i}`} x={255} y={332 - i * 44} r={21} dark delay={0.4 + i * 0.15} />
            ))}
            {[0, 1, 2, 3, 4].map((i) => (
              <Checker key={`d${i}`} x={385} y={48 + i * 44} r={21} dark delay={0.2 + i * 0.15} />
            ))}
            {[0, 1].map((i) => (
              <Checker key={`x${i}`} x={593} y={332 - i * 44} r={21} delay={0.6 + i * 0.15} />
            ))}
          </g>
          <Die x={470} y={70} s={96} v={6} rot={22} delay={0.5} />
          <Die x={590} y={130} s={84} v={5} rot={-12} delay={1.1} />
        </>
      );
  }
}

export default function SceneArt({ variant, className, label }: { variant: Variant; className?: string; label?: string }) {
  const id = useId().replace(/:/g, "");
  const [g1, g2] = GLOW[variant];
  return (
    <svg
      className={`scene ${className ?? ""}`}
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={label}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <defs>
        <radialGradient id={`${id}bg`} cx="50%" cy="45%" r="75%">
          <stop offset="0" stopColor="#1A2A44" />
          <stop offset="1" stopColor="#0B1220" />
        </radialGradient>
        <radialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={g1} stopOpacity="0.38" />
          <stop offset="1" stopColor={g1} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}glow2`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={g2} stopOpacity="0.28" />
          <stop offset="1" stopColor={g2} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="800" height="600" fill={`url(#${id}bg)`} />
      <Points y={0} color={g1} />
      <Points y={600} flip color={g2} opacity={0.08} />
      <circle className="glow-breathe" cx="400" cy="300" r="300" fill={`url(#${id}glow)`} />
      <circle cx="640" cy="120" r="220" fill={`url(#${id}glow2)`} />
      <Glyph v={variant} g1={g1} g2={g2} />
    </svg>
  );
}
