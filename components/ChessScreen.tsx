"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import ChessBoard from "@/components/ChessBoard";
import Confetti from "@/components/Confetti";
import FeedbackButton from "@/components/FeedbackButton";
import Modal from "@/components/Modal";
import { END_LABEL } from "@/lib/chess/rules";
import type { Seat } from "@/lib/engine/board";
import type { MatchSnapshot } from "@/lib/server/matches";

type Clock = { bankMs: number; running: boolean; low: boolean };
type ChessView = NonNullable<MatchSnapshot["chess"]>;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return s < 20 && s > 0 ? `0:${String(s).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Material count per colour from the position (for the "+3" next to the leading side). */
function material(fen: string) {
  const m = { w: 0, b: 0 };
  for (const ch of fen.split(" ")[0]) {
    const v = VALUE[ch.toLowerCase()];
    if (v) m[ch === ch.toUpperCase() ? "w" : "b"] += v;
  }
  return m;
}

/**
 * A chess match: players with clocks, the board, the move list and draw / resign controls. The
 * match page (MatchView) supplies the shared parts: polling, chat, toasts and leaving safely.
 */
export default function ChessScreen({
  snap,
  matchId,
  faces,
  busy,
  message,
  onSend,
  onLeave,
  chatButton,
  after,
  overlays,
}: {
  snap: MatchSnapshot;
  matchId: string;
  faces: [Clock, Clock] | null;
  busy: boolean;
  message: string | null;
  onSend: (actionType: string, payload?: Record<string, unknown>) => void;
  onLeave: (e: React.MouseEvent) => void;
  chatButton: React.ReactNode;
  after: React.ReactNode;
  overlays: React.ReactNode;
}) {
  const ch = snap.chess as ChessView;
  const [menu, setMenu] = useState(false);
  const [resign, setResign] = useState(false);
  const [flip, setFlip] = useState(false);
  const local = snap.yourSeats.length === 2;
  const spectating = snap.role === "spectator";
  const active = snap.status === "ACTIVE";
  const me = local ? ch.toMove : ((snap.yourSeats[0] ?? 0) as Seat);
  // Bottom of the board: your colour (pass & play: the side to move; spectators: White unless flipped).
  const bottomSeat: Seat = spectating ? ((flip ? 1 - ch.white : ch.white) as Seat) : me;
  const topSeat = (1 - bottomSeat) as Seat;
  const colorOf = (seat: Seat) => (seat === ch.white ? "w" : "b");
  const myTurn = active && !spectating && ch.toMove === me;
  const mat = material(ch.fen);

  const moveList = useRef<HTMLOListElement>(null);
  useEffect(() => {
    moveList.current?.scrollTo({ left: moveList.current.scrollWidth, behavior: "smooth" });
  }, [ch.moves.length]);

  const pairs = useMemo(() => {
    const out: [string, string | undefined][] = [];
    for (let i = 0; i < ch.san.length; i += 2) out.push([ch.san[i], ch.san[i + 1]]);
    return out;
  }, [ch.san]);

  const strip = (seat: Seat) => {
    const s = snap.seats[seat];
    const color = colorOf(seat);
    const lead = mat[color] - mat[color === "w" ? "b" : "w"];
    const clock = faces?.[seat];
    return (
      <div className={`strip chess-strip${active && ch.toMove === seat ? " active" : ""}`}>
        <div className="who">
          <span style={{ position: "relative", display: "inline-flex" }}>
            <Avatar name={s.name} src={s.avatarUrl} bot={s.bot} size={34} frame={s.frame} />
            <span className={`chess-color ${color === "w" ? "white" : "black"}`} aria-label={color === "w" ? "White" : "Black"}>
              ♚&#xFE0E;
            </span>
          </span>
          <span className="name">
            {s.name}
            {snap.yourSeats.includes(seat) && !local ? " (you)" : ""}
          </span>
          {s.level && (
            <span className="level-chip small">
              Lv {s.level}
              {s.rating ? ` · ${s.rating}` : ""}
            </span>
          )}
          {!s.online && <span className="badge warn">offline</span>}
          {lead > 0 && <span className="muted small mono">+{lead}</span>}
        </div>
        {clock && (
          <span className={`clock chess-clock${clock.running ? " running" : ""}${clock.low ? " low" : ""}`} aria-label={`${mmss(clock.bankMs)} left`}>
            {mmss(clock.bankMs)}
          </span>
        )}
      </div>
    );
  };

  const result = ch.result;
  const youWon = !!result && result.winner !== null && snap.yourSeats.length === 1 && result.winner === snap.yourSeats[0];
  const resultTitle = !result
    ? ""
    : result.winner === null
      ? "Draw"
      : snap.yourSeats.length === 1
        ? result.winner === snap.yourSeats[0]
          ? "You won"
          : "You lost"
        : `${snap.seats[result.winner].name} wins`;
  const opponentOffer = ch.drawOffer !== null && ch.drawOffer !== me && !spectating && !local;

  return (
    <main className="game chess-game">
      <div className="topbar">
        <Link className="btn sm" href="/play/chess" transitionTypes={["nav-back"]} aria-label="Back to lobby (the game continues)" onClick={onLeave}>
          ← Lobby
        </Link>
        <div className="info">
          {snap.mode === "bot" ? `vs Computer · ${["", "Easy", "Medium", "Hard"][ch.botLevel ?? 2]}` : snap.ranked ? "Rated" : "Casual"} · ♟{" "}
          {ch.timeControl === "none" ? "No clock" : ch.timeControl}
          {snap.spectators > 0 && <span className="eye-count"> · 👁 {snap.spectators}</span>}
        </div>
        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          {chatButton}
          <button className="btn sm" onClick={() => setMenu(true)} aria-haspopup="dialog">
            Menu
          </button>
        </span>
      </div>

      {spectating && (
        <div className="watch-bar">
          <span>
            <strong>Watching</strong>
            <span className="muted">
              {" "}
              · {snap.spectators} viewer{snap.spectators === 1 ? "" : "s"}
            </span>
          </span>
          <button className="btn sm" onClick={() => setFlip((f) => !f)}>
            Flip board
          </button>
        </div>
      )}

      {strip(topSeat)}
      <div className="board-wrap chess-wrap">
        <ChessBoard
          fen={ch.fen}
          orientation={colorOf(bottomSeat)}
          interactive={myTurn && !busy}
          lastMove={ch.moves[ch.moves.length - 1] ?? null}
          onMove={(uci) => onSend("MOVE", { uci })}
        />
      </div>
      {strip(bottomSeat)}

      <ol className="chess-moves" ref={moveList} aria-label="Moves">
        {pairs.length === 0 && <li className="muted small">White to move</li>}
        {pairs.map(([w, b], i) => (
          <li key={i}>
            <span className="muted">{i + 1}.</span> {w} {b ?? ""}
          </li>
        ))}
      </ol>

      <div className="controls" aria-live="polite">
        {snap.status === "VOIDED" ? (
          <div className="card">
            <h2>Game voided by support</h2>
            <p className="muted">It no longer counts in anyone&apos;s stats.</p>
          </div>
        ) : result ? (
          <div className="card accent">
            {(youWon || local) && result.winner !== null && <Confetti />}
            <h2>{resultTitle}</h2>
            <div className="muted">
              {result.winner === null ? END_LABEL[result.reason] : `${snap.seats[result.winner].name} wins ${END_LABEL[result.reason]}`} · {ch.san.length} moves
            </div>
            {after}
            <Link className="btn primary block" href="/play/chess">
              Back to lobby
            </Link>
          </div>
        ) : spectating ? (
          <div className="status">{snap.seats[ch.toMove].name} to move…</div>
        ) : (
          <>
            <div className="status">
              {message ??
                (opponentOffer
                  ? `${snap.seats[ch.drawOffer!].name} offers a draw.`
                  : myTurn
                    ? `${local ? `${snap.seats[ch.toMove].name}: ` : ""}Your move${ch.inCheck ? " — you are in check" : ""}. Tap a piece, then a square.`
                    : `Waiting for ${snap.seats[ch.toMove].name}…`)}
            </div>
            {opponentOffer ? (
              <div className="grid2">
                <button className="btn" disabled={busy} onClick={() => onSend("DECLINE_DRAW")}>
                  Decline
                </button>
                <button className="btn primary" disabled={busy} onClick={() => onSend("ACCEPT_DRAW")}>
                  Accept draw
                </button>
              </div>
            ) : (
              <div className="grid2">
                {!local && snap.mode !== "bot" ? (
                  <button className="btn" disabled={busy || ch.drawOffer === me || ch.moves.length < 2} onClick={() => onSend("OFFER_DRAW")}>
                    {ch.drawOffer === me ? "Draw offered" : "½ Offer draw"}
                  </button>
                ) : (
                  <span />
                )}
                <button className="btn danger" disabled={busy} onClick={() => setResign(true)}>
                  Resign
                </button>
              </div>
            )}
          </>
        )}
        {busy && <div className="status">Sending…</div>}
      </div>

      {resign && (
        <Modal title="Resign this game?" onClose={() => setResign(false)}>
          <p className="muted">Your opponent wins. This cannot be undone.</p>
          <div className="grid2">
            <button className="btn" onClick={() => setResign(false)}>
              Keep playing
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setResign(false);
                onSend("FORFEIT_MATCH", { confirm: true });
              }}
            >
              Resign
            </button>
          </div>
        </Modal>
      )}

      {menu && (
        <Modal title="Game menu" onClose={() => setMenu(false)}>
          <div className="muted small">
            Standard chess rules: castling, en passant, promotion; draws by stalemate, threefold repetition, the 50-move rule, insufficient material or
            agreement. {ch.timeControl === "none" ? "No clock." : `Clock ${ch.timeControl}: minutes each, plus seconds added after every move.`}
          </div>
          {active && snap.yourSeats.length > 0 && (
            <button
              className="btn danger block"
              onClick={() => {
                setMenu(false);
                setResign(true);
              }}
            >
              Resign…
            </button>
          )}
          {snap.yourSeats.length > 0 && (
            <Link className="btn block" href={`/profile?report=${matchId}#support`}>
              Report a problem with this game
            </Link>
          )}
          <FeedbackButton className="btn block" />
          <button className="btn block" onClick={() => setMenu(false)}>
            Close
          </button>
        </Modal>
      )}
      {overlays}
    </main>
  );
}
