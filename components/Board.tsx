"use client";

import { useId } from "react";
import { absIndex, type Board as BoardState, type Seat } from "@/lib/engine/board";
import { BOARD, type BoardTheme } from "@/lib/client/theme";

/**
 * Pure renderer. Everything is in the viewer's relative numbering: the viewer's home board is bottom
 * right, points 1..24, 25 = viewer's bar, 0 = viewer's bear-off tray. Never feeds coordinates back
 * into rules — taps are reported as relative point numbers.
 */

const F = 10; // frame
const COL = 50;
const BAR_X = F + 6 * COL; // 310
const BAR_W = 44;
const RIGHT_X = BAR_X + BAR_W; // 354
const TRAY_X = RIGHT_X + 6 * COL + 6; // 660
const TRAY_W = 52;
const W = TRAY_X + TRAY_W + F; // 722
const TOP = 26;
const PLAY_H = 520;
const BOTTOM = TOP + PLAY_H; // 546
const H = BOTTOM + 26; // 572
const MID = TOP + PLAY_H / 2;
const TRI_H = 210;
const R = 22;
const BAR_CX = BAR_X + BAR_W / 2;
const STEP_MS = 320;

export interface DieView {
  value: number;
  used: boolean;
}

/** A move to animate, in the mover's own relative numbering (25 = bar, 0 = off). */
export interface AnimMove {
  seat: Seat;
  from: number;
  to: number;
  hit?: boolean;
}

export interface BoardProps {
  board: BoardState;
  viewer: Seat;
  theme: BoardTheme;
  dice: DieView[] | null;
  diceOwner: "viewer" | "opponent";
  cube: { value: number; owner: "viewer" | "opponent" | null; disabled: boolean };
  selectable: Set<number>;
  selected: number | null;
  targets: Map<number, string>;
  lastMoved?: Set<number>;
  onTap?: (rel: number) => void;
  /** Changing this replays the dice-roll animation. */
  rollKey?: string;
  /** Moves to animate into the current position; `key` restarts the animation. */
  anim?: { key: string; moves: AnimMove[] } | null;
}

function colX(rel: number): number {
  if (rel <= 6) return RIGHT_X + (6 - rel) * COL + COL / 2;
  if (rel <= 12) return F + (12 - rel) * COL + COL / 2;
  if (rel <= 18) return F + (rel - 13) * COL + COL / 2;
  return RIGHT_X + (rel - 19) * COL + COL / 2;
}
const isTop = (rel: number) => rel >= 13;
const pointY = (rel: number, i: number) => (isTop(rel) ? TOP + R + Math.min(i, 4) * 2 * R : BOTTOM - R - Math.min(i, 4) * 2 * R);
const barY = (lower: boolean, i: number) => (lower ? MID + 48 + R + Math.min(i, 2) * 2 * R : MID - 48 - R - Math.min(i, 2) * 2 * R);
const trayY = (lower: boolean, i: number) => (lower ? BOTTOM - 6 - (i + 1) * 13 : TOP + 6 + i * 13);

function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct < 0 ? c : 255 - c) * pct)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Number of `seat` checkers at viewer-relative point `rel`. */
function countAtViewer(board: BoardState, viewer: Seat, seat: Seat, rel: number) {
  const v = board.points[absIndex(viewer, rel)];
  return seat === 0 ? Math.max(v, 0) : Math.max(-v, 0);
}

type Loc = { kind: "point"; rel: number } | { kind: "bar"; lower: boolean } | { kind: "off"; lower: boolean };
interface Motion {
  dx: number;
  dy: number;
  delay: number;
}

/** Work out, for each element that just arrived, where it came from (as a CSS translate offset). */
function computeMotions(board: BoardState, viewer: Seat, moves: AnimMove[]): Map<string, Motion> {
  const out = new Map<string, Motion>();
  const toLoc = (seat: Seat, rel: number, isFrom: boolean): Loc => {
    const mine = seat === viewer;
    if (rel === 25 && isFrom) return { kind: "bar", lower: mine };
    if (rel === 0 && !isFrom) return { kind: "off", lower: mine };
    return { kind: "point", rel: mine ? rel : 25 - rel };
  };
  // Merge chained moves of one checker (13→8, 8→5) into a single path 13→5.
  const paths: { seat: Seat; from: Loc; to: Loc; hits: Loc[] }[] = [];
  for (const m of moves) {
    const from = toLoc(m.seat, m.from, true);
    const to = toLoc(m.seat, m.to, false);
    const hits: Loc[] = [];
    if (m.hit && to.kind === "point") hits.push(to);
    const prev = paths.find(
      (p) => p.seat === m.seat && p.to.kind === "point" && from.kind === "point" && p.to.rel === from.rel && !p.hits.some((h) => h === p.to),
    );
    if (prev) {
      prev.to = to;
      prev.hits.push(...hits);
    } else paths.push({ seat: m.seat, from, to, hits });
  }

  const xy = (seat: Seat, loc: Loc, index: number): [number, number] => {
    if (loc.kind === "point") return [colX(loc.rel), pointY(loc.rel, index)];
    if (loc.kind === "bar") return [BAR_CX, barY(loc.lower, index)];
    return [TRAY_X + TRAY_W / 2, trayY(loc.lower, index) + 5];
  };
  const countAt = (seat: Seat, loc: Loc) =>
    loc.kind === "point"
      ? countAtViewer(board, viewer, seat, loc.rel)
      : loc.kind === "bar"
        ? board.bar[seat]
        : board.off[seat];
  const arrivals = new Map<string, number>();

  // Later arrivals sit on top, so assign stack indexes from the last path backwards.
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i];
    const delay = i * STEP_MS;
    const destKey = (seat: Seat, loc: Loc) => (loc.kind === "point" ? `pt:${loc.rel}` : `${loc.kind}:${seat}`);
    const place = (seat: Seat, from: Loc, fromIndex: number, to: Loc, d: number) => {
      const k = destKey(seat, to);
      const already = arrivals.get(k) ?? 0;
      arrivals.set(k, already + 1);
      const index = Math.max(0, countAt(seat, to) - 1 - already);
      const [fx, fy] = xy(seat, from, fromIndex);
      const [tx, ty] = xy(seat, to, index);
      const limit = to.kind === "point" ? 4 : to.kind === "bar" ? 2 : 99;
      out.set(`${k}:${Math.min(index, limit)}`, { dx: fx - tx, dy: fy - ty, delay: d });
    };
    place(p.seat, p.from, countAt(p.seat, p.from), p.to, delay);
    const victim: Seat = p.seat === 0 ? 1 : 0;
    for (const h of p.hits) place(victim, h, 0, { kind: "bar", lower: victim === viewer }, delay + STEP_MS * 0.6);
  }
  return out;
}

function Checker({
  cx,
  cy,
  white,
  label,
  ring,
  gid,
  className,
  motion,
}: {
  cx: number;
  cy: number;
  white: boolean;
  label?: string;
  ring?: boolean;
  gid: string;
  className?: string;
  motion?: Motion;
}) {
  const style = motion ? ({ "--dx": `${motion.dx}px`, "--dy": `${motion.dy}px`, "--delay": `${motion.delay}ms` } as React.CSSProperties) : undefined;
  return (
    <g className={`checker ${motion ? "arrive" : ""} ${className ?? ""}`} style={style} filter={`url(#${gid}shadow)`}>
      <circle cx={cx} cy={cy} r={R - 1} fill={`url(#${gid}${white ? "cw" : "cb"})`} stroke={white ? BOARD.whiteCheckerOutline : BOARD.blackCheckerOutline} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={R - 8} fill="none" stroke={white ? BOARD.whiteCheckerOutline : BOARD.blackCheckerOutline} strokeOpacity={0.55} />
      <circle cx={cx} cy={cy} r={R - 12} fill="none" stroke={white ? "#fff" : "#8DA2BC"} strokeOpacity={0.18} />
      {label && (
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={17} fontWeight={800} fill={white ? "#0B1220" : "#EDF3F9"}>
          {label}
        </text>
      )}
      {ring && <circle cx={cx} cy={cy} r={R + 2} fill="none" stroke={BOARD.legalDestination} strokeWidth={3} strokeDasharray="5 4" />}
    </g>
  );
}

function Die({ x, y, value, used, rollKey, delay }: { x: number; y: number; value: number; used: boolean; rollKey?: string; delay: number }) {
  const s = 40;
  const L = 0.25,
    C = 0.5,
    Rr = 0.75;
  const layouts: Record<number, [number, number][]> = {
    1: [[C, C]],
    2: [[L, L], [Rr, Rr]],
    3: [[L, L], [C, C], [Rr, Rr]],
    4: [[L, L], [Rr, L], [L, Rr], [Rr, Rr]],
    5: [[L, L], [Rr, L], [C, C], [L, Rr], [Rr, Rr]],
    6: [[L, L], [Rr, L], [L, C], [Rr, C], [L, Rr], [Rr, Rr]],
  };
  return (
    <g
      key={rollKey}
      className={`die ${rollKey ? "roll" : ""}`}
      style={{ "--delay": `${delay}ms` } as React.CSSProperties}
      opacity={used ? 0.35 : 1}
      aria-label={`Die ${value}${used ? " used" : ""}`}
    >
      <rect x={x + 1} y={y + 3} width={s} height={s} rx={8} fill="#000" opacity={0.35} />
      <rect x={x} y={y} width={s} height={s} rx={8} fill="#F7F1E6" stroke="#CDBF9F" strokeWidth={2} />
      <rect x={x + 3} y={y + 3} width={s - 6} height={s * 0.38} rx={6} fill="#fff" opacity={0.45} />
      {layouts[value].map(([px, py]) => (
        <circle key={`${px}${py}`} cx={x + px * s} cy={y + py * s} r={4} fill="#0B1220" />
      ))}
      {used && <line x1={x + 4} y1={y + s - 4} x2={x + s - 4} y2={y + 4} stroke="#FF8F9C" strokeWidth={3} />}
    </g>
  );
}

export default function Board(p: BoardProps) {
  const { board, viewer, theme } = p;
  const gid = useId().replace(/:/g, "");
  const opp: Seat = viewer === 0 ? 1 : 0;
  const viewerIsWhite = viewer === 0;
  const tap = (rel: number) => () => p.onTap?.(rel);
  const motions = p.anim ? computeMotions(board, viewer, p.anim.moves) : new Map<string, Motion>();
  const animKey = p.anim?.key ?? "";

  const points = [];
  for (let rel = 1; rel <= 24; rel++) {
    const cx = colX(rel);
    const top = isTop(rel);
    const baseY = top ? TOP : BOTTOM;
    const tipY = top ? TOP + TRI_H : BOTTOM - TRI_H;
    const light = rel % 2 === 0;
    const target = p.targets.get(rel);
    const selected = p.selected === rel;
    const highlight = p.lastMoved?.has(rel);
    const tri = `${cx - COL / 2 + 2},${baseY} ${cx + COL / 2 - 2},${baseY} ${cx},${tipY}`;
    points.push(
      <g key={`pt${rel}`}>
        <polygon points={tri} fill={`url(#${gid}${light ? "pl" : "pd"}${top ? "t" : "b"})`} />
        {highlight && <polygon points={tri} fill="#F4CF87" opacity={0.2} />}
        {target !== undefined && (
          <polygon
            className="pulse"
            points={`${cx - COL / 2 + 3},${baseY} ${cx + COL / 2 - 3},${baseY} ${cx},${tipY}`}
            fill={BOARD.legalDestination}
            fillOpacity={0.3}
            stroke={BOARD.legalDestination}
            strokeWidth={3}
          />
        )}
        {selected && (
          <rect x={cx - COL / 2 + 1} y={top ? TOP : BOTTOM - TRI_H - 14} width={COL - 2} height={TRI_H + 14} fill="none" stroke="#F7F1E6" strokeWidth={3} rx={6} />
        )}
        <text
          x={cx}
          y={top ? TOP - 8 : BOTTOM + 19}
          textAnchor="middle"
          fontSize={14}
          fill={target !== undefined ? BOARD.legalDestination : "#EDF3F9"}
          fontWeight={target !== undefined ? 800 : 500}
          opacity={0.9}
        >
          {rel}
        </text>
      </g>,
    );
  }

  const checkers = [];
  for (let rel = 1; rel <= 24; rel++) {
    const v = board.points[absIndex(viewer, rel)];
    if (v === 0) continue;
    const n = Math.abs(v);
    const white = v > 0;
    const shown = Math.min(n, 5);
    const mineHere = white === viewerIsWhite;
    for (let i = 0; i < shown; i++) {
      const last = i === shown - 1;
      const motion = motions.get(`pt:${rel}:${i}`);
      checkers.push(
        <Checker
          key={`c${rel}-${i}${motion ? animKey : ""}`}
          gid={gid}
          cx={colX(rel)}
          cy={pointY(rel, i)}
          white={white}
          label={last && n > 5 ? String(n) : undefined}
          ring={last && mineHere && p.selectable.has(rel) && p.selected !== rel}
          className={last && p.selected === rel ? "lift" : undefined}
          motion={motion}
        />,
      );
    }
  }

  // Bar: viewer's checkers in the lower half, opponent's in the upper half.
  const barCheckers = [];
  for (const [seat, lower] of [
    [viewer, true],
    [opp, false],
  ] as [Seat, boolean][]) {
    const n = board.bar[seat];
    const shown = Math.min(n, 3);
    for (let i = 0; i < shown; i++) {
      const motion = motions.get(`bar:${seat}:${i}`);
      barCheckers.push(
        <Checker
          key={`bar${seat}-${i}${motion ? animKey : ""}`}
          gid={gid}
          cx={BAR_CX}
          cy={barY(lower, i)}
          white={seat === 0}
          label={i === shown - 1 && n > 1 ? String(n) : undefined}
          ring={lower && i === 0 && p.selectable.has(25) && p.selected !== 25}
          className={lower && i === shown - 1 && p.selected === 25 ? "lift" : undefined}
          motion={motion}
        />,
      );
    }
  }

  // Bear-off trays: opponent top, viewer bottom.
  const trays = [];
  for (const [seat, lower] of [
    [viewer, true],
    [opp, false],
  ] as [Seat, boolean][]) {
    const n = board.off[seat];
    for (let i = 0; i < n; i++) {
      const motion = motions.get(`off:${seat}:${i}`);
      const style = motion ? ({ "--dx": `${motion.dx}px`, "--dy": `${motion.dy}px`, "--delay": `${motion.delay}ms` } as React.CSSProperties) : undefined;
      trays.push(
        <rect
          key={`off${seat}-${i}${motion ? animKey : ""}`}
          className={`checker ${motion ? "arrive" : ""}`}
          style={style}
          x={TRAY_X + 6}
          y={trayY(lower, i)}
          width={TRAY_W - 12}
          height={11}
          rx={3}
          fill={seat === 0 ? BOARD.whiteChecker : BOARD.blackChecker}
          stroke={seat === 0 ? BOARD.whiteCheckerOutline : BOARD.blackCheckerOutline}
        />,
      );
    }
    if (n > 0) {
      trays.push(
        <text key={`offn${seat}`} x={TRAY_X + TRAY_W / 2} y={lower ? BOTTOM - 14 - n * 13 : TOP + 22 + n * 13} textAnchor="middle" fontSize={14} fontWeight={800} fill="#EDF3F9">
          {n}
        </text>,
      );
    }
  }
  const offTarget = p.targets.get(0);

  // Cube: centre when unowned, on the owner's side otherwise. Value is always shown as text.
  const cubeY = p.cube.owner === null ? MID - 20 : p.cube.owner === "viewer" ? BOTTOM - 46 : TOP + 6;
  const cubeX = BAR_CX - 20;
  const diceX = p.diceOwner === "viewer" ? RIGHT_X + COL * 3 - 46 : F + COL * 3 - 46;

  return (
    <svg className="board-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Backgammon board">
      <defs>
        <linearGradient id={`${gid}frame`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(theme.surface, 0.18)} />
          <stop offset="0.5" stopColor={theme.surface} />
          <stop offset="1" stopColor={shade(theme.surface, -0.28)} />
        </linearGradient>
        <radialGradient id={`${gid}felt`} cx="50%" cy="50%" r="70%">
          <stop offset="0" stopColor={shade(theme.surface, 0.06)} />
          <stop offset="1" stopColor={shade(theme.surface, -0.18)} />
        </radialGradient>
        <pattern id={`${gid}grain`} width="120" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 4 Q30 1 60 4 T120 4" fill="none" stroke="#000" strokeOpacity="0.05" strokeWidth="1.2" />
        </pattern>
        {(["t", "b"] as const).map((dir) =>
          (["l", "d"] as const).map((tone) => {
            const base = tone === "l" ? theme.lightPoint : theme.darkPoint;
            return (
              <linearGradient key={`${tone}${dir}`} id={`${gid}p${tone}${dir}`} x1="0" y1={dir === "t" ? "0" : "1"} x2="0" y2={dir === "t" ? "1" : "0"}>
                <stop offset="0" stopColor={shade(base, 0.08)} />
                <stop offset="1" stopColor={shade(base, -0.12)} />
              </linearGradient>
            );
          }),
        )}
        <radialGradient id={`${gid}cw`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor={BOARD.whiteChecker} />
          <stop offset="1" stopColor="#D9CCB2" />
        </radialGradient>
        <radialGradient id={`${gid}cb`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#3A4C68" />
          <stop offset="0.55" stopColor={BOARD.blackChecker} />
          <stop offset="1" stopColor="#060B16" />
        </radialGradient>
        <linearGradient id={`${gid}bar`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={shade(theme.bar, -0.2)} />
          <stop offset="0.5" stopColor={shade(theme.bar, 0.1)} />
          <stop offset="1" stopColor={shade(theme.bar, -0.2)} />
        </linearGradient>
        <filter id={`${gid}shadow`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="1.6" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      <rect x={0} y={0} width={W} height={H} rx={18} fill={`url(#${gid}frame)`} />
      <rect x={F - 4} y={TOP - 6} width={W - 2 * F + 8} height={PLAY_H + 12} rx={12} fill={`url(#${gid}felt)`} />
      <rect x={F - 4} y={TOP - 6} width={W - 2 * F + 8} height={PLAY_H + 12} rx={12} fill={`url(#${gid}grain)`} />
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={18} fill="none" stroke="#fff" strokeOpacity={0.12} />
      {points}
      <rect x={BAR_X} y={TOP - 4} width={BAR_W} height={PLAY_H + 8} fill={`url(#${gid}bar)`} rx={5} />
      <rect x={TRAY_X} y={TOP} width={TRAY_W} height={PLAY_H / 2 - 8} fill={`url(#${gid}bar)`} rx={8} />
      <rect
        x={TRAY_X}
        y={MID + 8}
        width={TRAY_W}
        height={PLAY_H / 2 - 8}
        fill={`url(#${gid}bar)`}
        rx={8}
        className={offTarget !== undefined ? "pulse" : undefined}
        stroke={offTarget !== undefined ? BOARD.legalDestination : "none"}
        strokeWidth={4}
      />
      {offTarget !== undefined && (
        <text x={TRAY_X + TRAY_W / 2} y={MID + 34} textAnchor="middle" fontSize={13} fontWeight={800} fill={BOARD.legalDestination}>
          OFF
        </text>
      )}
      {trays}
      {checkers}
      {barCheckers}

      <g key={`cube${p.cube.value}`} className={`cube ${p.cube.value > 1 ? "pop" : ""}`} aria-label={`Cube ${p.cube.value}`} opacity={p.cube.disabled ? 0.45 : 1}>
        <rect x={cubeX + 1} y={cubeY + 3} width={40} height={40} rx={7} fill="#000" opacity={0.35} />
        <rect x={cubeX} y={cubeY} width={40} height={40} rx={7} fill="#F7F1E6" stroke="#0B1220" strokeWidth={2} />
        <text x={cubeX + 20} y={cubeY + 27} textAnchor="middle" fontSize={p.cube.value >= 100 ? 15 : 19} fontWeight={800} fill="#0B1220">
          {p.cube.value}
        </text>
      </g>

      {p.dice && (
        <g>
          {p.dice.map((d, i) => (
            <Die
              key={`${p.rollKey ?? "d"}-${i}`}
              rollKey={p.rollKey ? `${p.rollKey}-${i}` : undefined}
              delay={i * 90}
              x={diceX + (i % 2) * 48}
              y={MID - 20 + (p.dice!.length > 2 ? (i < 2 ? -22 : 22) : 0)}
              value={d.value}
              used={d.used}
            />
          ))}
        </g>
      )}

      {/* Destination labels (shape + text, not colour alone) */}
      {[...p.targets.entries()]
        .filter(([rel]) => rel !== 0)
        .map(([rel, label]) => {
          const cx = colX(rel);
          const y = isTop(rel) ? TOP + TRI_H + 22 : BOTTOM - TRI_H - 22;
          return (
            <g key={`lbl${rel}`} className="tag">
              <rect x={cx - 17} y={y - 14} width={34} height={22} rx={11} fill={BOARD.legalDestination} />
              <text x={cx} y={y + 2} textAnchor="middle" fontSize={13} fontWeight={800} fill="#0B1220">
                {label}
              </text>
            </g>
          );
        })}

      {/* Tap targets: each point spans its full half-height so precise checker taps are not required. */}
      {p.onTap &&
        Array.from({ length: 24 }, (_, i) => i + 1).map((rel) => (
          <rect
            key={`hit${rel}`}
            x={colX(rel) - COL / 2}
            y={isTop(rel) ? TOP : MID}
            width={COL}
            height={PLAY_H / 2}
            fill="transparent"
            onClick={tap(rel)}
            style={{ cursor: "pointer" }}
          />
        ))}
      {p.onTap && <rect x={BAR_X} y={MID} width={BAR_W} height={PLAY_H / 2} fill="transparent" onClick={tap(25)} style={{ cursor: "pointer" }} />}
      {p.onTap && <rect x={TRAY_X} y={MID} width={TRAY_W} height={PLAY_H / 2} fill="transparent" onClick={tap(0)} style={{ cursor: "pointer" }} />}
    </svg>
  );
}
