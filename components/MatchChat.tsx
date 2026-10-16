"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Emoji, { EmojiPicker } from "@/components/Emoji";
import { CHAT_MAX, PRESETS, REACTIONS, emojiFromCode } from "@/lib/chat";
import type { ChatView } from "@/lib/server/chat";

export type ChatMessageView = ChatView;

/**
 * Match chat: a side panel on wide screens, a sheet from the bottom on phones. Players and spectators
 * write their own messages or tap a preset phrase; reactions float over the board for everyone.
 */
export function ChatSheet({
  messages,
  rights,
  isPlayer,
  muteSpectators,
  onMuteSpectators,
  onSend,
  onReport,
  onRemove,
  onClose,
}: {
  messages: ChatMessageView[];
  rights: { send: boolean; react: boolean };
  isPlayer: boolean;
  muteSpectators: boolean;
  onMuteSpectators: (v: boolean) => void;
  onSend: (body: { kind: "text"; text: string } | { kind: "preset"; preset: string } | { kind: "emoji"; emoji: string }) => Promise<boolean>;
  onReport: (id: number) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const shown = messages.filter((m) => !(muteSpectators && m.role === "spectator" && !m.mine));

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [shown.length]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const send = async (body: Parameters<typeof onSend>[0]) => {
    setSending(true);
    const ok = await onSend(body);
    setSending(false);
    if (ok && body.kind === "text") setText("");
  };

  return createPortal(
    <div className="chat-backdrop" onClick={onClose}>
      <section className="chat-sheet" role="dialog" aria-modal="true" aria-label="Match chat" onClick={(e) => e.stopPropagation()}>
        <header className="chat-head">
          <strong>Chat</strong>
          {isPlayer && (
            <label className="chat-mute">
              <input type="checkbox" checked={muteSpectators} onChange={(e) => onMuteSpectators(e.target.checked)} /> Mute spectators
            </label>
          )}
          <button className="rb-close" onClick={onClose} aria-label="Close chat">
            ×
          </button>
        </header>

        <ol className="chat-list" ref={list} aria-live="polite">
          {shown.length === 0 && <li className="chat-empty muted small">No messages yet. Say hello!</li>}
          {shown.map((m) => (
            <li key={m.id} className={`chat-msg${m.mine ? " mine" : ""}${m.role === "spectator" ? " spectator" : ""}`}>
              <span className="chat-meta">
                <strong>{m.mine ? "You" : m.name}</strong>
                {m.role === "spectator" && <span className="chat-tag">watching</span>}
                {!m.mine && (
                  <button className="chat-more" aria-label="Message options" onClick={() => setMenu(menu === m.id ? null : m.id)}>
                    ⋯
                  </button>
                )}
              </span>
              {m.kind === "emoji" ? (
                <span className="chat-emoji" aria-label={m.body}>
                  <Emoji char={m.body} size={44} replayOnHover />
                </span>
              ) : (
                <span className={`chat-body${m.kind === "preset" ? " preset" : ""}`}>{m.body}</span>
              )}
              {menu === m.id && (
                <span className="chat-actions">
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setMenu(null);
                      onReport(m.id);
                    }}
                  >
                    Report
                  </button>
                  {m.removable && (
                    <button
                      className="btn sm danger"
                      onClick={() => {
                        setMenu(null);
                        onRemove(m.id);
                      }}
                    >
                      Remove from match
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ol>

        {rights.react && (
          <div className="chat-reactions" role="group" aria-label="Reactions">
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => send({ kind: "emoji", emoji: e })} disabled={sending} aria-label={`React ${e}`}>
                <Emoji char={e} size={30} replayOnHover />
              </button>
            ))}
            <button className="chat-more-emoji" onClick={() => setPicker(true)} disabled={sending} aria-label="More emojis">
              +
            </button>
          </div>
        )}
        {picker && (
          <EmojiPicker
            isOpen
            theme="dark"
            title="Send a reaction"
            width="min(480px, calc(100vw - 24px))"
            height="min(520px, 70dvh)"
            onClose={() => setPicker(false)}
            onEmojiSelect={(code) => {
              setPicker(false);
              send({ kind: "emoji", emoji: emojiFromCode(code) });
            }}
          />
        )}
        {rights.send ? (
          <>
            <div className="chat-presets" role="group" aria-label="Quick messages">
              {Object.entries(PRESETS).map(([id, label]) => (
                <button key={id} className="chip" disabled={sending} onClick={() => send({ kind: "preset", preset: id })}>
                  {label}
                </button>
              ))}
            </div>
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send({ kind: "text", text });
              }}
            >
              <input
                value={text}
                maxLength={CHAT_MAX}
                onChange={(e) => setText(e.target.value)}
                placeholder="Message"
                aria-label="Message"
                enterKeyHint="send"
              />
              <button className="btn primary sm" disabled={sending || !text.trim()}>
                Send
              </button>
            </form>
          </>
        ) : (
          <p className="muted small chat-off">The host turned off chat for spectators.</p>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** Reactions floating up over the board. */
export function FloatingReactions({ items }: { items: { id: number; emoji: string; mine: boolean }[] }) {
  return (
    <div className="reactions-layer" aria-hidden>
      {items.map((r) => (
        <span key={r.id} className="reaction-float" style={{ left: `${12 + ((r.id * 37) % 76)}%` }}>
          <Emoji char={r.emoji} size={56} loop />
        </span>
      ))}
    </div>
  );
}
