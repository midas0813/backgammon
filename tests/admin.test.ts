import { afterEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { adminSignIn, createChallenge, resolveAdmin, type AdminContext, type ChallengeDetails } from "@/lib/server/admin/auth";
import * as admin from "@/lib/server/admin/service";
import { createDispute } from "@/lib/server/disputes";
import { reconcile, userBalances } from "@/lib/server/ledger";
import { createTable } from "@/lib/server/lobby";
import { createMatch, getSnapshot, joinMatch, setEnvForTests } from "@/lib/server/matches";
import { tx } from "@/lib/server/store";
import { ensureUser, profileOf } from "@/lib/server/users";
import { randomEnv } from "./helpers";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

/** A wallet account (as after Sign-In with Ethereum) with a real key for signing. */
async function walletUser() {
  const key = privateKeyToAccount(generatePrivateKey());
  const u = await ensureUser(undefined);
  u.walletAddress = key.address;
  u.chainId = 1;
  u.registeredAt = new Date().toISOString();
  await tx((t) => t.users.put(u));
  const sign = async (d: ChallengeDetails) => {
    const c = await createChallenge(u, d);
    return { nonce: c.nonce, signature: await key.signMessage({ message: c.message }) };
  };
  return { user: u, key, sign };
}

async function unlock(w: Awaited<ReturnType<typeof walletUser>>): Promise<AdminContext> {
  const { token } = await adminSignIn(w.user, await w.sign({ action: "ADMIN_SIGN_IN" }), {});
  return resolveAdmin(token, w.user.id, null, {});
}

afterEach(() => {
  delete process.env.ADMIN_BOOTSTRAP_WALLETS;
});

describe("admin sign-in", () => {
  it("bootstraps the first Owner from the env list and hides the area from everyone else", async () => {
    const owner = await walletUser();
    const stranger = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address.toLowerCase();

    const ctx = await unlock(owner);
    expect(ctx.role).toBe("owner");
    expect(await codeOf(adminSignIn(stranger.user, await stranger.sign({ action: "ADMIN_SIGN_IN" }), {}))).toBe("NOT_FOUND");
    expect(await codeOf(resolveAdmin(undefined, stranger.user.id, null, {}))).toBe("NOT_FOUND");
    // An admin cookie only works with the same wallet's game session.
    expect(await codeOf(resolveAdmin(ctx.token, stranger.user.id, null, {}))).toBe("UNAUTHENTICATED");

    const audit = await admin.listAuditAdmin(ctx, {});
    expect(audit.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["ADMIN_BOOTSTRAP_OWNER", "ADMIN_SIGN_IN", "ADMIN_SIGN_IN_DENIED"]));
  });

  it("does not re-bootstrap a wallet whose role was revoked", async () => {
    const a = await walletUser();
    const b = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = `${a.key.address},${b.key.address}`;
    const ctxA = await unlock(a);
    await unlock(b);
    const reason = "No longer on the team";
    await admin.revokeRole(ctxA, b.user.id, { reason, ...(await a.sign({ action: "ROLE_REVOKE", target: `user:${b.user.id}`, reason })) });
    expect(await codeOf(adminSignIn(b.user, await b.sign({ action: "ADMIN_SIGN_IN" }), {}))).toBe("NOT_FOUND");
  });

  it("rejects reused, mismatched or foreign signatures", async () => {
    const owner = await walletUser();
    const other = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const proof = await owner.sign({ action: "ADMIN_SIGN_IN" });
    await adminSignIn(owner.user, proof, {});
    expect(await codeOf(adminSignIn(owner.user, proof, {}))).toBe("UNAUTHENTICATED"); // single use

    const c = await createChallenge(owner.user, { action: "ADMIN_SIGN_IN" });
    const forged = await other.key.signMessage({ message: c.message });
    expect(await codeOf(adminSignIn(owner.user, { nonce: c.nonce, signature: forged }, {}))).toBe("UNAUTHENTICATED");

    const ctx = await unlock(owner);
    const victim = await ensureUser(undefined);
    const signedFor = await owner.sign({ action: "USER_SUSPEND", target: `user:${victim.id}`, reason: "Spamming tables" });
    // Same signature, different reason → refused.
    expect(await codeOf(admin.suspendUser(ctx, victim.id, { reason: "Something else", ...signedFor }))).toBe("UNAUTHENTICATED");
  });
});

describe("admin roles", () => {
  it("limits each role to its permissions", async () => {
    const owner = await walletUser();
    const viewer = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const reason = "Read-only helper";
    await admin.grantRole(ctx, {
      wallet: viewer.key.address,
      role: "viewer",
      reason,
      ...(await owner.sign({ action: "ROLE_GRANT", target: `user:${viewer.user.id}:viewer`, reason })),
    });
    const vctx = await unlock(viewer);
    expect(vctx.role).toBe("viewer");
    expect(await codeOf(resolveAdmin(vctx.token, viewer.user.id, "users.moderate", {}))).toBe("FORBIDDEN");
    expect(await codeOf(resolveAdmin(vctx.token, viewer.user.id, "finance.view", {}))).toBe("FORBIDDEN");
    await resolveAdmin(vctx.token, viewer.user.id, "matches.view", {});
    // Viewers see only their own audit entries.
    expect((await admin.listAuditAdmin(vctx, {})).scope).toBe("own");
    // An owner sees everyone, or one person when filtering, and a bad filter is a clear error.
    expect((await admin.listAuditAdmin(ctx, {})).scope).toBe("all");
    expect(await admin.listAuditAdmin(ctx, { actorId: owner.user.id })).toMatchObject({ scope: "person", actor: { id: owner.user.id } });
    expect(await codeOf(admin.listAuditAdmin(ctx, { actorId: "nope" }))).toBe("INVALID_INPUT");
  });

  it("always keeps one Owner", async () => {
    const owner = await walletUser();
    const other = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = `${owner.key.address},${other.key.address}`;
    const ctx = await unlock(owner);
    const octx = await unlock(other);
    const reason = "Leaving";
    await admin.revokeRole(octx, owner.user.id, { reason, ...(await other.sign({ action: "ROLE_REVOKE", target: `user:${owner.user.id}`, reason })) });
    // Revoking a role also ends that person's admin sessions.
    expect(await codeOf(resolveAdmin(ctx.token, owner.user.id, null, {}))).toBe("UNAUTHENTICATED");
    const third = await walletUser();
    expect(
      await codeOf(
        admin.revokeRole(octx, third.user.id, { reason, ...(await other.sign({ action: "ROLE_REVOKE", target: `user:${third.user.id}`, reason })) }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("moderation", () => {
  it("suspends: ends sessions, blocks new matches and wallet sign-in; unsuspend restores", async () => {
    const owner = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const p = await ensureUser(undefined);
    await tx((t) => t.sessions.put("11111111-1111-4111-8111-111111111111", { userId: p.id, createdAt: new Date().toISOString() }));
    const reason = "Abusive names";
    const r = await admin.suspendUser(ctx, p.id, { reason, days: 7, ...(await owner.sign({ action: "USER_SUSPEND", target: `user:${p.id}`, reason })) });
    expect(r.suspendedUntil).toBeTruthy();
    expect(await tx((t) => t.sessions.get("11111111-1111-4111-8111-111111111111"))).toBeUndefined();
    expect(await codeOf(createMatch(p.id, "bot", 3))).toBe("INELIGIBLE");
    expect(await codeOf(admin.suspendUser(ctx, owner.user.id, { reason, ...(await owner.sign({ action: "USER_SUSPEND", target: `user:${owner.user.id}`, reason })) }))).toBe(
      "WRONG_PHASE",
    );

    const back = "Appeal accepted";
    await admin.unsuspendUser(ctx, p.id, { reason: back, ...(await owner.sign({ action: "USER_UNSUSPEND", target: `user:${p.id}`, reason: back })) });
    await createMatch(p.id, "bot", 3);
    const detail = await admin.userDetail(ctx, p.id);
    expect(detail.audit.map((e) => e.action)).toEqual(["USER_UNSUSPEND", "USER_SUSPEND"]);
    expect(detail.audit[1].signature).toMatch(/^0x/);
  });

  it("resets an offending name", async () => {
    const owner = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const p = await ensureUser(undefined);
    await tx(async (t) => {
      const u = (await t.users.get(p.id))!;
      u.name = "Rude Name";
      await t.users.put(u);
    });
    await admin.resetProfile(ctx, p.id, { reason: "Offensive", name: true });
    expect((await profileOf(p.id)).name).toMatch(/^Guest-/);
  });
});

describe("matches", () => {
  it("voids a match with a signed reason, keeps the record, and drops it from stats", async () => {
    setEnvForTests(randomEnv(21));
    const owner = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const a = await ensureUser(undefined);
    const b = await ensureUser(undefined);
    const { matchId } = await createTable(a.id, { targetPoints: 3 });
    await joinMatch(b.id, matchId);
    const reason = "Collusion confirmed";
    await admin.voidMatch(ctx, matchId, { reason, ...(await owner.sign({ action: "MATCH_VOID", target: `match:${matchId}`, reason })) });
    const snap = await getSnapshot(a.id, matchId);
    expect(snap.status).toBe("VOIDED");
    expect(snap.voided?.reason).toBe(reason);
    expect(snap.events.at(-1)?.type).toBe("MATCH_VOIDED");
    const d = await admin.matchDetail(ctx, matchId);
    expect(d.audit[0]).toMatchObject({ action: "MATCH_VOID", reason });
    expect(await codeOf(admin.voidMatch(ctx, matchId, { reason, ...(await owner.sign({ action: "MATCH_VOID", target: `match:${matchId}`, reason })) }))).toBe(
      "WRONG_PHASE",
    );
  });
});

describe("reports", () => {
  it("assigns, notes and requires a resolution to close", async () => {
    const owner = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const p = await ensureUser(undefined);
    const { referenceId } = await createDispute(p.id, { category: "GAME", reason: "Opponent left mid-game" });
    await admin.updateReport(ctx, referenceId, { assignToMe: true, status: "IN_REVIEW", note: "Checking the log" });
    expect(await codeOf(admin.updateReport(ctx, referenceId, { status: "RESOLVED" }))).toBe("INVALID_INPUT");
    await admin.updateReport(ctx, referenceId, { status: "RESOLVED", resolution: "Explained the timeout policy" });
    const d = await admin.reportDetail(ctx, referenceId);
    expect(d.report).toMatchObject({ status: "RESOLVED", assignedTo: owner.user.id });
    expect(d.notes.map((n) => n.note)).toEqual(["Checking the log"]);
  });
});

describe("settings", () => {
  it("maintenance blocks new matches; switching spectators off blocks watching", async () => {
    setEnvForTests(randomEnv(22));
    const owner = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const reason = "Database upgrade";
    const sign = () => owner.sign({ action: "SETTINGS_UPDATE", target: "settings", reason });
    await admin.updateSettings(ctx, { reason, patch: { maintenance: { enabled: true, message: "Back at 10:00" } }, ...(await sign()) });
    const p = await ensureUser(undefined);
    expect(await codeOf(createMatch(p.id, "bot", 3))).toBe("SERVICE_UNAVAILABLE");
    expect((await admin.activeAnnouncements()).maintenance).toBe("Back at 10:00");

    await admin.updateSettings(ctx, { reason, patch: { maintenance: { enabled: false }, spectators: false }, ...(await sign()) });
    const q = await ensureUser(undefined);
    const { matchId } = await createTable(p.id, { targetPoints: 3 });
    await joinMatch(q.id, matchId);
    expect(await codeOf(getSnapshot((await ensureUser(undefined)).id, matchId))).toBe("NOT_PARTICIPANT");
  });

  it("publishes announcements until ended or expired", async () => {
    const owner = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const { announcement } = await admin.createAnnouncement(ctx, { message: "Tournament Friday!", tone: "ok" });
    expect((await admin.activeAnnouncements()).announcements.map((a) => a.message)).toEqual(["Tournament Friday!"]);
    await admin.endAnnouncement(ctx, announcement.id);
    expect((await admin.activeAnnouncements()).announcements).toEqual([]);
  });
});

describe("finance adjustments", () => {
  it("needs a second admin to approve, then posts a balanced ledger transaction", async () => {
    const owner = await walletUser();
    const fin = await walletUser();
    process.env.ADMIN_BOOTSTRAP_WALLETS = owner.key.address;
    const ctx = await unlock(owner);
    const grantReason = "Finance team";
    await admin.grantRole(ctx, {
      wallet: fin.key.address,
      role: "finance",
      reason: grantReason,
      ...(await owner.sign({ action: "ROLE_GRANT", target: `user:${fin.user.id}:finance`, reason: grantReason })),
    });
    const fctx = await unlock(fin);
    const p = await ensureUser(undefined);
    const reason = "Refund for lost deposit";
    const { adjustment } = await admin.requestAdjustment(ctx, {
      userId: p.id,
      accountKind: "PAID_AVAILABLE",
      amount: 2500,
      reason,
      ...(await owner.sign({ action: "ADJUST_REQUEST", target: `user:${p.id}:PAID_AVAILABLE:2500`, reason })),
    });
    expect(
      await codeOf(admin.decideAdjustment(ctx, adjustment.id, { approve: true, ...(await owner.sign({ action: "ADJUST_APPROVE", target: `adjustment:${adjustment.id}` })) })),
    ).toBe("WRONG_PHASE");
    await admin.decideAdjustment(fctx, adjustment.id, { approve: true, ...(await fin.sign({ action: "ADJUST_APPROVE", target: `adjustment:${adjustment.id}` })) });
    expect((await tx((t) => userBalances(t, p.id))).available).toBe(2500);
    expect(await tx((t) => reconcile(t))).toEqual([]);
    const overview = await admin.financeOverview(fctx);
    expect(overview.adjustments[0]).toMatchObject({ status: "APPROVED", requestedByName: owner.user.name });
    expect(overview.systemAccounts.find((s) => s.account === "system:ADJUSTMENTS")?.balance).toBe(-2500);
  });
});
