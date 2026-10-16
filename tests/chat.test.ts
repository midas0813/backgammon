import { describe, expect, it } from "vitest";
import { chatSince, cleanText, removeSpectatorByMessage, reportChat, sendChat } from "@/lib/server/chat";
import { createTable } from "@/lib/server/lobby";
import { createMatch, getSnapshot, joinMatch, setEnvForTests, setSpectatorSettings } from "@/lib/server/matches";
import { ensureUser } from "@/lib/server/users";
import { randomEnv } from "./helpers";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

async function match() {
  setEnvForTests(randomEnv(60));
  const host = await ensureUser(undefined);
  const guest = await ensureUser(undefined);
  const viewer = await ensureUser(undefined);
  const { matchId } = await createTable(host.id, { targetPoints: 3 });
  await joinMatch(guest.id, matchId);
  return { host, guest, viewer, matchId };
}

describe("match chat (C3)", () => {
  it("players and spectators exchange custom and preset messages and reactions", async () => {
    const { host, guest, viewer, matchId } = await match();
    await sendChat(host.id, matchId, { kind: "preset", preset: "gl" });
    await sendChat(guest.id, matchId, { kind: "text", text: "  you   too\u0007 " });
    await sendChat(viewer.id, matchId, { kind: "emoji", emoji: "🔥" });
    await sendChat(viewer.id, matchId, { kind: "text", text: "What a game" });
    const feed = await chatSince(host.id, matchId, 0);
    expect(feed.messages.map((m) => [m.role, m.kind, m.body])).toEqual([
      ["player", "preset", "Good luck!"],
      ["player", "text", "you too"],
      ["spectator", "emoji", "🔥"],
      ["spectator", "text", "What a game"],
    ]);
    expect(feed.messages[0].mine).toBe(true);
    expect(feed.messages[3].removable).toBe(true); // the host may remove spectators
    expect((await chatSince(guest.id, matchId, 0)).messages[3].removable).toBe(false);
    expect((await chatSince(viewer.id, matchId, feed.messages[1].id)).messages).toHaveLength(2);
    expect(await codeOf(sendChat(host.id, matchId, { kind: "emoji", emoji: "💩" }))).toBe("INVALID_INPUT");
    expect(await codeOf(sendChat(host.id, matchId, { kind: "text", text: "   " }))).toBe("INVALID_INPUT");
  });

  it("the host decides whether spectators may chat or react; players always can", async () => {
    const { host, guest, viewer, matchId } = await match();
    expect((await getSnapshot(viewer.id, matchId)).chat).toEqual({ send: true, react: true });
    await setSpectatorSettings(host.id, matchId, { chat: false });
    expect(await codeOf(sendChat(viewer.id, matchId, { kind: "text", text: "hi" }))).toBe("NOT_PARTICIPANT");
    await sendChat(viewer.id, matchId, { kind: "emoji", emoji: "👏" });
    await setSpectatorSettings(host.id, matchId, { emoji: false });
    expect(await codeOf(sendChat(viewer.id, matchId, { kind: "emoji", emoji: "👏" }))).toBe("NOT_PARTICIPANT");
    await sendChat(guest.id, matchId, { kind: "text", text: "still talking" });
    expect((await chatSince(viewer.id, matchId, 0)).messages.map((m) => m.body)).toEqual(["👏", "still talking"]); // spectators still read
    expect((await getSnapshot(host.id, matchId)).spectatorSettings).toEqual({ allow: true, chat: false, emoji: false });
  });

  it("the host can remove a spectator; anyone can report a message", async () => {
    const { host, guest, viewer, matchId } = await match();
    const m = await sendChat(viewer.id, matchId, { kind: "text", text: "spam spam" });
    expect(await codeOf(removeSpectatorByMessage(guest.id, matchId, m.id))).toBe("NOT_PARTICIPANT");
    expect((await reportChat(guest.id, matchId, m.id)).referenceId).toMatch(/^RPT-/);
    await removeSpectatorByMessage(host.id, matchId, m.id);
    expect(await codeOf(getSnapshot(viewer.id, matchId))).toBe("NOT_PARTICIPANT");
    expect(await codeOf(sendChat(viewer.id, matchId, { kind: "text", text: "back" }))).toBe("NOT_PARTICIPANT");
  });

  it("no chat in computer games; masks a few slurs", async () => {
    const u = await ensureUser(undefined);
    const { matchId } = await createMatch(u.id, "bot", 1);
    expect(await codeOf(sendChat(u.id, matchId, { kind: "text", text: "hello" }))).toBe("NOT_PARTICIPANT");
    expect(cleanText("oh SHIT that was close")).toBe("oh S*** that was close");
    expect(cleanText("x".repeat(300))).toHaveLength(200);
  });
});
