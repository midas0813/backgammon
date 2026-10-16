"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Board, { boardSpot, type AnimMove, type DieView } from "@/components/Board";
import Confetti from "@/components/Confetti";
import FxLayer, { type FxHandle } from "@/components/FxLayer";
import { ChatSheet, FloatingReactions, type ChatMessageView } from "@/components/MatchChat";
import Modal from "@/components/Modal";
import ThemePicker from "@/components/ThemePicker";
import { REACTIONS } from "@/lib/chat";
import { applyMove, diceUses, legalSequences, nextMoves, pipCount, type Move, type Seat } from "@/lib/engine/board";
import type { GameResult } from "@/lib/engine/match";
import type { MatchSnapshot } from "@/lib/server/matches";
import { ClientApiError, api, sendIdempotent } from "@/lib/client/api";
import { effectsFor, longestBlock, type Effect } from "@/lib/client/fx";
import { useMe } from "@/lib/client/me";
import { useLatest } from "@/lib/client/hooks";
import { useMatchChannel } from "@/lib/client/realtime";
import { opponentAnimation, type AnimSpec } from "@/lib/client/replay";
import { sounds } from "@/lib/client/sound";
import { useTheme } from "@/lib/client/theme";

type ChatFeed = { messages: ChatMessageView[]; cursor: number };
type Snapshot = MatchSnapshot & { chatFeed?: ChatFeed };
type Poll = Snapshot | { unchanged: true; stateVersion: number; seats: Snapshot["seats"]; chatFeed?: ChatFeed };

const POLL_MS = 1000;
const BOT_POLL_MS = 700;
const SLOW_POLL_MS = 15000;
/** With instant updates connected, polling is only a safety net. */
const BACKUP_POLL_MS = 10000;
const MUTE_KEY = "bg:mute-spectators";
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
  const me = useMe();
  const router = useRouter();
  const soundOn = me?.sound ?? true;
  const soundRef = useLatest(soundOn);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Move[]>([]);
  // The checker the player picked; `selected` (below) also covers the forced pick of the bar.
  const [picked, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<GameResult | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "double" | "forfeit">(null);
  const [oppAnim, setOppAnim] = useState<AnimSpec | null>(null);
  // The checker just placed in the draft; cleared on undo so nothing replays.
  const [draftAnim, setDraftAnim] = useState<{ key: string; moves: AnimMove[] } | null>(null);
  const draftSeq = useRef(0);
  const [flip, setFlip] = useState(false);
  // The Roll button glows for a few seconds when the turn arrives.
  const [rollPing, setRollPing] = useState(false);
  useEffect(() => {
    if (!rollPing) return;
    const t = window.setTimeout(() => setRollPing(false), 4500);
    return () => window.clearTimeout(t);
  }, [rollPing]);
  const versionRef = useRef(0);
  const statusRef = useRef<string | null>(null);
  const fxRef = useRef<FxHandle>(null);
  const blockRef = useRef<[number, number]>([0, 0]);
  const animatedTurnRef = useRef<string | null>(null);
  const cursorRef = useRef<number | null>(null);
  // Chat: messages so far, the newest id seen, unread count and floating reactions.
  const [chat, setChat] = useState<ChatMessageView[]>([]);
  const chatCursor = useRef(0);
  const chatLoaded = useRef(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useLatest(chatOpen);
  const [unread, setUnread] = useState(0);
  const [reactions, setReactions] = useState<{ id: number; emoji: string; mine: boolean }[]>([]);
  // A per-device preference; the chat (where it shows) only renders after the match has loaded.
  const [muteSpectators, setMuteSpectatorsState] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const muteRef = useLatest(muteSpectators);
  const setMuteSpectators = (v: boolean) => {
    setMuteSpectatorsState(v);
    try {
      localStorage.setItem(MUTE_KEY, v ? "1" : "0");
    } catch {}
  };

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
        // Positions already on the board when we arrive are not news.
        if (s.game) blockRef.current = [longestBlock(s.game.board, 0), longestBlock(s.game.board, 1)];
        return;
      }
      const fresh = s.events.filter((e) => e.seq > cursorRef.current!);
      const lastTurn = fresh.findLast((e) => e.type === "TURN_COMMITTED")?.seq;
      const ctx = {
        yourSeats: s.yourSeats as Seat[],
        names: [s.seats[0].name, s.seats[1].name] as [string, string],
        targetPoints: s.targetPoints,
        score: s.score as [number, number],
        board: s.game?.board ?? null,
        announcedBlock: blockRef.current,
      };
      const effects: Effect[] = [];
      for (const e of fresh) effects.push(...effectsFor(e.type, e.payload as Record<string, unknown>, ctx, e.seq === lastTurn));
      fxRef.current?.play(effects);
      for (const e of fresh) {
        const p = e.payload as Record<string, unknown>;
        if (e.type === "TURN_COMMITTED" && p.forced) {
          const d = p.dice as number[];
          const closedOut = (s.game?.board.bar[Number(p.seat)] ?? 0) > 0;
          showToast(
            closedOut
              ? `${name(p.seat)} rolled ${d[0]}-${d[1]} and can't enter: closed out. Turn passes.`
              : `${name(p.seat)} rolled ${d[0]}-${d[1]}: no legal moves, turn passes.`,
          );
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
        } else if (e.type === "DICE_ROLLED" && soundRef.current) {
          sounds.dice();
        } else if (e.type === "TURN_COMMITTED" && !p.forced && soundRef.current && !s.yourSeats.includes(Number(p.seat) as Seat)) {
          sounds.move();
        } else if (e.type === "MATCH_COMPLETED" && soundRef.current) {
          sounds.win();
        }
      }
      cursorRef.current = s.eventCursor;
    },
    [showToast, soundRef],
  );

  /** New chat messages: reactions float over the board; other messages count as unread or show a toast. */
  const takeChat = useCallback(
    (feed: ChatFeed | undefined) => {
      if (!feed) return;
      const fresh = feed.messages.filter((m) => m.id > chatCursor.current);
      chatCursor.current = Math.max(chatCursor.current, feed.cursor);
      if (!fresh.length) return;
      setChat((c) => [...c, ...fresh].slice(-200));
      if (!chatLoaded.current) {
        chatLoaded.current = true;
        return; // history on arrival is not news
      }
      const floats = fresh.filter((m) => m.kind === "emoji").map((m) => ({ id: m.id, emoji: m.body, mine: m.mine }));
      if (floats.length) {
        setReactions((r) => [...r, ...floats].slice(-12));
        window.setTimeout(() => setReactions((r) => r.filter((x) => !floats.some((f) => f.id === x.id))), 2600);
      }
      const news = fresh.filter((m) => m.kind !== "emoji" && !m.mine && !(muteRef.current && m.role === "spectator"));
      if (news.length && !chatOpenRef.current) {
        setUnread((u) => u + news.length);
        const last = news[news.length - 1];
        showToast(`${last.name}: ${last.body}`);
      }
    },
    [showToast, chatOpenRef, muteRef],
  );

  const refresh = useCallback(
    async (force = false) => {
      try {
        const since = force ? 0 : versionRef.current;
        const data = await api<Poll>(`/api/matches/${matchId}?${since ? `since=${since}&` : ""}chat=${chatCursor.current}`);
        if (!chatLoaded.current && !data.chatFeed) chatLoaded.current = true;
        takeChat(data.chatFeed);
        if ("unchanged" in data) {
          setSnap((s) => (s ? { ...s, seats: data.seats } : s));
          return;
        }
        if (data.stateVersion !== versionRef.current) {
          // New authoritative state: tentative drafts never survive a version change.
          setDraft([]);
          setDraftAnim(null);
          setSelected(null);
        }
        versionRef.current = data.stateVersion;
        // Animate the opponent's new turn once; anything else (our turn, a forced pass) stops it.
        const next = opponentAnimation(animatedTurnRef.current, data.game, data.yourSeats as Seat[]);
        animatedTurnRef.current = next.key;
        if (next.anim !== undefined) setOppAnim(next.anim);
        // The host hears the moment someone takes the empty seat.
        if (statusRef.current === "WAITING" && data.status === "ACTIVE" && data.yourSeats.length === 1) {
          if (soundRef.current) sounds.joined();
          navigator.vibrate?.([60, 40, 60]);
          showToast(`${data.seats[1].name} joined — good luck!`);
        }
        statusRef.current = data.status;
        setSnap(data);
        setLoadError(null);
        announce(data);
      } catch (e) {
        if (e instanceof ClientApiError && e.status === 404) setLoadError("Match not found.");
        else if (e instanceof ClientApiError && e.status === 403) setLoadError(e.message);
      }
    },
    [matchId, announce, showToast, takeChat, soundRef],
  );

  // Instant updates: any notice on the match channel means "fetch now".
  const refreshRef = useLatest(refresh);
  const live = useMatchChannel(matchId, () => refreshRef.current());
  const liveRef = useLatest(live);

  // A played animation is dropped afterwards so it can never be handed back to the board.
  useEffect(() => {
    if (!oppAnim) return;
    const t = window.setTimeout(() => setOppAnim((cur) => (cur === oppAnim ? null : cur)), oppAnim.moves.length * 320 + 900);
    return () => window.clearTimeout(t);
  }, [oppAnim]);

  // How often to ask for news. Pass & play changes only through this device, so it needs no polling
  // beyond a slow safety check; a computer game polls quickly only while the computer is to act
  // (each poll also lets it make its next step).
  const snapRef = useLatest(snap);
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const delay = () => {
      const s = snapRef.current;
      if (!s || s.status === "WAITING") return POLL_MS;
      if (s.status !== "ACTIVE") return SLOW_POLL_MS;
      if (s.mode === "local") return SLOW_POLL_MS;
      if (s.mode === "bot") return s.seatToAct !== null && s.seats[s.seatToAct].bot ? BOT_POLL_MS : SLOW_POLL_MS;
      return liveRef.current ? BACKUP_POLL_MS : POLL_MS;
    };
    // A short tick that fetches only when due, so a faster rate applies at once (e.g. the computer's turn).
    let last = Date.now();
    const loop = async () => {
      if (document.visibilityState === "visible" && Date.now() - last >= delay()) {
        last = Date.now();
        await refresh();
      }
      if (!stopped) timer = window.setTimeout(loop, BOT_POLL_MS);
    };
    refresh(true).then(() => {
      if (!stopped) timer = window.setTimeout(loop, BOT_POLL_MS);
    });
    const onVisible = () => document.visibilityState === "visible" && refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, liveRef, snapRef]);

  // Leaving an active match asks first; it never resigns.
  const activeParticipant = !!snap && snap.status === "ACTIVE" && snap.yourSeats.length > 0;
  useEffect(() => {
    if (!activeParticipant) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    // Browser/phone back: keep a guard entry in history and ask before leaving.
    window.history.pushState({ bgGuard: true }, "");
    const onPop = () => {
      window.history.pushState({ bgGuard: true }, "");
      setLeaveAsk(true);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("beforeunload", h);
      window.removeEventListener("popstate", onPop);
    };
  }, [activeParticipant]);

  // A chime when it becomes this player's turn to act (online and computer matches).
  const prevActRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!snap || snap.yourSeats.length !== 1) return;
    const mine = snap.status === "ACTIVE" && snap.seatToAct === snap.yourSeats[0];
    if (prevActRef.current === false && mine) {
      if (soundRef.current) sounds.turn();
      navigator.vibrate?.([25, 40, 25]);
      const g = snap.game;
      const sub = g?.phase === "CUBE_PENDING" ? "Accept or pass the double" : g?.phase === "ROLLED" ? "Make your move" : "Roll the dice";
      // The mini dice show what the opponent just rolled; blank when there is no such roll yet.
      const last = g?.lastTurn;
      const theirs = g?.phase === "BEFORE_ROLL" && last && last.seat !== snap.yourSeats[0] && last.dice.length === 2 ? last : null;
      fxRef.current?.play([
        theirs
          ? {
              kind: "your-turn",
              sub,
              dice: [theirs.dice[0], theirs.dice[1]],
              caption: `${snap.seats[theirs.seat].name} rolled ${theirs.dice[0]}-${theirs.dice[1]}${theirs.forced ? " · no move" : ""}`,
            }
          : { kind: "your-turn", sub },
      ]);
      setRollPing(true);
    }
    prevActRef.current = mine;
  }, [snap, soundRef]);

  const game = snap?.game ?? null;
  const local = (snap?.yourSeats.length ?? 0) === 2;
  // Pass-and-play shows the player to act at the bottom; online players always see their own side.
  const spectating = snap?.role === "spectator";
  const viewer: Seat = !snap ? 0 : local ? (snap.seatToAct ?? game?.turn ?? 0) : spectating ? ((flip ? 1 : 0) as Seat) : ((snap.yourSeats[0] ?? 0) as Seat);
  const opp: Seat = viewer === 0 ? 1 : 0;
  const iAct = !!snap && snap.seatToAct !== null && snap.yourSeats.includes(snap.seatToAct as Seat);
  const myMovePhase = iAct && game?.phase === "ROLLED";

  const sequences = useMemo(
    () => (myMovePhase && game?.dice ? legalSequences(game.board, game.turn, diceUses(game.dice)) : [[]]),
    // Recompute only when the authoritative state changes (the game object is replaced only then).
    [myMovePhase, game],
  );
  const draftBoard = useMemo(() => {
    if (!game) return null;
    return draft.reduce((b, m) => applyMove(b, game.turn, m), game.board);
  }, [game, draft]);
  const next = useMemo(() => (myMovePhase ? nextMoves(sequences, draft) : []), [myMovePhase, sequences, draft]);
  const sources = useMemo(() => new Set(next.map((m) => m.from)), [next]);
  const complete = myMovePhase && next.length === 0;

  // Must enter from the bar: it is selected automatically.
  const selected = picked ?? (myMovePhase && sources.size === 1 && sources.has(25) ? 25 : null);

  const targets = useMemo(() => {
    const t = new Map<number, string>();
    if (selected === null) return t;
    for (const m of next.filter((n) => n.from === selected)) {
      const prev = t.get(m.to);
      t.set(m.to, prev && Number(prev) < m.die ? prev : String(m.die));
    }
    return t;
  }, [next, selected]);

  const dice = game?.dice ?? null;
  const diceView: DieView[] | null = useMemo(() => {
    if (!dice) return null;
    const uses = diceUses(dice);
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
  }, [dice, draft]);

  /** Play one checker from `from` to `to` in the draft (several dice can reach "off": the smallest). */
  const place = (from: number, to: number) => {
    const options = next.filter((m) => m.from === from && m.to === to).sort((a, b) => a.die - b.die);
    if (!options.length) return;
    setDraft((d) => [...d, options[0]]);
    setDraftAnim({ key: `draft-${++draftSeq.current}`, moves: [{ ...options[0], seat: game!.turn }] });
    if (soundRef.current) sounds.move();
    setSelected(null);
  };

  /**
   * A tap that lands just beside a point counts for the neighbour when only that one makes sense
   * (points are narrow on phones). Never across the 12/13 corner, which are far apart on screen.
   */
  const forgive = (rel: number, ok: (r: number) => boolean) => {
    if (ok(rel)) return rel;
    const near = [rel - 1, rel + 1].filter((r) => r >= 1 && r <= 24 && !(Math.min(r, rel) === 12 && Math.max(r, rel) === 13) && ok(r));
    return near.length === 1 ? near[0] : rel;
  };

  const onTap = (tapped: number) => {
    if (!myMovePhase || busy) return;
    setMessage(null);
    if (selected !== null) {
      const rel = forgive(tapped, (r) => targets.has(r) || (r === selected && tapped !== 0));
      if (targets.has(rel)) return place(selected, rel);
      if (rel === selected) return setSelected(null);
    }
    const rel = selected === null ? forgive(tapped, (r) => sources.has(r)) : tapped;
    if (sources.has(rel)) {
      if (rel === selected) return setSelected(null);
      // Only one place this checker can go: move it straight away.
      const dests = new Set(next.filter((m) => m.from === rel).map((m) => m.to));
      if (dests.size === 1) return place(rel, [...dests][0]);
      setSelected(rel);
      return;
    }
    if (selected !== null) {
      setSelected(null);
      setMessage("Not a legal destination for that checker.");
    } else if (rel !== 0) {
      setMessage(next.length ? "No legal move from that point." : "All dice used — confirm your turn.");
    }
  };

  const setSpectatorRule = async (key: "allow" | "chat" | "emoji", value: boolean) => {
    try {
      await api(`/api/matches/${matchId}/spectators`, { method: "POST", body: { [key]: value } });
      await refresh(true);
      const what = key === "allow" ? "Spectators can watch this match" : key === "chat" ? "Spectators can chat" : "Spectators can send reactions";
      showToast(value ? `${what}.` : `${what.replace("can", "can no longer")}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not change");
    }
  };

  const sendChat = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/matches/${matchId}/chat`, { method: "POST", body });
      await refresh();
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Message not sent");
      return false;
    }
  };
  const chatAction = async (id: number, action: "report" | "remove-spectator") => {
    if (action === "remove-spectator" && !window.confirm("Remove this spectator from the match? They will no longer be able to watch or chat.")) return;
    try {
      const r = await api<{ referenceId?: string }>(`/api/matches/${matchId}/chat/${id}`, { method: "POST", body: { action } });
      showToast(action === "report" ? `Reported to support (${r.referenceId}). Thank you.` : "Spectator removed from this match.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not do that");
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
          <h1 style={{ fontSize: 22 }}>{loadError}</h1>
          <Link className="btn primary" href="/play">
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
        <Link
          className="btn sm"
          href="/play"
          transitionTypes={["nav-back"]}
          aria-label="Back to lobby (the match continues)"
          onClick={(e) => {
            if (activeParticipant) {
              e.preventDefault();
              setLeaveAsk(true);
            }
          }}
        >
          ← Lobby
        </Link>
        <div className="info">
          {snap.mode === "bot" ? "vs Computer" : "Free"} · {snap.targetPoints}-pt · Game {game!.gameNumber}
          {game!.crawford ? " · Crawford" : ""}
          {snap.spectators > 0 && (
            <span className="eye-count" aria-label={`${snap.spectators} watching`}>
              {" "}
              · 👁 {snap.spectators}
            </span>
          )}
        </div>
        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          {(snap.mode === "quick" || snap.mode === "private") && (
            <button
              className="btn sm chat-btn"
              onClick={() => {
                setChatOpen(true);
                setUnread(0);
              }}
              aria-haspopup="dialog"
              aria-label={unread ? `Chat, ${unread} unread` : "Chat"}
            >
              💬{unread > 0 && <span className="chat-badge">{unread > 9 ? "9+" : unread}</span>}
            </button>
          )}
          <button className="btn sm" onClick={() => setMenuOpen(true)} aria-haspopup="dialog">
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
          <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            {snap.chat.react &&
              REACTIONS.slice(0, 3).map((e) => (
                <button key={e} className="btn sm ghost react-quick" aria-label={`React ${e}`} onClick={() => sendChat({ kind: "emoji", emoji: e })}>
                  {e}
                </button>
              ))}
            <button className="btn sm" onClick={() => setFlip((f) => !f)}>
              Flip board
            </button>
          </span>
        </div>
      )}

      {snap.hostReturnBy && !snap.yourSeats.includes(0) && <HostAway name={snap.seats[0].name} until={snap.hostReturnBy} />}

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
          mirror={me?.orientation === "left"}
          rollKey={game!.dice ? `${game!.gameNumber}-${game!.turnNumber}-${game!.dice.join("")}` : undefined}
          anim={draft.length > 0 ? draftAnim : oppAnim}
        />
        <FloatingReactions items={reactions} />
        <FxLayer
          ref={fxRef}
          sound={soundOn}
          locate={(seat, rel) => boardSpot(seat === viewer ? rel : 25 - rel, me?.orientation === "left")}
          bar={boardSpot(25, me?.orientation === "left")}
        />
      </div>

      <PlayerStrip info={bottom} seat={viewer} target={snap.targetPoints} cube={cubeOwner === "viewer" ? game!.cubeValue : null} />

      <div className="controls" aria-live="polite">
        {snap.status === "VOIDED" ? (
          <div className="card">
            <h2>Match voided by support</h2>
            <p className="muted">
              {snap.voided?.reason ? `Reason: “${snap.voided.reason}”. ` : ""}It no longer counts in anyone&apos;s stats. Nothing was at stake in this free
              match.
            </p>
            <Link className="btn primary block" href="/play">
              Back to lobby
            </Link>
          </div>
        ) : snap.status === "COMPLETED" ? (
          <MatchOver snap={snap} />
        ) : spectating ? (
          <div className="status">
            {game!.phase === "CUBE_PENDING"
              ? `${snap.seats[game!.pendingOffer!.from].name} doubled to ${game!.pendingOffer!.proposed}. ${actorName} is deciding…`
              : game!.phase === "ROLLED"
                ? `${actorName} rolled ${game!.dice!.join("-")} and is moving…`
                : `${actorName} to roll…`}
          </div>
        ) : game!.phase === "CUBE_PENDING" && iAct ? (
          <CubeDecision snap={snap} viewer={snap.seatToAct as Seat} busy={busy} onSend={send} />
        ) : game!.phase === "CUBE_PENDING" ? (
          <div className="status">
            Cube offered at {game!.pendingOffer?.proposed}. Waiting for {actorName} to accept or pass…
          </div>
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
              <button className={`btn primary${rollPing ? " btn-ping" : ""}`} disabled={busy} onClick={() => (setRollPing(false), send("ROLL"))}>
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
                    ? "Tap a highlighted point, or a button below."
                    : `${local ? `${actorName}: ` : ""}Select a checker to move.`)}
            </div>
            {selected !== null && targets.size > 0 && (
              <div className="dest-buttons" role="group" aria-label="Move the selected checker to">
                {[...targets.entries()]
                  .sort((a, b) => b[0] - a[0])
                  .map(([to, die]) => (
                    <button key={to} className="btn dest" onClick={() => place(selected, to)}>
                      {to === 0 ? "Bear off" : `→ ${to}`}
                      <span className="muted small"> · {die}</span>
                    </button>
                  ))}
              </div>
            )}
            <div className="grid2">
              <button
                className="btn"
                disabled={busy || draft.length === 0}
                onClick={() => (setDraft((d) => d.slice(0, -1)), setDraftAnim(null), setSelected(null))}
              >
                Undo
              </button>
              <button className="btn primary" disabled={busy || !complete} onClick={() => send("CONFIRM_TURN", { moves: draft })}>
                Confirm turn
              </button>
            </div>
          </>
        ) : (
          <div className="status">{game!.phase === "ROLLED" ? `${actorName} is moving…` : `Waiting for ${actorName} to roll…`}</div>
        )}
        {message && !myMovePhase && <div className="status err">{message}</div>}
        {busy && <div className="status">Sending…</div>}
      </div>

      {chatOpen && (
        <ChatSheet
          messages={chat}
          rights={snap.chat}
          isPlayer={snap.yourSeats.length > 0}
          muteSpectators={muteSpectators}
          onMuteSpectators={setMuteSpectators}
          onSend={sendChat}
          onReport={(id) => chatAction(id, "report")}
          onRemove={(id) => chatAction(id, "remove-spectator")}
          onClose={() => {
            setChatOpen(false);
            setUnread(0);
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {confirm === "double" && (
        <Modal title={`Offer the cube at ${game!.cubeValue * 2}?`} onClose={() => setConfirm(null)}>
          <p className="muted">
            Your opponent can accept (game worth {game!.cubeValue * 2}, they own the cube) or pass (you win {game!.cubeValue} point
            {game!.cubeValue > 1 ? "s" : ""}). An offer cannot be withdrawn.
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
          {snap.isHost && (snap.mode === "quick" || snap.mode === "private") && snap.status === "ACTIVE" && (
            <>
              <label className="toggle">
                <span>
                  <strong>Allow spectators</strong>
                  <span className="muted small" style={{ display: "block" }}>
                    {snap.spectators} watching now{snap.mode === "quick" ? " · listed under Watch live" : ""}
                  </span>
                </span>
                <input type="checkbox" role="switch" checked={snap.spectatorSettings.allow} onChange={(e) => setSpectatorRule("allow", e.target.checked)} />
              </label>
              {snap.spectatorSettings.allow && (
                <>
                  <label className="toggle">
                    <span>
                      <strong>Spectators can chat</strong>
                    </span>
                    <input type="checkbox" role="switch" checked={snap.spectatorSettings.chat} onChange={(e) => setSpectatorRule("chat", e.target.checked)} />
                  </label>
                  <label className="toggle">
                    <span>
                      <strong>Spectators can send reactions</strong>
                    </span>
                    <input type="checkbox" role="switch" checked={snap.spectatorSettings.emoji} onChange={(e) => setSpectatorRule("emoji", e.target.checked)} />
                  </label>
                </>
              )}
            </>
          )}
          {snap.status === "ACTIVE" && snap.yourSeats.length > 0 && (
            <button
              className="btn danger block"
              onClick={() => {
                // Close the menu first so the confirmation is not hidden behind it.
                setMenuOpen(false);
                setConfirm("forfeit");
              }}
            >
              Forfeit match…
            </button>
          )}
          {snap.yourSeats.length > 0 && (
            <Link className="btn block" href={`/profile?report=${matchId}#support`}>
              Report a problem with this match
            </Link>
          )}
          <button className="btn block" onClick={() => setMenuOpen(false)}>
            Close
          </button>
        </Modal>
      )}

      {leaveAsk && (
        <Modal title="Leave the table?" onClose={() => setLeaveAsk(false)}>
          <p className="muted">
            The match keeps going and leaving does <strong>not</strong> forfeit it. Come back from the lobby&apos;s Resume button. If it&apos;s your turn and
            you stay away for 10 minutes while your opponent waits, you lose the match by abandonment.
          </p>
          <div className="grid2">
            <button className="btn" onClick={() => setLeaveAsk(false)}>
              Stay
            </button>
            <button className="btn primary" onClick={() => router.push("/play")}>
              Go to lobby
            </button>
          </div>
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

/** Shown to the player who joined while the host was away. */
function HostAway({ name, until }: { name: string; until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((Date.parse(until) - now) / 1000));
  return (
    <div className="notice host-away" role="status">
      <strong>{name} stepped away.</strong> We&apos;ve let them know you joined. If they&apos;re not back in{" "}
      <span className="mono">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </span>
      , the match is called off with no result.
    </div>
  );
}

function PlayerStrip({
  info,
  seat,
  target,
  cube,
}: {
  info: {
    name: string;
    you: boolean;
    online: boolean;
    pips: number;
    off: number;
    score: number;
    toAct: boolean;
    avatarUrl?: string | null;
    bot?: boolean;
  };
  seat: Seat;
  target: number;
  cube: number | null;
}) {
  return (
    <div className={`strip${info.toAct ? " active" : ""}`}>
      <div className="who">
        <span style={{ position: "relative", display: "inline-flex" }}>
          <Avatar name={info.name} src={info.avatarUrl} bot={info.bot} size={34} />
          <span
            className="dot"
            style={{
              position: "absolute",
              right: -3,
              bottom: -3,
              background: seat === 0 ? "#F7F1E6" : "#101A2E",
              borderColor: seat === 0 ? "#CDBF9F" : "#61758B",
            }}
            aria-label={COLOR_NAME[seat]}
          />
        </span>
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

function CubeDecision({
  snap,
  viewer,
  busy,
  onSend,
}: {
  snap: Snapshot;
  viewer: Seat;
  busy: boolean;
  onSend: (t: string, p?: Record<string, unknown>) => void;
}) {
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
    <div className="card accent">
      {(youWon || snap.yourSeats.length === 2) && <Confetti />}
      <h2>{snap.yourSeats.length === 1 ? (youWon ? "You won the match" : "You lost the match") : `${snap.seats[winner].name} wins the match`}</h2>
      <div className="muted">
        Final score {snap.score[0]}–{snap.score[1]} ·{" "}
        {snap.endReason === "forfeit" ? "by forfeit" : snap.endReason === "abandoned" ? "by abandonment (left the table)" : `${snap.targetPoints}-point match`}
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
      <Link className="btn primary block" href="/play">
        Back to lobby
      </Link>
    </div>
  );
}

const CLOSED: Record<string, { title: string; text: string }> = {
  cancelled: { title: "Match cancelled", text: "The host closed this table." },
  expired: { title: "Table closed", text: "Nobody joined in time, so the table closed." },
  "host-missing": { title: "Match called off", text: "The host didn't come back after the second player sat down, so the match ended with no result." },
  abandoned: { title: "Match closed", text: "Both players left the table for 30 minutes, so the match closed with no result." },
  inactive: { title: "Game closed", text: "This game was left for a day, so it closed with no result." },
  ended: { title: "Game ended", text: "This game was ended before it finished, with no result." },
};

function WaitingRoom({ snap, matchId, onChange }: { snap: Snapshot; matchId: string; onChange: () => void }) {
  const router = useRouter();
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
  const playComputer = async () => {
    try {
      if (snap.canCancel) await api(`/api/matches/${matchId}/cancel`, { method: "POST" });
      const { matchId: id } = await api<{ matchId: string }>("/api/matches", {
        method: "POST",
        body: { mode: "bot", targetPoints: snap.targetPoints },
      });
      router.push(`/match/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  };
  if (snap.status === "CANCELLED") {
    const closed = CLOSED[snap.closedReason ?? ""] ?? CLOSED.cancelled;
    return (
      <main className="page">
        <div className="card">
          <h1>{closed.title}</h1>
          <p className="muted">{closed.text} Nothing was reserved for this free match.</p>
          <Link className="btn primary" href="/play">
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
        {!snap.canJoin && (
          <div className="searching" aria-hidden>
            <span className="radar" />
            <span className="searching-dice">
              <span />
              <span />
            </span>
            <span className="muted small">
              {snap.mode === "quick"
                ? "Your table is listed in the lobby. We'll bring you to the board the moment someone sits down."
                : "Share the link below."}
            </span>
          </div>
        )}
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
            <span>Spectators</span>
            <span>{snap.allowSpectators ? "Allowed" : "Off"}</span>
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
            <p className="notice" style={{ margin: 0 }}>
              {snap.mode === "quick"
                ? "Waiting for another player to join from the lobby. If you step away, the table stays listed as “host away” and closes after 15 minutes. "
                : "Send this link to your opponent. The invite expires 15 minutes after you opened the table. "}
              A second tab in this browser counts as you, so test with a private window or another device — or play the computer now.
            </p>
            <button className="btn primary block" onClick={playComputer}>
              Play vs computer instead
            </button>
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
      <Link href="/play" className="btn">
        ← Lobby
      </Link>
    </main>
  );
}
