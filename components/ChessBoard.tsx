"use client";

import { type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { replay } from "@/lib/chess/rules";
import { sounds } from "@/lib/client/sound";

/**
 * The chess board. Pieces are tracked by identity through the move list, so each one glides to its
 * new square (castling moves both pieces; captured pieces burst away). Your own move shows at once
 * while the server confirms it. Legal moves come from the same rules library the server uses, and the
 * server checks every move again.
 */
const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const NAMES: Record<string, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const PROMOTE = ["q", "r", "b", "n"] as const;
const FILES = "abcdefgh";
const BACK = "rnbqkbnr";

type Piece = { id: string; type: string; color: "w" | "b"; sq: string };

/** Every piece's current square, by a stable id, plus what the last move captured. */
function track(moves: string[]) {
  const at = new Map<string, Piece>();
  for (let f = 0; f < 8; f++) {
    const file = FILES[f];
    at.set(`${file}1`, { id: `w${BACK[f]}${file}`, type: BACK[f], color: "w", sq: `${file}1` });
    at.set(`${file}2`, { id: `wp${file}`, type: "p", color: "w", sq: `${file}2` });
    at.set(`${file}7`, { id: `bp${file}`, type: "p", color: "b", sq: `${file}7` });
    at.set(`${file}8`, { id: `b${BACK[f]}${file}`, type: BACK[f], color: "b", sq: `${file}8` });
  }
  let captured: Piece | null = null;
  const go = (from: string, to: string) => {
    const p = at.get(from);
    if (!p) return;
    at.delete(from);
    at.set(to, { ...p, sq: to });
  };
  moves.forEach((uci, i) => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const p = at.get(from);
    if (!p) return;
    const last = i === moves.length - 1;
    let victim = at.get(to) ?? null;
    // En passant: a pawn moving diagonally to an empty square takes the pawn beside it.
    if (!victim && p.type === "p" && from[0] !== to[0]) {
      const sq = `${to[0]}${from[1]}`;
      victim = at.get(sq) ?? null;
      at.delete(sq);
    }
    if (last) captured = victim;
    go(from, to);
    if (uci[4]) at.set(to, { ...at.get(to)!, type: uci[4] });
    // Castling: the rook jumps over the king.
    if (p.type === "k" && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
      const rank = from[1];
      if (to[0] === "g") go(`h${rank}`, `f${rank}`);
      else go(`a${rank}`, `d${rank}`);
    }
  });
  return { pieces: [...at.values()], captured: captured as Piece | null };
}

export default function ChessBoard({
  moves,
  orientation,
  interactive,
  busy,
  sound = true,
  onMove,
}: {
  moves: string[];
  /** Which side is at the bottom. */
  orientation: "w" | "b";
  /** The viewer may move now (their turn, game in progress). */
  interactive: boolean;
  /** A move is being sent. */
  busy: boolean;
  sound?: boolean;
  onMove: (uci: string) => void;
}) {
  // Your move appears at once; it is dropped if the server doesn't take it.
  const [sent, setPending] = useState<{ base: number; uci: string } | null>(null);
  // Only while the position hasn't moved on: once the server's move list grows, the real one shows.
  const pending = sent && sent.base === moves.length ? sent : null;
  const shown = useMemo(() => (pending ? [...moves, pending.uci] : moves), [moves, pending]);
  const game = useMemo(() => replay(shown), [shown]);
  const { pieces, captured } = useMemo(() => track(shown), [shown]);
  const [picked, setPicked] = useState<{ ply: number; sq: Square } | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const canMove = interactive && !pending;
  const selected = picked && picked.ply === shown.length && canMove ? picked.sq : null;

  useEffect(() => {
    if (!pending || busy) return;
    // The request finished but the position did not move on: it was refused.
    const t = window.setTimeout(() => setPending(null), 600);
    return () => window.clearTimeout(t);
  }, [pending, busy, moves.length]);

  // Sounds for each new move: capture, check, mate.
  const lastPly = useRef(shown.length);
  useEffect(() => {
    if (shown.length <= lastPly.current) {
      lastPly.current = shown.length;
      return;
    }
    lastPly.current = shown.length;
    if (!sound) return;
    if (game.isCheckmate() || game.inCheck()) sounds.banner();
    else if (captured) sounds.hit();
    else sounds.move();
  }, [shown.length, game, captured, sound]);

  const targets = useMemo(() => {
    const m = new Map<string, { capture: boolean; promotion: boolean }>();
    if (!selected) return m;
    for (const mv of game.moves({ square: selected, verbose: true })) m.set(mv.to, { capture: !!mv.captured, promotion: !!mv.promotion });
    return m;
  }, [game, selected]);

  const turn = game.turn();
  const mate = game.isCheckmate();
  const checkSquare = game.inCheck() ? pieces.find((p) => p.type === "k" && p.color === turn)?.sq : null;
  const last = shown[shown.length - 1];
  const from = last?.slice(0, 2);
  const to = last?.slice(2, 4);

  const play = (uci: string) => {
    setPending({ base: moves.length, uci });
    onMove(uci);
  };

  const tap = (sq: Square) => {
    if (!canMove) return;
    const target = selected ? targets.get(sq) : undefined;
    if (selected && target) {
      if (target.promotion) setPromotion({ from: selected, to: sq });
      else play(`${selected}${sq}`);
      setPicked(null);
      return;
    }
    const p = game.get(sq);
    setPicked(p && p.color === turn && sq !== selected ? { ply: shown.length, sq } : null);
  };

  // Screen position (0–7) of a square for this orientation.
  const pos = (sq: string) => {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    return orientation === "w" ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
  };
  const ranks = orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "w" ? [...FILES] : [...FILES].reverse();

  return (
    <div className={`chess-frame${mate ? " mate" : ""}`}>
      <div className="chess-board" role="grid" aria-label="Chess board">
        {ranks.map((rank, r) =>
          files.map((file, f) => {
            const sq = `${file}${rank}` as Square;
            const p = game.get(sq);
            const dark = (FILES.indexOf(file) + rank) % 2 === 0;
            const target = targets.get(sq);
            const cls = [
              "sq",
              dark ? "dark" : "light",
              sq === selected ? "sel" : "",
              sq === from || sq === to ? "last" : "",
              sq === checkSquare ? "check" : "",
              canMove && p && p.color === turn ? "mine" : "",
              target ? "target" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={sq}
                className={cls}
                onClick={() => tap(sq)}
                aria-label={`${sq}${p ? `, ${p.color === "w" ? "white" : "black"} ${NAMES[p.type]}` : ""}${target ? ", legal move" : ""}`}
              >
                {f === 0 && <span className="coord rank">{rank}</span>}
                {r === 7 && <span className="coord file">{file}</span>}
                {target && <span className={target.capture ? "hint capture" : "hint"} aria-hidden />}
              </button>
            );
          }),
        )}
        <div className="chess-pieces" aria-hidden>
          {pieces.map((p) => {
            const { x, y } = pos(p.sq);
            const toppled = mate && p.type === "k" && p.color === turn;
            return (
              <span
                key={p.id}
                className={`cp ${p.color === "w" ? "white" : "black"}${p.sq === selected ? " lifted" : ""}${toppled ? " toppled" : ""}`}
                style={{ transform: `translate(${x * 100}%, ${y * 100}%)` }}
              >
                <span className="cp-glyph">{GLYPH[p.type]}&#xFE0E;</span>
              </span>
            );
          })}
          {captured && to && (
            <span
              key={`x${shown.length}`}
              className={`cp captured ${captured.color === "w" ? "white" : "black"}`}
              style={{ transform: `translate(${pos(to).x * 100}%, ${pos(to).y * 100}%)` }}
            >
              <span className="cp-glyph">{GLYPH[captured.type]}&#xFE0E;</span>
              <span className="burst" />
            </span>
          )}
        </div>
        {promotion && (
          <div className="promo" role="dialog" aria-label="Promote to">
            <span className="muted small">Promote to</span>
            <div className="row" style={{ gap: 8, justifyContent: "center" }}>
              {PROMOTE.map((t) => (
                <button
                  key={t}
                  className={`promo-piece ${turn === "w" ? "white" : "black"}`}
                  aria-label={NAMES[t]}
                  onClick={() => {
                    play(`${promotion.from}${promotion.to}${t}`);
                    setPromotion(null);
                  }}
                >
                  <span className="cp-glyph">{GLYPH[t]}&#xFE0E;</span>
                </button>
              ))}
            </div>
            <button className="btn sm ghost" onClick={() => setPromotion(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
