import { randomBytes } from "node:crypto";
import { CHAT_MAX, PRESETS, REACTIONS } from "../chat";
import { ApiError, notFound } from "./errors";
import { assertMayWatch, chatRights, removeSpectatorIn } from "./matches";
import { publish } from "./realtime";
import { operatorSettings } from "./settings";
import { tx, type ChatMessage, type MatchRecord, type Tx } from "./store";
import { assertActive } from "./users";

/**
 * Match chat (C3): the two players and spectators exchange messages — preset phrases or their own
 * words — and spectators can float emoji reactions over the board. The host decides whether
 * spectators may chat and react; players can always talk to each other.
 */

// A short list of slurs and obscenities, masked rather than refused. Moderation (reports, admin
// removal) handles the rest.
const BLOCKED = ["fuck", "shit", "cunt", "bitch", "nigger", "nigga", "faggot", "retard", "whore", "slut", "dick", "pussy", "asshole"];
const BLOCKED_RE = new RegExp(`\\b(${BLOCKED.join("|")})\\w*`, "gi");

export function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX)
    .replace(BLOCKED_RE, (w) => w[0] + "*".repeat(w.length - 1));
}

/** Spectator messages are hidden from the players while a match with an entry fee is in play (no coaching). */
const hiddenFrom = (rec: MatchRecord, userId: string, m: ChatMessage) =>
  m.role === "spectator" && (rec.entryFee ?? 0) > 0 && rec.state.status === "ACTIVE" && rec.seats.includes(userId);

function view(rec: MatchRecord, userId: string, m: ChatMessage) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    kind: m.kind,
    body: m.body,
    at: m.createdAt,
    mine: m.userId === userId,
    // The host can remove a spectator from the match from one of their messages.
    removable: m.role === "spectator" && rec.createdBy === userId && m.userId !== userId,
  };
}

export type ChatView = ReturnType<typeof view>;

async function loadVisible(t: Tx, matchId: string, userId: string) {
  const rec = await t.matches.get(matchId);
  if (!rec) throw notFound("Match");
  assertMayWatch(rec, userId, (await operatorSettings(t)).spectators);
  return rec;
}

/** Messages after `after` (id) for this viewer, oldest first, at most the newest 50. */
export function chatSince(userId: string, matchId: string, after: number) {
  return tx(async (t) => {
    const rec = await loadVisible(t, matchId, userId);
    const rows = await t.chat.list(matchId, Math.max(0, Math.trunc(after) || 0), 50);
    return {
      messages: rows.filter((m) => !m.removedAt && !hiddenFrom(rec, userId, m)).map((m) => view(rec, userId, m)),
      cursor: rows.length ? rows[rows.length - 1].id : Math.max(0, Math.trunc(after) || 0),
    };
  });
}

export async function sendChat(userId: string, matchId: string, body: { kind?: unknown; text?: unknown; preset?: unknown; emoji?: unknown }) {
  const kind = body.kind === "preset" || body.kind === "emoji" ? body.kind : "text";
  let text: string;
  if (kind === "preset") {
    text = typeof body.preset === "string" ? (PRESETS[body.preset] ?? "") : "";
  } else if (kind === "emoji") {
    text = typeof body.emoji === "string" && REACTIONS.includes(body.emoji) ? body.emoji : "";
  } else {
    text = cleanText(body.text);
  }
  if (!text) throw new ApiError(400, "INVALID_INPUT", kind === "text" ? "Type a message first" : "Unknown phrase or reaction");

  const msg = await tx(async (t) => {
    const rec = await loadVisible(t, matchId, userId);
    const user = await t.users.get(userId);
    assertActive(user);
    const rights = chatRights(rec, userId);
    if (!(kind === "emoji" ? rights.react : rights.send)) {
      throw new ApiError(
        403,
        "NOT_PARTICIPANT",
        rec.seats.includes(userId) ? "Chat is not available in this match" : "The host turned this off for spectators",
      );
    }
    const seat = rec.seats.indexOf(userId);
    const m = await t.chat.add({
      matchId,
      userId,
      name: seat >= 0 ? rec.names[seat] : (user?.name ?? "Spectator"),
      role: seat >= 0 ? "player" : "spectator",
      kind,
      body: text,
    });
    t.afterCommit(() => publish(matchId, "chat", { id: m.id }));
    return view(rec, userId, m);
  });
  return msg;
}

/** Report a message to support (creates a report the admins see with the match). */
export function reportChat(userId: string, matchId: string, messageId: number) {
  return tx(async (t) => {
    const rec = await loadVisible(t, matchId, userId);
    const m = await t.chat.get(messageId);
    if (!m || m.matchId !== matchId || m.removedAt || hiddenFrom(rec, userId, m)) throw notFound("Message");
    if (m.userId === userId) throw new ApiError(409, "WRONG_PHASE", "You can't report your own message");
    const recent = (await t.disputes.listByUser(userId)).filter((d) => Date.now() - Date.parse(d.createdAt) < 60 * 60 * 1000);
    if (recent.length >= 10) throw new ApiError(429, "RATE_LIMITED", "You have sent several reports recently. Please wait before sending another.");
    const id = `RPT-${randomBytes(4).toString("hex").toUpperCase()}`;
    await t.disputes.put({
      id,
      userId,
      matchId,
      category: "OTHER",
      reason: `Chat message #${m.id} by ${m.name} (${m.role}): “${m.body}”`,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    });
    return { referenceId: id };
  });
}

/** Host: remove the spectator who wrote this message from the match. */
export function removeSpectatorByMessage(userId: string, matchId: string, messageId: number) {
  return tx(async (t) => {
    const m = await t.chat.get(messageId);
    if (!m || m.matchId !== matchId || m.role !== "spectator") throw notFound("Message");
    await removeSpectatorIn(t, userId, matchId, m.userId);
    return { removed: true };
  });
}

/** Admin: messages of a match, including removed ones. */
export async function chatForAdmin(t: Tx, matchId: string) {
  return (await t.chat.list(matchId, 0, 500)).map((m) => ({ ...m }));
}
