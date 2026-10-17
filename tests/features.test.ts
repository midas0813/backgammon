import { describe, expect, it } from "vitest";
import { createDispute, listDisputes } from "@/lib/server/disputes";
import { createMatch, getSnapshot, joinMatch, matchHistory, setEnvForTests } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { ensureUser, profileOf, updatePreferences } from "@/lib/server/users";
import { randomEnv } from "./helpers";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe("player settings", () => {
  it("saves sound, high contrast and board orientation", async () => {
    const u = await ensureUser(undefined);
    expect(await profileOf(u.id)).toMatchObject({ sound: true, highContrast: false, orientation: "right" });
    await updatePreferences(u.id, { sound: false, highContrast: true, orientation: "left" });
    expect(await profileOf(u.id)).toMatchObject({ sound: false, highContrast: true, orientation: "left" });
    await updatePreferences(u.id, { orientation: "sideways" });
    expect((await profileOf(u.id)).orientation).toBe("left");
  });
});

describe("presence", () => {
  it("is shared through the store, so any server instance sees the opponent online", async () => {
    setEnvForTests(randomEnv(3));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const { matchId } = await createMatch(a.id, "private", 3);
    await joinMatch(b.id, matchId); // joining counts as being here
    expect((await getSnapshot(a.id, matchId)).seats[1].online).toBe(true);
    await getSnapshot(b.id, matchId); // Bob polls
    expect((await tx((t) => t.presence.get(matchId)))[1]).toBeGreaterThan(0);
    expect((await getSnapshot(a.id, matchId)).seats[1].online).toBe(true);
  });
});

describe("match history", () => {
  it("returns events after a cursor; outsiders only when watching is allowed", async () => {
    setEnvForTests(randomEnv(4));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const stranger = await ensureUser(undefined);
    const host = await ensureUser(undefined);
    const { matchId } = await createMatch(a.id, "bot", 3);
    const all = await matchHistory(a.id, matchId, 0);
    expect(all.events.length).toBeGreaterThan(0);
    expect((await matchHistory(a.id, matchId, all.eventCursor)).events).toEqual([]);
    expect((await matchHistory(stranger.id, matchId, 0)).events.length).toBeGreaterThan(0);
    const closed = await createMatch(host.id, "private", 3, { allowSpectators: false });
    await joinMatch(b.id, closed.matchId);
    expect(await codeOf(matchHistory(stranger.id, closed.matchId, 0))).toBe("NOT_PARTICIPANT");
  });
});

describe("problem reports (disputes)", () => {
  it("returns a reference, validates input, limits matches to the reporter's own, and rate-limits", async () => {
    setEnvForTests(randomEnv(5));
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const { matchId } = await createMatch(a.id, "bot", 3);
    const r = await createDispute(a.id, { category: "GAME", reason: "The dice looked wrong", matchId });
    expect(r.referenceId).toMatch(/^RPT-[0-9A-F]{8}$/);
    expect(r.status).toBe("OPEN");
    expect(await codeOf(createDispute(a.id, { reason: "no" }))).toBe("INVALID_INPUT");
    expect(await codeOf(createDispute(b.id, { category: "GAME", reason: "Not my match at all", matchId }))).toBe("NOT_PARTICIPANT");
    for (let i = 0; i < 4; i++) await createDispute(a.id, { reason: `Report number ${i}` });
    expect(await codeOf(createDispute(a.id, { reason: "One too many" }))).toBe("RATE_LIMITED");
    expect(await listDisputes(a.id)).toHaveLength(5);
    expect(await listDisputes(b.id)).toHaveLength(0);
  });
});
