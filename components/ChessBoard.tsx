"use client";

import { Chess, type Square } from "chess.js";
import { useMemo, useState } from "react";

/**
 * The chess board: tap a piece, then a highlighted square. Legal moves come from the same rules
 * library the server uses; the server checks every move again. Pieces are drawn with chess symbols
 * until a piece set is chosen.
 */
const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const PROMOTE = ["q", "r", "b", "n"] as const;
const FILES = "abcdefgh";

export default function ChessBoard({
  fen,
  orientation,
  interactive,
  lastMove,
  onMove,
}: {
  fen: string;
  /** Which side is at the bottom. */
  orientation: "w" | "b";
  /** The viewer may move now (their turn, game in progress). */
  interactive: boolean;
  lastMove: string | null;
  onMove: (uci: string) => void;
}) {
  const game = useMemo(() => new Chess(fen), [fen]);
  const [picked, setPicked] = useState<{ fen: string; sq: Square } | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  // A selection belongs to one position; a new position clears it.
  const selected = picked && picked.fen === fen && interactive ? picked.sq : null;

  const targets = useMemo(() => {
    const m = new Map<string, { capture: boolean; promotion: boolean }>();
    if (!selected) return m;
    for (const mv of game.moves({ square: selected, verbose: true })) m.set(mv.to, { capture: !!mv.captured, promotion: !!mv.promotion });
    return m;
  }, [game, selected]);

  const turn = game.turn();
  const checkSquare = useMemo(() => {
    if (!game.inCheck()) return null;
    for (const row of game.board()) for (const p of row) if (p && p.type === "k" && p.color === turn) return p.square;
    return null;
  }, [game, turn]);

  const tap = (sq: Square) => {
    if (!interactive) return;
    const target = selected ? targets.get(sq) : undefined;
    if (selected && target) {
      if (target.promotion) setPromotion({ from: selected, to: sq });
      else onMove(`${selected}${sq}`);
      setPicked(null);
      return;
    }
    const p = game.get(sq);
    setPicked(p && p.color === turn && sq !== selected ? { fen, sq } : null);
  };

  const ranks = orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "w" ? [...FILES] : [...FILES].reverse();
  const from = lastMove?.slice(0, 2);
  const to = lastMove?.slice(2, 4);

  return (
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
            interactive && p && p.color === turn ? "mine" : "",
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
              {p && <span className={`piece ${p.color === "w" ? "white" : "black"}`}>{GLYPH[p.type]}&#xFE0E;</span>}
              {target && <span className={target.capture ? "hint capture" : "hint"} aria-hidden />}
            </button>
          );
        }),
      )}
      {promotion && (
        <div className="promo" role="dialog" aria-label="Promote to">
          {PROMOTE.map((t) => (
            <button
              key={t}
              className={`piece ${turn === "w" ? "white" : "black"}`}
              aria-label={NAMES[t]}
              onClick={() => {
                onMove(`${promotion.from}${promotion.to}${t}`);
                setPromotion(null);
              }}
            >
              {GLYPH[t]}&#xFE0E;
            </button>
          ))}
          <button className="btn sm ghost" onClick={() => setPromotion(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

const NAMES: Record<string, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
