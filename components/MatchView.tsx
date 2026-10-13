"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Board, { type DieView } from "@/components/Board";
import ThemePicker from "@/components/ThemePicker";
import { applyMove, diceUses, legalSequences, nextMoves, pipCount, type Move, type Seat } from "@/lib/engine/board";
import type { GameResult } from "@/lib/engine/match";
import type { MatchSnapshot } from "@/lib/server/matches";
import { ClientApiError, api, sendIdempotent } from "@/lib/client/api";
import { useTheme } from "@/lib/client/theme";

type Snapshot = MatchSnapshot;
type Poll = Snapshot | { unchanged: true; stateVersion: number; seats: Snapshot["seats"] };

const POLL_MS = 1000;
const COLOR_NAME = ["White", "Black"];
const KIND_LABEL: Record<GameResult["kind"], string> = {
  single: "Single game",
  gammon: "Gammon (×2)",
  backgammon: "Backgammon (×3)",
  pass: "Cube passed",
  forfeit: "Match forfeited",
};
const CUBE_REASON: Record<string, string> = {
  CRAWFORD_CUBE_DISABLED: "Crawford game — no doubling",
  CUBE_NOT_OWNED: "Opponent owns the cube",
  CUBE_CAPPED: "Cube is at the 128 cap",
  CUBE_DEAD: "Doubling gains you nothing (dead cube)",
};

export default function MatchView({ matchId }: { matchId: string }) {
  const theme = useTheme();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Move[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<GameResult | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "double" | "forfeit">(null);
  const versionRef = useRef(0);
  const cursorRef = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3500);
  }, []);

  /** Announce new authoritative events (forced passes, cube decisions, game results). */
  const announce = useCallback(
    (s: Snapshot) => {
      const name = (seat: unknown) => s.seats[Number(seat)]?.name ?? "";
      if (cursorRef.current === null) {
        cursorRef.current = s.eventCursor;
        return;
      }
      for (const e of s.events) {
        if (e.seq <= cursorRef.current) continue;
        const p = e.payload as Record<string, unknown>;
        if (e.type === "TURN_COMMITTED" && p.forced) {
          const d = p.dice as number[];
          showToast(`${name(p.seat)} rolled ${d[0]}-${d[1]}: no legal moves, turn passes.`);
        } else if (e.type === "CUBE_ACCEPTED") {
          showToast(`${name(p.owner)} accepted. Cube is now ${p.cube}.`);
        } else if (e.type === "OPENING_ROLL_COMMITTED") {
          const rolls = p.openingRolls as [number, number][];
          const [w, b] = rolls[rolls.length - 1];
          showToast(
            `Game ${p.gameNumber}: opening roll White ${w}, Black ${b}${rolls.length > 1 ? " (tie rerolled)" : ""}. ${name(p.firstSeat)} moves first.${p.crawford ? " Crawford game: no cube." : ""}`,
          );
        } else if (e.type === "GAME_COMPLETED") {
          setResultModal(p as unknown as GameResult);
        }
      }
      cursorRef.current = s.eventCursor;
    },
    [showToast],
  );

  const refresh = useCallback(
    async (force = false) => {
      try {
        const since = force ? 0 : versionRef.current;
        const data = await api<Poll>(`/api/matches/${matchId}${since ? `?since=${since}` : ""}`);
        if ("unchanged" in data) {
          setSnap((s) => (s ? { ...s, seats: data.seats } : s));
          return;
        }
        if (data.stateVersion !== versionRef.current) {
          // New authoritative state: tentative drafts never survive a version change.
          setDraft([]);
          setSelected(null);
        }
        versionRef.current = data.stateVersion;
        setSnap(data);
        setLoadError(null);
        announce(data);
      } catch (e) {
        if (e instanceof ClientApiError && e.status === 404) setLoadError("Match not found.");
      }
    },
    [matchId, announce],
  );

  useEffect(() => {
    refresh(true);
    const t = window.setInterval(() => refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Leaving an active match asks first; it never resigns.
  const activeParticipant = !!snap && snap.status === "ACTIVE" && snap.yourSeats.length > 0;
  useEffect(() => {
    if (!activeParticipant) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [activeParticipant]);

  const game = snap?.game ?? null;
  const local = (snap?.yourSeats.length ?? 0) === 2;
  // Pass-and-play shows the player to act at the bottom; online players always see their own side.
  const viewer: Seat = !snap ? 0 : local ? (snap.seatToAct ?? game?.turn ?? 0) : ((snap.yourSeats[0] ?? 0) as Seat);
  const opp: Seat = viewer === 0 ? 1 : 0;
  const iAct = !!snap && snap.seatToAct !== null && snap.yourSeats.includes(snap.seatToAct as Seat);
  const myMovePhase = iAct && game?.phase === "ROLLED";

  const sequences = useMemo(
    () => (myMovePhase && game?.dice ? legalSequences(game.board, game.turn, diceUses(game.dice)) : [[]]),
    // Recompute only when the authoritative state changes.
    [myMovePhase, snap?.stateVersion],
  );
  const draftBoard = useMemo(() => {
    if (!game) return null;
    return draft.reduce((b, m) => applyMove(b, game.turn, m), game.board);
  }, [game, draft]);
  const next = useMemo(() => (myMovePhase ? nextMoves(sequences, draft) : []), [myMovePhase, sequences, draft]);
  const sources = useMemo(() => new Set(next.map((m) => m.from)), [next]);
  const complete = myMovePhase && next.length === 0;

  // Must enter from the bar: select it automatically.
  useEffect(() => {
    if (myMovePhase && selected === null && sources.size === 1 && sources.has(25)) setSelected(25);
  }, [myMovePhase, selected, sources]);

  const targets = useMemo(() => {
    const t = new Map<number, string>();
    if (selected === null) return t;
    for (const m of next.filter((n) => n.from === selected)) {
      const prev = t.get(m.to);
      t.set(m.to, prev && Number(prev) < m.die ? prev : String(m.die));
    }
    return t;
  }, [next, selected]);

  const diceView: DieView[] | null = useMemo(() => {
    if (!game?.dice) return null;
    const uses = diceUses(game.dice);
    const usedCount = new Map<number, number>();
    for (const m of draft) usedCount.set(m.die, (usedCount.get(m.die) ?? 0) + 1);
    return uses.map((v) => {
      const left = usedCount.get(v) ?? 0;
      if (left > 0) {
        usedCount.set(v, left - 1);
        return { value: v, used: true };
      }
      return { value: v, used: false };
    });
  }, [game?.dice, draft]);

  const onTap = (rel: number) => {
    if (!myMovePhase || busy) return;
    setMessage(null);
    if (selected !== null && targets.has(rel)) {
      // Several dice can reach "off": use the smallest legal one.
      const options = next.filter((m) => m.from === selected && m.to === rel).sort((a, b) => a.die - b.die);
      setDraft((d) => [...d, options[0]]);
      setSelected(null);
      return;
    }
    if (sources.has(rel)) {
      setSelected(rel === selected ? null : rel);
      return;
    }
    if (selected !== null) {
      setSelected(null);
      setMessage("Not a legal destination for that checker.");
    } else if (rel !== 0) {
      setMessage(next.length ? "No legal move from that point." : "All dice used — confirm your turn.");
    }
  };

  const send = async (actionType: string, payload?: Record<string, unknown>) => {
    if (!snap) return;
    setBusy(true);
    setMessage(null);
    try {
      await sendIdempotent(`/api/matches/${matchId}/actions`, { expectedVersion: snap.stateVersion, actionType, payload });
      await refresh(true);
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "STALE_VERSION") {
        showToast("The board was updated — showing the latest position.");
        await refresh(true);
      } else {
        setMessage(e instanceof Error ? e.message : "Action failed");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <main className="page">
        <div className="card">
          <h1>{loadError}</h1>
          <Link className="btn primary" href="/">
            Back to lobby
          </Link>
        </div>
      </main>
    );
  }
  if (!snap) {
    return (
      <main className="page">
        <p className="muted">Loading match…</p>
      </main>
    );
  }

  if (snap.status === "WAITING" || snap.status === "CANCELLED") {
    return <WaitingRoom snap={snap} matchId={matchId} onChange={() => refresh(true)} />;
  }

  const board = draftBoard ?? game!.board;
  const seatInfo = (seat: Seat) => {
    const s = snap.seats[seat];
    const you = snap.yourSeats.includes(seat) && !local;
    return {
      ...s,
      you,
      pips: pipCount(board, seat),
      off: board.off[seat],
      score: snap.score[seat],
      toAct: snap.status === "ACTIVE" && snap.seatToAct === seat,
    };
  };
  const top = seatInfo(opp);
  const bottom = seatInfo(viewer);
  const cubeOwner = game!.cubeOwner === null ? null : game!.cubeOwner === viewer ? "viewer" : "opponent";
  const myCubeBlock = iAct ? game!.cubeBlock[snap.seatToAct as Seat] : null;
  const actorName = snap.seatToAct !== null ? snap.seats[snap.seatToAct].name : "";
  const lastMoved = new Set<number>();
  if (game!.lastTurn && game!.lastTurn.seat !== viewer) {
    // Show the opponent's previous move in viewer-relative numbering.
    for (const m of game!.lastTurn.moves) if (m.to >= 1 && m.to <= 24) lastMoved.add(25 - m.to);
  }

  return (
    <main className="game">
      <div className="topbar">
        <Link className="btn sm" href="/" aria-label="Back to lobby (the match continues)">
          ← Lobby
        </Link>
        <div className="info">
          Free · {snap.targetPoints}-pt · Game {game!.gameNumber}
          {game!.crawford ? " · Crawford" : ""}
        </div>
        <button className="btn sm" onClick={() => setMenuOpen(true)} aria-haspopup="dialog">
          Menu
        </button>
      </div>

      <PlayerStrip info={top} seat={opp} target={snap.targetPoints} cube={cubeOwner === "opponent" ? game!.cubeValue : null} />

      <div className="board-wrap">
        <Board
          board={board}
          viewer={viewer}
          theme={theme}
          dice={diceView}
          diceOwner={game!.turn === viewer ? "viewer" : "opponent"}
          cube={{ value: game!.cubeValue, owner: cubeOwner, disabled: game!.crawford }}
          selectable={myMovePhase ? sources : new Set()}
          selected={selected}
          targets={targets}
          lastMoved={lastMoved}
          onTap={onTap}
        />
      </div>

      <PlayerStrip info={bottom} seat={viewer} target={snap.targetPoints} cube={cubeOwner === "viewer" ? game!.cubeValue : null} />

      <div className="controls" aria-live="polite">
        {snap.status === "COMPLETED" ? (
          <MatchOver snap={snap} />
        ) : !snap.yourSeats.length ? (
          <div className="status">You are watching this match.</div>
        ) : game!.phase === "CUBE_PENDING" && iAct ? (
          <CubeDecision snap={snap} viewer={snap.seatToAct as Seat} busy={busy} onSend={send} />
        ) : game!.phase === "CUBE_PENDING" ? (
          <div className="status">Cube offered at {game!.pendingOffer?.proposed}. Waiting for {actorName} to accept or pass…</div>
        ) : iAct && game!.phase === "BEFORE_ROLL" ? (
          <>
            <div className="status">
              {local ? `${actorName}: ` : ""}Roll the dice{myCubeBlock ? "" : ` or offer the cube at ${game!.cubeValue * 2}`}.
              {myCubeBlock && <span className="small"> ({CUBE_REASON[myCubeBlock] ?? myCubeBlock})</span>}
            </div>
            <div className="grid2">
              <button className="btn" disabled={busy || !!myCubeBlock} onClick={() => setConfirm("double")}>
                Double → {game!.cubeValue * 2}
              </button>
              <button className="btn primary" disabled={busy} onClick={() => send("ROLL")}>
                Roll
              </button>
            </div>
          </>
        ) : myMovePhase ? (
          <>
            <div className="status">
              {message ??
                (complete
                  ? "Turn complete. Confirm to commit, or undo."
                  : selected !== null
                    ? "Tap a highlighted destination."
                    : `${local ? `${actorName}: ` : ""}Select a checker to move.`)}
            </div>
            <div className="grid2">
              <button className="btn" disabled={busy || draft.length === 0} onClick={() => (setDraft((d) => d.slice(0, -1)), setSelected(null))}>
                Undo
              </button>
              <button className="btn primary" disabled={busy || !complete} onClick={() => send("CONFIRM_TURN", { moves: draft })}>
                Confirm turn
              </button>
            </div>
          </>
        ) : (
          <div className="status">
            {game!.phase === "ROLLED" ? `${actorName} is moving…` : `Waiting for ${actorName} to roll…`}
          </div>
        )}
        {message && !myMovePhase && <div className="status err">{message}</div>}
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {confirm === "double" && (
        <Modal title={`Offer the cube at ${game!.cubeValue * 2}?`} onClose={() => setConfirm(null)}>
          <p className="muted">
            Your opponent can accept (game worth {game!.cubeValue * 2}, they own the cube) or pass (you win {game!.cubeValue}{" "}
            point{game!.cubeValue > 1 ? "s" : ""}). An offer cannot be withdrawn.
          </p>
          <div className="grid2">
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setConfirm(null);
                send("OFFER_DOUBLE", { proposedCube: game!.cubeValue * 2 });
              }}
            >
              Offer double
            </button>
          </div>
        </Modal>
      )}

      {confirm === "forfeit" && (
        <Modal title="Forfeit the whole match?" onClose={() => setConfirm(null)}>
          <p className="muted">Your opponent will be declared the match winner. This cannot be undone.</p>
          <div className="grid2">
            <button className="btn" onClick={() => setConfirm(null)}>
              Keep playing
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setConfirm(null);
                setMenuOpen(false);
                send("FORFEIT_MATCH", { confirm: true });
              }}
            >
              Forfeit match
            </button>
          </div>
        </Modal>
      )}

      {menuOpen && (
        <Modal title="Match menu" onClose={() => setMenuOpen(false)}>
          <p className="muted small">Board appearance (only changes your view — dice, moves and score are unaffected)</p>
          <ThemePicker />
          <div className="muted small">
            Rules {snap.rulesVersion} · cube cap 128 · Crawford rule · no clocks in this MVP · state v{snap.stateVersion}
          </div>
          {snap.status === "ACTIVE" && snap.yourSeats.length > 0 && (
            <button className="btn danger block" onClick={() => setConfirm("forfeit")}>
              Forfeit match…
            </button>
          )}
          <button className="btn block" onClick={() => setMenuOpen(false)}>
            Close
          </button>
        </Modal>
      )}

      {resultModal && snap.status !== "COMPLETED" && (
        <Modal title={`${snap.seats[resultModal.winner].name} wins game ${resultModal.gameNumber}`} onClose={() => setResultModal(null)}>
          <ResultDetails r={resultModal} snap={snap} />
          <button className="btn primary block" onClick={() => setResultModal(null)}>
            Continue to game {resultModal.gameNumber + 1}
          </button>
        </Modal>
      )}
    </main>
  );
}

function PlayerStrip({
  info,
  seat,
  target,
  cube,
}: {
  info: { name: string; you: boolean; online: boolean; pips: number; off: number; score: number; toAct: boolean };
  seat: Seat;
  target: number;
  cube: number | null;
}) {
  return (
    <div className={`strip${info.toAct ? " active" : ""}`}>
      <div className="who">
        <span
          className="dot"
          style={{ background: seat === 0 ? "#F7F1E6" : "#101A2E", borderColor: seat === 0 ? "#CDBF9F" : "#61758B" }}
          aria-label={COLOR_NAME[seat]}
        />
        <span className="name">
          {info.name}
          {info.you ? " (you)" : ""}
        </span>
        {!info.online && <span className="badge warn">offline</span>}
        {info.toAct && <span className="badge ok">to act</span>}
      </div>
      <div className="stats mono">
        <span>
          {info.score}/{target}
        </span>
        <span>Pips {info.pips}</span>
        <span>Off {info.off}</span>
        {cube && <span className="badge">Cube {cube}</span>}
      </div>
    </div>
  );
}

function CubeDecision({ snap, viewer, busy, onSend }: { snap: Snapshot; viewer: Seat; busy: boolean; onSend: (t: string, p?: Record<string, unknown>) => void }) {
  const g = snap.game!;
  const offer = g.pendingOffer!;
  const offerer = snap.seats[offer.from].name;
  const passScore = [...snap.score];
  passScore[offer.from] += g.cubeValue;
  return (
    <div className="card" style={{ borderColor: "var(--warning)" }}>
      <h2>
        {offerer} doubles: {g.cubeValue} → {offer.proposed}
      </h2>
      <div className="muted small">
        <div>
          <strong>Accept:</strong> the game is worth {offer.proposed} ({offer.proposed * 2} gammon, {offer.proposed * 3} backgammon) and you own the cube.
        </div>
        <div>
          <strong>Pass:</strong> {offerer} wins {g.cubeValue} point{g.cubeValue > 1 ? "s" : ""}; score becomes {passScore[0]}–{passScore[1]} (to{" "}
          {snap.targetPoints}).
        </div>
      </div>
      <div className="grid2">
        <button className="btn danger" disabled={busy} onClick={() => onSend("PASS_DOUBLE", { pendingOfferId: offer.offerId })}>
          Pass
        </button>
        <button className="btn primary" disabled={busy} onClick={() => onSend("ACCEPT_DOUBLE", { pendingOfferId: offer.offerId })}>
          Accept
        </button>
      </div>
      <div className="muted small">{snap.seats[viewer].name} to decide</div>
    </div>
  );
}

function ResultDetails({ r, snap }: { r: GameResult; snap: Snapshot }) {
  const multiplier = r.kind === "gammon" ? 2 : r.kind === "backgammon" ? 3 : 1;
  return (
    <ul className="list">
      <li>
        <span>Outcome</span>
        <strong>{KIND_LABEL[r.kind]}</strong>
      </li>
      {r.kind !== "forfeit" && (
        <li>
          <span>Points</span>
          <span className="mono">{r.kind === "pass" ? `cube ${r.cube} = ${r.points}` : `cube ${r.cube} × ${multiplier} = ${r.points}`}</span>
        </li>
      )}
      <li>
        <span>Score</span>
        <span className="mono">
          {snap.seats[0].name} {r.scoreAfter[0]} – {r.scoreAfter[1]} {snap.seats[1].name} (to {snap.targetPoints})
        </span>
      </li>
      <li>
        <span>Tokens</span>
        <span className="muted">Free match — nothing at stake, net change 0</span>
      </li>
    </ul>
  );
}

function MatchOver({ snap }: { snap: Snapshot }) {
  const winner = snap.winner as Seat;
  const youWon = snap.yourSeats.length === 1 && snap.yourSeats[0] === winner;
  const last = snap.results[snap.results.length - 1];
  return (
    <div className="card">
      <h2>
        {snap.yourSeats.length === 1 ? (youWon ? "You won the match" : "You lost the match") : `${snap.seats[winner].name} wins the match`}
      </h2>
      <div className="muted">
        Final score {snap.score[0]}–{snap.score[1]} · {snap.endReason === "forfeit" ? "by forfeit" : `${snap.targetPoints}-point match`}
      </div>
      {last && <ResultDetails r={last} snap={snap} />}
      <details>
        <summary className="muted small">All games ({snap.results.length})</summary>
        <ul className="list small">
          {snap.results.map((r) => (
            <li key={r.gameNumber}>
              <span>
                Game {r.gameNumber}: {snap.seats[r.winner].name}
              </span>
              <span className="mono">
                {KIND_LABEL[r.kind]} +{r.points}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <Link className="btn primary block" href="/">
        Back to lobby
      </Link>
    </div>
  );
}

function WaitingRoom({ snap, matchId, onChange }: { snap: Snapshot; matchId: string; onChange: () => void }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = typeof window !== "undefined" ? `${window.location.origin}/match/${matchId}` : "";
  const act = async (path: string) => {
    try {
      await api(path, { method: "POST" });
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  };
  if (snap.status === "CANCELLED") {
    return (
      <main className="page">
        <div className="card">
          <h1>Match cancelled</h1>
          <p className="muted">Nothing was reserved for this free match.</p>
          <Link className="btn primary" href="/">
            Back to lobby
          </Link>
        </div>
      </main>
    );
  }
  return (
    <main className="page">
      <div className="card">
        <div className="spread">
          <h1>{snap.canJoin ? "Join match" : snap.mode === "quick" ? "Finding an opponent…" : "Waiting for your friend"}</h1>
          <span className="badge ok">Free</span>
        </div>
        <ul className="list">
          <li>
            <span>Host</span>
            <strong>{snap.seats[0].name}</strong>
          </li>
          <li>
            <span>Format</span>
            <span>{snap.targetPoints}-point match</span>
          </li>
          <li>
            <span>Cube</span>
            <span>On · cap 128 · Crawford rule</span>
          </li>
          <li>
            <span>Clock</span>
            <span className="muted">None in MVP</span>
          </li>
          <li>
            <span>Entry / reservation</span>
            <span>Free — no tokens reserved</span>
          </li>
        </ul>
        {snap.canJoin && (
          <button className="btn primary block" onClick={() => act(`/api/matches/${matchId}/join`)}>
            Join as Black
          </button>
        )}
        {!snap.canJoin && (
          <>
            <label>
              Invite link (open on another device or a private window)
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <button
              className="btn block"
              onClick={() => {
                navigator.clipboard?.writeText(url).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied ✓" : "Copy invite link"}
            </button>
          </>
        )}
        {snap.canCancel && (
          <button className="btn danger block" onClick={() => act(`/api/matches/${matchId}/cancel`)}>
            Cancel match
          </button>
        )}
        {err && <p className="err small">{err}</p>}
      </div>
      <Link href="/" className="btn">
        ← Lobby
      </Link>
    </main>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
