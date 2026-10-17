import { randomBytes } from "node:crypto";
import { ApiError, notFound } from "../errors";
import { LedgerError, SYSTEM, post, reconcile, userAccount, userBalances, userTransactions } from "../ledger";
import { HOST_ONLINE_MS, cancelTableIn, voidMatchIn } from "../matches";
import { ONLINE_WINDOW_MS, pulse } from "../lobby";
import { chatForAdmin } from "../chat";
import { closeWeek, decidePrizeWeekIn } from "../leaderboard";
import { publish } from "../realtime";
import { invalidateSettings, mergeSettings, operatorSettings } from "../settings";
import { tx, type Adjustment, type AdminRole, type Announcement, type Dispute, type LobbyRow, type Tx, type User } from "../store";
import { avatarUrl, isSuspended, playerStats } from "../users";
import { ROLES, can, cleanReason, stepUp, writeAudit, type AdminContext, type Permission } from "./auth";

/**
 * Everything the admin area does. Each function takes the resolved AdminContext; routes resolve it
 * with the permission named here, and functions re-check anything finer-grained.
 */
function need(ctx: AdminContext, p: Permission) {
  if (!can(ctx.role, p)) throw new ApiError(403, "FORBIDDEN", "Your admin role cannot do this");
}

const utcDayStart = (now = Date.now()) => now - (now % 86_400_000);

function userSummary(u: User & { lastSeenAt?: string }, role?: AdminRole) {
  return {
    id: u.id,
    name: u.name,
    wallet: u.walletAddress ?? null,
    registered: !!u.walletAddress,
    status: isSuspended(u) ? "suspended" : "active",
    suspendedUntil: isSuspended(u) ? (u.suspendedUntil ?? null) : null,
    suspendedReason: isSuspended(u) ? (u.suspendedReason ?? null) : null,
    avatarUrl: avatarUrl(u),
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt ?? null,
    role: role ?? null,
  };
}

function matchSummary(r: LobbyRow) {
  return {
    id: r.id,
    mode: r.mode,
    status: r.status,
    targetPoints: r.targetPoints,
    names: r.names,
    seats: r.seats,
    score: r.score,
    cube: r.cube,
    gameNumber: r.gameNumber,
    createdAt: r.createdAt,
    updatedAt: new Date(r.updatedAt).toISOString(),
    allowSpectators: r.allowSpectators,
    spectators: r.spectators,
    hostOnline: r.hostSeenAt >= Date.now() - HOST_ONLINE_MS,
  };
}

// ---- Dashboard ----------------------------------------------------------------------------------

export function dashboard(ctx: AdminContext) {
  return tx(async (t) => {
    const now = Date.now();
    const day = utcDayStart(now);
    const settings = await operatorSettings(t, true);
    const counts = await pulse(t, now, settings.spectators);
    const games = (await t.counters.get(["games"])).games;
    const finance = can(ctx.role, "finance.view")
      ? {
          pendingDeposits: (await t.deposits.listAll({ status: "PENDING", limit: 500 })).length,
          reviewDeposits: (await t.deposits.listAll({ status: "REVIEW", limit: 500 })).length,
          pendingWithdrawals: (await t.withdrawals.listAll({ status: "PENDING", limit: 500 })).length,
          pendingAdjustments: (await t.admin.listAdjustments("PENDING")).length,
        }
      : null;
    return {
      users: {
        total: await t.users.count(),
        registered: await t.users.countRegistered(),
        newToday: await t.users.countCreatedSince(day),
        activeToday: await t.users.countSeenSince(day),
        online: await t.users.countSeenSince(now - ONLINE_WINDOW_MS),
      },
      matches: {
        live: counts.playing,
        openTables: counts.open,
        completedToday: await t.matches.countCompletedSince(day),
        gamesPlayed: games,
      },
      openReports: await t.disputes.countOpen(),
      errors: { lastDay: await t.errors.countSince(now - 24 * 60 * 60_000), recent: await t.errors.recent(8) },
      finance,
      daily: {
        newUsers: await t.users.dailyNew(14),
        completedMatches: await t.matches.dailyCompleted(14),
      },
      settings,
      you: { name: ctx.name, wallet: ctx.wallet, role: ctx.role },
    };
  });
}

// ---- Users --------------------------------------------------------------------------------------

export function searchUsers(ctx: AdminContext, query: string) {
  return tx(async (t) => {
    const roles = new Map((await t.admin.listRoles()).map((r) => [r.userId, r.role]));
    return { users: (await t.users.search(query.slice(0, 80), 50)).map((u) => userSummary(u, roles.get(u.id))) };
  });
}

export function userDetail(ctx: AdminContext, userId: string) {
  return tx(async (t) => {
    const [u] = (await t.users.search(userId, 1)).filter((x) => x.id === userId);
    if (!u) throw notFound("User");
    const role = await t.admin.activeRole(userId);
    const stats = await playerStats(t, userId);
    return {
      user: { ...userSummary(u, role?.role), bio: u.bio ?? "", country: u.country ?? "", chainId: u.chainId ?? null },
      stats: { ...stats, history: undefined },
      matches: (await t.matches.listAdmin({ userId, limit: 20 })).map(matchSummary),
      reports: (await t.disputes.listByUser(userId)).map((d) => ({ id: d.id, category: d.category, status: d.status, createdAt: d.createdAt })),
      balances: await userBalances(t, userId),
      transactions: can(ctx.role, "finance.view") ? await userTransactions(t, userId, 20) : null,
      audit: await t.admin.listAudit({ targetType: "user", targetId: userId, limit: 30 }),
    };
  });
}

async function targetUser(t: Tx, ctx: AdminContext, userId: string) {
  const u = await t.users.get(userId);
  if (!u) throw notFound("User");
  if (u.id === ctx.userId) throw new ApiError(409, "WRONG_PHASE", "You cannot do this to your own account");
  return u;
}

export async function suspendUser(ctx: AdminContext, userId: string, body: { reason?: unknown; days?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "users.moderate");
  const reason = cleanReason(body.reason);
  const days = body.days === null || body.days === undefined || body.days === "" ? null : Number(body.days);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650))
    throw new ApiError(400, "INVALID_INPUT", "Days must be 1–3650, or empty for no end date");
  const signature = await stepUp(ctx, body, { action: "USER_SUSPEND", target: `user:${userId}`, reason });
  return tx(async (t) => {
    const u = await targetUser(t, ctx, userId);
    if (await t.admin.activeRole(userId)) throw new ApiError(409, "WRONG_PHASE", "Remove this person's admin role before suspending them");
    u.status = "suspended";
    u.suspendedReason = reason;
    u.suspendedUntil = days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined;
    await t.users.put(u);
    const ended = await t.sessions.deleteForUser(userId);
    await writeAudit(t, ctx, { action: "USER_SUSPEND", targetType: "user", targetId: userId, reason, signature, details: { days, sessionsEnded: ended } });
    return { status: "suspended", suspendedUntil: u.suspendedUntil ?? null };
  });
}

export async function unsuspendUser(ctx: AdminContext, userId: string, body: { reason?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "users.moderate");
  const reason = cleanReason(body.reason);
  const signature = await stepUp(ctx, body, { action: "USER_UNSUSPEND", target: `user:${userId}`, reason });
  return tx(async (t) => {
    const u = await targetUser(t, ctx, userId);
    u.status = "active";
    delete u.suspendedUntil;
    delete u.suspendedReason;
    await t.users.put(u);
    await writeAudit(t, ctx, { action: "USER_UNSUSPEND", targetType: "user", targetId: userId, reason, signature });
    return { status: "active" };
  });
}

export function forceLogout(ctx: AdminContext, userId: string, body: { reason?: unknown }) {
  need(ctx, "users.moderate");
  const reason = cleanReason(body.reason);
  return tx(async (t) => {
    await targetUser(t, ctx, userId);
    const ended = await t.sessions.deleteForUser(userId);
    await t.admin.deleteSessionsForUser(userId);
    await writeAudit(t, ctx, { action: "USER_FORCE_LOGOUT", targetType: "user", targetId: userId, reason, details: { sessionsEnded: ended } });
    return { sessionsEnded: ended };
  });
}

/** Moderation: reset a name, photo or bio that breaks the rules. */
export function resetProfile(ctx: AdminContext, userId: string, body: { reason?: unknown; name?: unknown; avatar?: unknown; bio?: unknown }) {
  need(ctx, "users.moderate");
  const reason = cleanReason(body.reason);
  return tx(async (t) => {
    const u = await targetUser(t, ctx, userId);
    const before = { name: u.name, avatar: !!u.avatar, bio: u.bio ?? "" };
    if (body.name) u.name = u.walletAddress ? `Player ${u.walletAddress.slice(2, 6).toUpperCase()}` : `Guest-${u.id.slice(0, 4).toUpperCase()}`;
    if (body.avatar && u.avatar) {
      await t.avatars.delete(u.avatar);
      delete u.avatar;
    }
    if (body.bio) u.bio = "";
    await t.users.put(u);
    await writeAudit(t, ctx, {
      action: "USER_PROFILE_RESET",
      targetType: "user",
      targetId: userId,
      reason,
      details: { before, reset: { name: !!body.name, avatar: !!body.avatar, bio: !!body.bio } },
    });
    return { name: u.name };
  });
}

// ---- Matches ------------------------------------------------------------------------------------

const MATCH_STATUSES = ["WAITING", "ACTIVE", "COMPLETED", "CANCELLED", "VOIDED"];

export function listMatchesAdmin(_ctx: AdminContext, f: { status?: string; userId?: string }) {
  return tx(async (t) => ({
    matches: (
      await t.matches.listAdmin({
        status: f.status && MATCH_STATUSES.includes(f.status) ? f.status : undefined,
        userId: f.userId && /^[0-9a-f-]{36}$/.test(f.userId) ? f.userId : undefined,
        limit: 100,
      })
    ).map(matchSummary),
  }));
}

export function matchDetail(_ctx: AdminContext, matchId: string) {
  return tx(async (t) => {
    const m = await t.matches.get(matchId);
    if (!m) throw notFound("Match");
    const ids = m.seats.filter((s): s is string => !!s && s !== "bot");
    const users = await t.users.getMany([...new Set(ids)]);
    return {
      id: m.id,
      mode: m.mode,
      status: m.state.status,
      createdAt: m.createdAt,
      completedAt: m.completedAt ?? null,
      targetPoints: m.state.targetPoints,
      score: m.state.score,
      winner: m.state.winner,
      endReason: m.state.endReason,
      results: m.state.results,
      allowSpectators: m.allowSpectators !== false,
      voided: m.voided ?? null,
      players: m.seats.map((id, i) => ({
        seat: i,
        name: m.names[i],
        userId: id && id !== "bot" ? id : null,
        wallet: id && users[id] ? (users[id].walletAddress ?? null) : null,
        bot: id === "bot",
      })),
      game: m.state.game
        ? {
            board: m.state.game.board,
            phase: m.state.game.phase,
            turn: m.state.game.turn,
            dice: m.state.game.dice,
            cubeValue: m.state.game.cubeValue,
            gameNumber: m.state.game.gameNumber,
          }
        : null,
      events: await t.matches.events(matchId, {}),
      chat: await chatForAdmin(t, matchId),
      audit: await t.admin.listAudit({ targetType: "match", targetId: matchId, limit: 20 }),
    };
  });
}

export function cancelTableAdmin(ctx: AdminContext, matchId: string, body: { reason?: unknown }) {
  need(ctx, "matches.manage");
  const reason = cleanReason(body.reason);
  return tx(async (t) => {
    await cancelTableIn(t, matchId);
    await writeAudit(t, ctx, { action: "MATCH_CANCEL", targetType: "match", targetId: matchId, reason });
    return { status: "CANCELLED" };
  });
}

export async function voidMatch(ctx: AdminContext, matchId: string, body: { reason?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "matches.manage");
  const reason = cleanReason(body.reason);
  const signature = await stepUp(ctx, body, { action: "MATCH_VOID", target: `match:${matchId}`, reason });
  return tx(async (t) => {
    const r = await voidMatchIn(t, matchId, ctx.userId, reason);
    await writeAudit(t, ctx, { action: "MATCH_VOID", targetType: "match", targetId: matchId, reason, signature, details: r });
    return { status: "VOIDED" };
  });
}

/** Remove a chat message (it stays stored with who removed it, and is hidden from everyone). */
export function removeChatMessage(ctx: AdminContext, matchId: string, body: { messageId?: unknown; reason?: unknown }) {
  need(ctx, "matches.manage");
  const reason = cleanReason(body.reason);
  const id = Number(body.messageId);
  return tx(async (t) => {
    const m = await t.chat.get(id);
    if (!m || m.matchId !== matchId) throw notFound("Message");
    await t.chat.remove(id, ctx.userId);
    await writeAudit(t, ctx, {
      action: "CHAT_REMOVE",
      targetType: "match",
      targetId: matchId,
      reason,
      details: { messageId: id, author: m.name, body: m.body },
    });
    t.afterCommit(() => publish(matchId, "chat", { removed: id }));
    return { removed: id };
  });
}

// ---- Weekly prizes --------------------------------------------------------------------------------

export async function listPrizeWeeks(ctx: AdminContext) {
  need(ctx, "finance.view");
  await closeWeek();
  return tx(async (t) => ({ weeks: await t.prizes.list(20), settings: (await operatorSettings(t, true)).prizePool }));
}

/** Pay a week's prize winners (signed, audited) or skip the week. */
export async function decidePrizeWeek(ctx: AdminContext, week: string, body: { approve?: unknown; note?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "finance.adjust");
  const approve = body.approve === true;
  const action = approve ? "PRIZE_PAY" : "PRIZE_SKIP";
  const note = typeof body.note === "string" ? body.note.slice(0, 300) : undefined;
  const signature = await stepUp(ctx, body, { action, target: `prizes:${week}`, reason: note });
  return tx(async (t) => {
    let w;
    try {
      w = await decidePrizeWeekIn(t, week, approve, ctx.userId, note);
    } catch (e) {
      if (e instanceof LedgerError) throw new ApiError(422, e.code, e.message);
      throw e;
    }
    await writeAudit(t, ctx, { action, targetType: "prizes", targetId: week, reason: note, signature, details: { winners: w.winners } });
    return { week: w };
  });
}

// ---- Reports (disputes) ---------------------------------------------------------------------------

const DISPUTE_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"];

export function listReports(_ctx: AdminContext, status?: string) {
  return tx(async (t) => {
    const rows = await t.disputes.listAll({ status: status && DISPUTE_STATUSES.includes(status) ? status : undefined, limit: 100 });
    const users = await t.users.getMany([...new Set(rows.flatMap((d) => [d.userId, d.assignedTo].filter((x): x is string => !!x)))]);
    return {
      reports: rows.map((d) => ({
        ...d,
        userName: users[d.userId]?.name ?? "Unknown",
        assignedName: d.assignedTo ? (users[d.assignedTo]?.name ?? "Admin") : null,
      })),
    };
  });
}

export function reportDetail(_ctx: AdminContext, id: string) {
  return tx(async (t) => {
    const d = await t.disputes.get(id);
    if (!d) throw notFound("Report");
    const notes = await t.disputes.notes(id);
    const users = await t.users.getMany([...new Set([d.userId, ...notes.map((n) => n.authorId), ...(d.assignedTo ? [d.assignedTo] : [])])]);
    return {
      report: { ...d, userName: users[d.userId]?.name ?? "Unknown", assignedName: d.assignedTo ? (users[d.assignedTo]?.name ?? "Admin") : null },
      notes: notes.map((n) => ({ ...n, authorName: users[n.authorId]?.name ?? "Admin" })),
    };
  });
}

export function updateReport(ctx: AdminContext, id: string, body: { status?: unknown; assignToMe?: unknown; resolution?: unknown; note?: unknown }) {
  need(ctx, "disputes.manage");
  return tx(async (t) => {
    const d = await t.disputes.get(id);
    if (!d) throw notFound("Report");
    const before: Partial<Dispute> = { status: d.status, assignedTo: d.assignedTo, resolution: d.resolution };
    if (typeof body.status === "string") {
      if (!DISPUTE_STATUSES.includes(body.status)) throw new ApiError(400, "INVALID_INPUT", "Unknown status");
      d.status = body.status;
    }
    if (body.assignToMe === true) d.assignedTo = ctx.userId;
    if (typeof body.resolution === "string") d.resolution = body.resolution.trim().slice(0, 1000) || undefined;
    if ((d.status === "RESOLVED" || d.status === "REJECTED") && !d.resolution) {
      throw new ApiError(400, "INVALID_INPUT", "Write a short resolution before closing the report");
    }
    await t.disputes.update(d);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (note) await t.disputes.addNote({ disputeId: id, authorId: ctx.userId, note, createdAt: new Date().toISOString() });
    await writeAudit(t, ctx, {
      action: "REPORT_UPDATE",
      targetType: "report",
      targetId: id,
      details: { before, after: { status: d.status, assignedTo: d.assignedTo, resolution: d.resolution }, noteAdded: !!note },
    });
    return { report: d };
  });
}

// ---- Audit --------------------------------------------------------------------------------------

export async function listAuditAdmin(ctx: AdminContext, f: { actorId?: string; targetType?: string; targetId?: string }) {
  if (f.actorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(f.actorId)) {
    throw new ApiError(400, "INVALID_INPUT", "Invalid person filter");
  }
  return tx(async (t) => {
    // Without the "all" permission an admin sees only their own actions.
    const full = can(ctx.role, "audit.view.all");
    const actorId = full ? f.actorId || undefined : ctx.userId;
    const entries = await t.admin.listAudit({ actorId, targetType: f.targetType || undefined, targetId: f.targetId || undefined, limit: 200 });
    const users = await t.users.getMany([...new Set([...entries.map((e) => e.actorId), actorId].filter((x): x is string => !!x))]);
    return {
      entries: entries.map((e) => ({ ...e, actorName: e.actorId ? (users[e.actorId]?.name ?? "Unknown") : "System" })),
      // What the list shows: everyone's actions, one person's (a filter), or only the viewer's own (their role).
      scope: !full ? ("own" as const) : actorId ? ("person" as const) : ("all" as const),
      actor: actorId ? { id: actorId, name: users[actorId]?.name ?? "Unknown" } : null,
    };
  });
}

// ---- Settings & announcements -------------------------------------------------------------------

export async function updateSettings(ctx: AdminContext, body: { patch?: unknown; reason?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "settings.manage");
  const reason = cleanReason(body.reason);
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  const signature = await stepUp(ctx, body, { action: "SETTINGS_UPDATE", target: "settings", reason });
  return tx(async (t) => {
    const before = await operatorSettings(t, true);
    const next = mergeSettings({ ...before, ...patch });
    await t.admin.putSetting("maintenance", next.maintenance, ctx.userId);
    await t.admin.putSetting("spectators", next.spectators, ctx.userId);
    await t.admin.putSetting("prizePool", next.prizePool, ctx.userId);
    invalidateSettings();
    await writeAudit(t, ctx, { action: "SETTINGS_UPDATE", targetType: "settings", targetId: "operator", reason, signature, details: { before, after: next } });
    return { settings: next };
  });
}

export function listAnnouncementsAdmin(_ctx: AdminContext) {
  return tx(async (t) => ({ announcements: await t.admin.listAnnouncements() }));
}

export function createAnnouncement(ctx: AdminContext, body: { message?: unknown; tone?: unknown; hours?: unknown }) {
  need(ctx, "settings.manage");
  const message = typeof body.message === "string" ? body.message.replace(/[\u0000-\u001f]/g, " ").trim() : "";
  if (message.length < 3 || message.length > 280) throw new ApiError(400, "INVALID_INPUT", "Announcements are 3–280 characters");
  const tone = body.tone === "warn" || body.tone === "ok" ? body.tone : "info";
  const hours = Number(body.hours);
  const a: Announcement = {
    id: `ann_${randomBytes(5).toString("hex")}`,
    message,
    tone,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: ctx.userId,
    expiresAt: Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + Math.min(hours, 24 * 90) * 3_600_000).toISOString() : undefined,
  };
  return tx(async (t) => {
    await t.admin.putAnnouncement(a);
    await writeAudit(t, ctx, { action: "ANNOUNCEMENT_CREATE", targetType: "announcement", targetId: a.id, details: { message, tone, expiresAt: a.expiresAt } });
    return { announcement: a };
  });
}

export function endAnnouncement(ctx: AdminContext, id: string) {
  need(ctx, "settings.manage");
  return tx(async (t) => {
    const a = (await t.admin.listAnnouncements()).find((x) => x.id === id);
    if (!a) throw notFound("Announcement");
    a.active = false;
    await t.admin.putAnnouncement(a);
    await writeAudit(t, ctx, { action: "ANNOUNCEMENT_END", targetType: "announcement", targetId: id });
    return { announcement: a };
  });
}

/** Public: what players see on Home and in the lobby. */
export function activeAnnouncements() {
  return tx(async (t) => {
    const now = Date.now();
    const settings = await operatorSettings(t);
    return {
      announcements: (await t.admin.listAnnouncements())
        .filter((a) => a.active && (!a.expiresAt || Date.parse(a.expiresAt) > now))
        .slice(0, 3)
        .map((a) => ({ id: a.id, message: a.message, tone: a.tone })),
      maintenance: settings.maintenance.enabled ? settings.maintenance.message : null,
    };
  });
}

// ---- Admins -------------------------------------------------------------------------------------

export function listAdmins(ctx: AdminContext) {
  need(ctx, "admins.manage");
  return tx(async (t) => {
    const roles = await t.admin.listRoles();
    const users = await t.users.getMany([...new Set(roles.flatMap((r) => [r.userId, r.grantedBy].filter((x): x is string => !!x)))]);
    return {
      admins: roles.map((r) => ({
        userId: r.userId,
        name: users[r.userId]?.name ?? "Unknown",
        wallet: users[r.userId]?.walletAddress ?? null,
        role: r.role,
        grantedAt: r.grantedAt,
        grantedBy: r.grantedBy ? (users[r.grantedBy]?.name ?? "Unknown") : "Bootstrap",
      })),
    };
  });
}

export async function grantRole(ctx: AdminContext, body: { wallet?: unknown; role?: unknown; reason?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "admins.manage");
  const role = body.role as AdminRole;
  if (!ROLES.includes(role)) throw new ApiError(400, "INVALID_INPUT", "Unknown role");
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new ApiError(400, "INVALID_INPUT", "Enter a wallet address (0x…)");
  const reason = cleanReason(body.reason);
  const target = await tx((t) => t.users.byWallet(wallet));
  if (!target) throw new ApiError(404, "NOT_FOUND", "No account uses this wallet yet. They must sign in once first.");
  const signature = await stepUp(ctx, body, { action: "ROLE_GRANT", target: `user:${target.id}:${role}`, reason });
  return tx(async (t) => {
    await targetUser(t, ctx, target.id);
    if (isSuspended(target)) throw new ApiError(409, "WRONG_PHASE", "This account is suspended");
    const before = await t.admin.activeRole(target.id);
    await t.admin.grantRole(target.id, role, ctx.userId);
    await writeAudit(t, ctx, {
      action: "ROLE_GRANT",
      targetType: "user",
      targetId: target.id,
      reason,
      signature,
      details: { from: before?.role ?? null, to: role },
    });
    return { userId: target.id, role };
  });
}

export async function revokeRole(ctx: AdminContext, userId: string, body: { reason?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "admins.manage");
  const reason = cleanReason(body.reason);
  const signature = await stepUp(ctx, body, { action: "ROLE_REVOKE", target: `user:${userId}`, reason });
  return tx(async (t) => {
    await targetUser(t, ctx, userId);
    const before = await t.admin.activeRole(userId);
    if (!before) throw notFound("Admin role");
    if (before.role === "owner" && (await t.admin.listRoles()).filter((r) => r.role === "owner").length <= 1) {
      throw new ApiError(409, "WRONG_PHASE", "There must always be at least one Owner");
    }
    await t.admin.revokeRole(userId, ctx.userId);
    await t.admin.deleteSessionsForUser(userId);
    await writeAudit(t, ctx, { action: "ROLE_REVOKE", targetType: "user", targetId: userId, reason, signature, details: { from: before.role } });
    return { userId, role: null };
  });
}

// ---- Finance ------------------------------------------------------------------------------------

export function financeOverview(ctx: AdminContext) {
  need(ctx, "finance.view");
  return tx(async (t) => {
    const dump = await t.ledger.dump();
    const adjustments = await t.admin.listAdjustments();
    const users = await t.users.getMany([...new Set(adjustments.flatMap((a) => [a.userId, a.requestedBy, a.decidedBy].filter((x): x is string => !!x)))]);
    return {
      reconciliation: { mismatches: await reconcile(t), transactions: dump.transactions.length },
      systemAccounts: Object.entries(dump.balances)
        .filter(([a]) => a.startsWith("system:"))
        .map(([account, balance]) => ({ account, balance })),
      deposits: (await t.deposits.listAll({ limit: 50 })).map((d) => ({
        id: d.id,
        userId: d.userId,
        method: d.method,
        tokenUnits: d.tokenUnits,
        status: d.status,
        createdAt: d.createdAt,
      })),
      withdrawals: (await t.withdrawals.listAll({ limit: 50 })).map((w) => ({
        id: w.id,
        userId: w.userId,
        amountUnits: w.amountUnits,
        status: w.status,
        createdAt: w.createdAt,
      })),
      adjustments: adjustments.map((a) => ({
        ...a,
        userName: users[a.userId]?.name ?? "Unknown",
        requestedByName: users[a.requestedBy]?.name ?? "Unknown",
        decidedByName: a.decidedBy ? (users[a.decidedBy]?.name ?? "Unknown") : null,
      })),
    };
  });
}

const MAX_ADJUSTMENT = 1_000_000; // minor units = 10,000 tokens

export async function requestAdjustment(
  ctx: AdminContext,
  body: { userId?: unknown; accountKind?: unknown; amount?: unknown; reason?: unknown; nonce?: unknown; signature?: unknown },
) {
  need(ctx, "finance.adjust");
  const userId = typeof body.userId === "string" ? body.userId : "";
  const accountKind = body.accountKind === "FREE_CREDITS" ? "FREE_CREDITS" : "PAID_AVAILABLE";
  const amount = Number(body.amount);
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > MAX_ADJUSTMENT) {
    throw new ApiError(400, "INVALID_INPUT", "Amount must be a non-zero whole number of minor units, at most 1,000,000");
  }
  const reason = cleanReason(body.reason);
  const signature = await stepUp(ctx, body, { action: "ADJUST_REQUEST", target: `user:${userId}:${accountKind}:${amount}`, reason });
  return tx(async (t) => {
    if (!(await t.users.get(userId))) throw notFound("User");
    const a: Adjustment = {
      id: `adj_${randomBytes(6).toString("hex")}`,
      userId,
      accountKind,
      amount,
      reason,
      status: "PENDING",
      requestedBy: ctx.userId,
      requestedAt: new Date().toISOString(),
    };
    await t.admin.putAdjustment(a);
    await writeAudit(t, ctx, {
      action: "ADJUST_REQUEST",
      targetType: "adjustment",
      targetId: a.id,
      reason,
      signature,
      details: { userId, accountKind, amount },
    });
    return { adjustment: a };
  });
}

/** A second admin approves (posting a balanced ledger transaction) or rejects. */
export async function decideAdjustment(ctx: AdminContext, id: string, body: { approve?: unknown; nonce?: unknown; signature?: unknown }) {
  need(ctx, "finance.adjust");
  const approve = body.approve === true;
  const action = approve ? "ADJUST_APPROVE" : "ADJUST_REJECT";
  const signature = await stepUp(ctx, body, { action, target: `adjustment:${id}` });
  return tx(async (t) => {
    const a = await t.admin.getAdjustment(id, { lock: true });
    if (!a) throw notFound("Adjustment");
    if (a.status !== "PENDING") throw new ApiError(409, "WRONG_PHASE", "Already decided");
    if (a.requestedBy === ctx.userId) throw new ApiError(409, "WRONG_PHASE", "A different admin must approve or reject this adjustment");
    a.status = approve ? "APPROVED" : "REJECTED";
    a.decidedBy = ctx.userId;
    a.decidedAt = new Date().toISOString();
    if (approve) {
      a.txnKey = `adjustment:${a.id}`;
      const counter = a.accountKind === "FREE_CREDITS" ? SYSTEM.freeIssuance : SYSTEM.adjustments;
      try {
        await post(
          t,
          a.txnKey,
          "ADMIN_ADJUSTMENT",
          [
            { account: userAccount(a.userId, a.accountKind), amount: a.amount },
            { account: counter, amount: -a.amount },
          ],
          a.reason,
        );
      } catch (e) {
        if (e instanceof LedgerError) throw new ApiError(422, e.code, e.message);
        throw e;
      }
    }
    await t.admin.putAdjustment(a);
    await writeAudit(t, ctx, {
      action,
      targetType: "adjustment",
      targetId: id,
      signature,
      details: { userId: a.userId, amount: a.amount, accountKind: a.accountKind },
    });
    return { adjustment: a };
  });
}
