"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Emoji from "@/components/Emoji";
import { ChatSheet, FloatingReactions, type ChatMessageView } from "@/components/MatchChat";
import { REACTIONS } from "@/lib/chat";
import { useLatest } from "@/lib/client/hooks";
import { toast } from "@/lib/client/toast";
import Board from "@/components/Board";
import { api } from "@/lib/client/api";
import { framesFromEvents } from "@/lib/client/replayFrames";
import { useTheme } from "@/lib/client/theme";

type History = { events: { type: string; payload: Record<string, unknown> }[]; delayMs: number };

/**
 * Watching a ranked or tournament match: the board runs a little behind (the server sends nothing
 * newer), so nobody can pass live positions to a player.
 */
export default function DelayedWatch({
  matchId,
  names,
  targetPoints,
  delayMs,
  rights,
}: {
  matchId: string;
  names: [string, string];
  targetPoints: number;
  delayMs: number;
  rights: { send: boolean; react: boolean };
}) {
  const theme = useTheme();
  const [events, setEvents] = useState<History["events"]>([]);
  // Chat and reactions work as in any watched match.
  const [chat, setChat] = useState<ChatMessageView[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [reactions, setReactions] = useState<{ id: number; emoji: string; mine: boolean }[]>([]);
  const cursor = useRef(0);
  const loadedChat = useRef(false);
  const loadChat = async () => {
    const feed = await api<{ messages: ChatMessageView[]; cursor: number }>(`/api/matches/${matchId}/chat?after=${cursor.current}`).catch(() => null);
    if (!feed) return;
    const fresh = feed.messages.filter((m) => m.id > cursor.current);
    cursor.current = Math.max(cursor.current, feed.cursor);
    if (!fresh.length) return;
    setChat((c) => [...c, ...fresh].slice(-200));
    if (!loadedChat.current) {
      loadedChat.current = true;
      return;
    }
    const floats = fresh.filter((m) => m.kind === "emoji").map((m) => ({ id: m.id, emoji: m.body, mine: m.mine }));
    if (floats.length) {
      setReactions((r) => [...r, ...floats].slice(-12));
      window.setTimeout(() => setReactions((r) => r.filter((x) => !floats.some((f) => f.id === x.id))), 2600);
    }
  };
  const loadChatRef = useLatest(loadChat);
  const send = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/matches/${matchId}/chat`, { method: "POST", body });
      await loadChatRef.current();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Message not sent", { tone: "warn" });
      return false;
    }
  };
  useEffect(() => {
    const load = () => {
      void loadChatRef.current();
      return api<History>(`/api/matches/${matchId}/history?cursor=0`)
        .then((h) => setEvents(h.events))
        .catch(() => {});
    };
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 2000);
    return () => window.clearInterval(t);
  }, [matchId, loadChatRef]);
  const frames = useMemo(() => framesFromEvents(events, names), [events, names]);
  const f = frames[frames.length - 1];
  return (
    <main className="game">
      <div className="topbar">
        <Link className="btn sm" href="/play">
          ← Lobby
        </Link>
        <div className="info">
          Watching · {names[0]} vs {names[1]} · {targetPoints}-pt
        </div>
        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <span className="badge" title="Ranked and tournament matches are shown to spectators a little late">
            {Math.round(delayMs / 1000)} s delay
          </span>
          <button className="btn sm chat-btn" onClick={() => setChatOpen(true)} aria-label="Chat">
            💬
          </button>
        </span>
      </div>
      {rights.react && (
        <div className="watch-bar">
          <span className="muted small">React</span>
          <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            {REACTIONS.slice(0, 3).map((e) => (
              <button key={e} className="btn sm ghost react-quick" aria-label={`React ${e}`} onClick={() => send({ kind: "emoji", emoji: e })}>
                <Emoji char={e} size={24} replayOnHover />
              </button>
            ))}
          </span>
        </div>
      )}
      {chatOpen && (
        <ChatSheet
          messages={chat}
          rights={rights}
          isPlayer={false}
          muteSpectators={false}
          onMuteSpectators={() => {}}
          onSend={send}
          onReport={(id) => api(`/api/matches/${matchId}/chat/${id}`, { method: "POST", body: { action: "report" } }).then(() => toast("Reported. Thank you."))}
          onRemove={() => {}}
          onClose={() => setChatOpen(false)}
        />
      )}
      {f ? (
        <>
          <div className="board-wrap">
            <FloatingReactions items={reactions} />
            <Board
              board={f.board}
              viewer={0}
              theme={theme}
              dice={f.dice ? f.dice.map((v) => ({ value: v, used: false })) : null}
              diceOwner={f.diceSeat === 1 ? "opponent" : "viewer"}
              cube={{ value: f.cube, owner: f.cubeOwner === null ? null : f.cubeOwner === 0 ? "viewer" : "opponent", disabled: false }}
              selectable={new Set()}
              selected={null}
              targets={new Map()}
              anim={f.moves.length ? { key: `d${frames.length}`, moves: f.moves } : null}
            />
          </div>
          <div className="replay-caption" aria-live="polite">
            <span className="muted small">
              Game {f.game} · score {f.score[0]}–{f.score[1]}
            </span>
            <strong>{f.caption}</strong>
          </div>
        </>
      ) : (
        <p className="muted">The match has just started; the first moves appear here in a few seconds.</p>
      )}
    </main>
  );
}
