"use client";

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

export interface DieView {
  value: number;
  used: boolean;
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
  highContrast?: boolean;
}

function colX(rel: number): number {
  if (rel <= 6) return RIGHT_X + (6 - rel) * COL + COL / 2;
  if (rel <= 12) return F + (12 - rel) * COL + COL / 2;
  if (rel <= 18) return F + (rel - 13) * COL + COL / 2;
  return RIGHT_X + (rel - 19) * COL + COL / 2;
}
const isTop = (rel: number) => rel >= 13;

/** Viewer-relative point → absolute index on the canonical board. */
const viewerAbs = (viewer: Seat, rel: number) => absIndex(viewer, rel);

function Checker({ cx, cy, white, label, ring }: { cx: number; cy: number; white: boolean; label?: string; ring?: boolean }) {
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={R - 1}
        fill={white ? BOARD.whiteChecker : BOARD.blackChecker}
        stroke={white ? BOARD.whiteCheckerOutline : BOARD.blackCheckerOutline}
        strokeWidth={2}
      />
      <circle cx={cx} cy={cy} r={R - 8} fill="none" stroke={white ? BOARD.whiteCheckerOutline : BOARD.blackCheckerOutline} strokeOpacity={0.5} />
      {label && (
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={17} fontWeight={700} fill={white ? "#0B1220" : "#EDF3F9"}>
          {label}
        </text>
      )}
      {ring && <circle cx={cx} cy={cy} r={R + 2} fill="none" stroke={BOARD.legalDestination} strokeWidth={3} strokeDasharray="5 4" />}
    </g>
  );
}

function Die({ x, y, value, used }: { x: number; y: number; value: number; used: boolean }) {
  const s = 40;
  const pip = (px: number, py: number) => <circle key={`${px}${py}`} cx={x + px * s} cy={y + py * s} r={4} fill="#0B1220" />;
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
    <g opacity={used ? 0.35 : 1} aria-label={`Die ${value}${used ? " used" : ""}`}>
      <rect x={x} y={y} width={s} height={s} rx={8} fill="#F7F1E6" stroke="#CDBF9F" strokeWidth={2} />
      {layouts[value].map(([px, py]) => pip(px, py))}
      {used && <line x1={x + 4} y1={y + s - 4} x2={x + s - 4} y2={y + 4} stroke="#FF8F9C" strokeWidth={3} />}
    </g>
  );
}

export default function Board(p: BoardProps) {
  const { board, viewer, theme } = p;
  const opp: Seat = viewer === 0 ? 1 : 0;
  const viewerIsWhite = viewer === 0;
  const tap = (rel: number) => () => p.onTap?.(rel);

  const points = [];
  for (let rel = 1; rel <= 24; rel++) {
    const cx = colX(rel);
    const top = isTop(rel);
    const baseY = top ? TOP : BOTTOM;
    const tipY = top ? TOP + TRI_H : BOTTOM - TRI_H;
    const fill = rel % 2 === 0 ? theme.lightPoint : theme.darkPoint;
    const target = p.targets.get(rel);
    const selected = p.selected === rel;
    const highlight = p.lastMoved?.has(rel);
    points.push(
      <g key={`pt${rel}`}>
        <polygon points={`${cx - COL / 2 + 2},${baseY} ${cx + COL / 2 - 2},${baseY} ${cx},${tipY}`} fill={fill} />
        {highlight && (
          <polygon
            points={`${cx - COL / 2 + 2},${baseY} ${cx + COL / 2 - 2},${baseY} ${cx},${tipY}`}
            fill="#F4CF87"
            opacity={0.18}
          />
        )}
        {target !== undefined && (
          <polygon
            points={`${cx - COL / 2 + 3},${baseY} ${cx + COL / 2 - 3},${baseY} ${cx},${tipY}`}
            fill={BOARD.legalDestination}
            fillOpacity={0.28}
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
          fontWeight={target !== undefined ? 700 : 400}
          opacity={0.85}
        >
          {rel}
        </text>
      </g>,
    );
  }

  const checkers = [];
  for (let rel = 1; rel <= 24; rel++) {
    const v = board.points[viewerAbs(viewer, rel)];
    if (v === 0) continue;
    const n = Math.abs(v);
    const white = v > 0;
    const cx = colX(rel);
    const top = isTop(rel);
    const shown = Math.min(n, 5);
    const mineHere = white === viewerIsWhite;
    for (let i = 0; i < shown; i++) {
      const cy = top ? TOP + R + i * 2 * R : BOTTOM - R - i * 2 * R;
      const last = i === shown - 1;
      checkers.push(
        <Checker
          key={`c${rel}-${i}`}
          cx={cx}
          cy={cy}
          white={white}
          label={last && n > 5 ? String(n) : undefined}
          ring={last && mineHere && p.selectable.has(rel) && p.selected !== rel}
        />,
      );
    }
  }

  // Bar: viewer's checkers in the lower half, opponent's in the upper half.
  const barCx = BAR_X + BAR_W / 2;
  const barCheckers = [];
  for (const [seat, lower] of [
    [viewer, true],
    [opp, false],
  ] as [Seat, boolean][]) {
    const n = board.bar[seat];
    for (let i = 0; i < Math.min(n, 3); i++) {
      const cy = lower ? MID + 48 + R + i * 2 * R : MID - 48 - R - i * 2 * R;
      barCheckers.push(
        <Checker
          key={`bar${seat}-${i}`}
          cx={barCx}
          cy={cy}
          white={seat === 0}
          label={i === Math.min(n, 3) - 1 && n > 1 ? String(n) : undefined}
          ring={lower && i === 0 && p.selectable.has(25) && p.selected !== 25}
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
      const y = lower ? BOTTOM - 6 - (i + 1) * 13 : TOP + 6 + i * 13;
      trays.push(
        <rect
          key={`off${seat}-${i}`}
          x={TRAY_X + 6}
          y={y}
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
        <text key={`offn${seat}`} x={TRAY_X + TRAY_W / 2} y={lower ? BOTTOM - 14 - n * 13 : TOP + 22 + n * 13} textAnchor="middle" fontSize={14} fontWeight={700} fill="#EDF3F9">
          {n}
        </text>,
      );
    }
  }
  const offTarget = p.targets.get(0);

  // Cube: centre when unowned, on the owner's side otherwise. Value is always shown as text.
  const cubeY = p.cube.owner === null ? MID - 20 : p.cube.owner === "viewer" ? BOTTOM - 46 : TOP + 6;
  const cubeX = barCx - 20;

  const diceX = p.diceOwner === "viewer" ? RIGHT_X + COL * 3 - 46 : F + COL * 3 - 46;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Backgammon board">
      <rect x={0} y={0} width={W} height={H} rx={18} fill={theme.surface} />
      {points}
      <rect x={BAR_X} y={TOP - 4} width={BAR_W} height={PLAY_H + 8} fill={theme.bar} rx={4} />
      <rect x={TRAY_X} y={TOP} width={TRAY_W} height={PLAY_H / 2 - 8} fill={theme.bar} rx={8} />
      <rect
        x={TRAY_X}
        y={MID + 8}
        width={TRAY_W}
        height={PLAY_H / 2 - 8}
        fill={theme.bar}
        rx={8}
        stroke={offTarget !== undefined ? BOARD.legalDestination : "none"}
        strokeWidth={4}
      />
      {offTarget !== undefined && (
        <text x={TRAY_X + TRAY_W / 2} y={MID + 34} textAnchor="middle" fontSize={13} fontWeight={700} fill={BOARD.legalDestination}>
          OFF
        </text>
      )}
      {trays}
      {checkers}
      {barCheckers}

      <g aria-label={`Cube ${p.cube.value}`} opacity={p.cube.disabled ? 0.45 : 1}>
        <rect x={cubeX} y={cubeY} width={40} height={40} rx={7} fill="#F7F1E6" stroke="#0B1220" strokeWidth={2} />
        <text x={cubeX + 20} y={cubeY + 27} textAnchor="middle" fontSize={p.cube.value >= 100 ? 15 : 19} fontWeight={800} fill="#0B1220">
          {p.cube.value}
        </text>
      </g>

      {p.dice && (
        <g>
          {p.dice.map((d, i) => (
            <Die key={i} x={diceX + (i % 2) * 48} y={MID - 20 + (p.dice!.length > 2 ? (i < 2 ? -24 : 24) : 0)} value={d.value} used={d.used} />
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
            <g key={`lbl${rel}`}>
              <rect x={cx - 17} y={y - 14} width={34} height={22} rx={11} fill={BOARD.legalDestination} />
              <text x={cx} y={y + 2} textAnchor="middle" fontSize={13} fontWeight={800} fill="#0B1220">
                {label}
              </text>
            </g>
          );
        })}

      {/* Tap targets: each point spans its full half-height so precise checker taps are not required. */}
      {p.onTap &&
        Array.from({ length: 24 }, (_, i) => i + 1).map((rel) => {
          const cx = colX(rel);
          return (
            <rect
              key={`hit${rel}`}
              x={cx - COL / 2}
              y={isTop(rel) ? TOP : MID}
              width={COL}
              height={PLAY_H / 2}
              fill="transparent"
              onClick={tap(rel)}
              style={{ cursor: "pointer" }}
            />
          );
        })}
      {p.onTap && <rect x={BAR_X} y={MID} width={BAR_W} height={PLAY_H / 2} fill="transparent" onClick={tap(25)} style={{ cursor: "pointer" }} />}
      {p.onTap && <rect x={TRAY_X} y={MID} width={TRAY_W} height={PLAY_H / 2} fill="transparent" onClick={tap(0)} style={{ cursor: "pointer" }} />}
    </svg>
  );
}
