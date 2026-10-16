import { randomBytes, randomUUID } from "node:crypto";
import type { Tx } from "../store";
import { tx, type AdminChallenge, type AdminRole, type AuditEntry, type User } from "../store";
import { ApiError } from "../errors";
import { verifySignature } from "../siwe";

/**
 * Admin access is tied to wallets:
 *  - a role (owner / operator / finance / viewer) lives in admin_roles;
 *  - the very first Owner comes from ADMIN_BOOTSTRAP_WALLETS, only for wallets that never held a role;
 *  - opening the admin area needs a fresh wallet signature and creates a separate, short admin session;
 *  - risky actions need another signature over a message that names the action (step-up).
 * Every check happens on the server; this module has no framework imports so it is testable.
 */
export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_MAX_MS = 8 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
const TOUCH_MS = 60 * 1000;

export const ROLES: AdminRole[] = ["owner", "operator", "finance", "viewer"];

export type Permission =
  | "dashboard.view"
  | "users.view"
  | "users.moderate"
  | "matches.view"
  | "matches.manage"
  | "disputes.view"
  | "disputes.manage"
  | "finance.view"
  | "finance.adjust"
  | "settings.manage"
  | "admins.manage"
  | "audit.view.all";

const READ: Permission[] = ["dashboard.view", "users.view", "matches.view", "disputes.view"];
export const PERMISSIONS: Record<AdminRole, Permission[]> = {
  owner: [
    ...READ,
    "users.moderate",
    "matches.manage",
    "disputes.manage",
    "finance.view",
    "finance.adjust",
    "settings.manage",
    "admins.manage",
    "audit.view.all",
  ],
  operator: [...READ, "users.moderate", "matches.manage", "disputes.manage"],
  finance: [...READ, "finance.view", "finance.adjust"],
  viewer: [...READ],
};
export const can = (role: AdminRole, p: Permission) => PERMISSIONS[role].includes(p);

/** Actions that need a signature naming them (step-up). */
export const STEP_UP_ACTIONS = [
  "USER_SUSPEND",
  "USER_UNSUSPEND",
  "MATCH_VOID",
  "ADJUST_REQUEST",
  "ADJUST_APPROVE",
  "ADJUST_REJECT",
  "ROLE_GRANT",
  "ROLE_REVOKE",
  "SETTINGS_UPDATE",
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export function bootstrapWallets(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.ADMIN_BOOTSTRAP_WALLETS ?? "")
      .split(/[,\s]+/)
      .map((a) => a.trim().toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a)),
  );
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface AdminContext extends RequestMeta {
  userId: string;
  role: AdminRole;
  wallet: string;
  name: string;
  token: string;
  sessionCreatedAt: number;
}

export async function writeAudit(t: Tx, ctx: Partial<AdminContext> | null, e: Omit<AuditEntry, "at" | "details"> & { details?: Record<string, unknown> }) {
  await t.admin.audit({
    at: new Date().toISOString(),
    actorId: ctx?.userId,
    actorRole: ctx?.role,
    ip: ctx?.ip,
    userAgent: ctx?.userAgent?.slice(0, 200),
    ...e,
    details: e.details ?? {},
  });
}

// ---- Challenges ---------------------------------------------------------------------------------

export interface ChallengeDetails {
  action: "ADMIN_SIGN_IN" | StepUpAction;
  target?: string;
  reason?: string;
}

function challengeMessage(user: User, nonce: string, d: ChallengeDetails, issued: Date, expires: Date) {
  return [
    "Backgammon admin",
    `Action: ${d.action}`,
    ...(d.target ? [`Target: ${d.target}`] : []),
    ...(d.reason ? [`Reason: ${d.reason}`] : []),
    `Admin wallet: ${user.walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued: ${issued.toISOString()}`,
    `Expires: ${expires.toISOString()}`,
    "",
    "Signing is free and does not send a transaction.",
  ].join("\n");
}

export function cleanReason(v: unknown, required = true): string {
  const r =
    typeof v === "string"
      ? v
          .replace(/[\u0000-\u001f]/g, " ")
          .trim()
          .slice(0, 300)
      : "";
  if (required && r.length < 3) throw new ApiError(400, "INVALID_INPUT", "Please give a reason (at least 3 characters)");
  return r;
}

/** A message for the admin's wallet to sign. Sign-in needs only a wallet account; actions need an admin session. */
export async function createChallenge(user: User, d: ChallengeDetails): Promise<{ nonce: string; message: string; expiresAt: string }> {
  if (!user.walletAddress) throw new ApiError(401, "UNAUTHENTICATED", "Sign in with your wallet first");
  if (d.action !== "ADMIN_SIGN_IN" && !(STEP_UP_ACTIONS as readonly string[]).includes(d.action)) {
    throw new ApiError(400, "INVALID_INPUT", "Unknown admin action");
  }
  const nonce = randomBytes(12).toString("hex");
  const issued = new Date();
  const expires = new Date(issued.getTime() + CHALLENGE_MS);
  const details = { action: d.action, target: d.target ?? "", reason: d.reason ?? "" };
  const message = challengeMessage(user, nonce, d, issued, expires);
  await tx((t) => t.admin.putChallenge({ nonce, userId: user.id, purpose: d.action, message, details, expiresAt: expires.getTime() } satisfies AdminChallenge));
  return { nonce, message, expiresAt: expires.toISOString() };
}

/** Consume a challenge (single use) and check the wallet's signature over it. */
async function consume(user: User, body: { nonce?: unknown; signature?: unknown }, expect: ChallengeDetails): Promise<string> {
  if (typeof body.nonce !== "string" || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    throw new ApiError(401, "UNAUTHENTICATED", "A wallet signature is required for this action");
  }
  const c = await tx((t) => t.admin.takeChallenge(body.nonce as string, user.id, Date.now()));
  if (!c) throw new ApiError(401, "UNAUTHENTICATED", "This signature request expired or was already used. Please try again.");
  const d = c.details as { action?: string; target?: string; reason?: string };
  if (d.action !== expect.action || (d.target ?? "") !== (expect.target ?? "") || (d.reason ?? "") !== (expect.reason ?? "")) {
    throw new ApiError(401, "UNAUTHENTICATED", "The signed message does not match this action");
  }
  const ok = await verifySignature(user.walletAddress as `0x${string}`, c.message, body.signature as `0x${string}`, user.chainId ?? 1);
  if (!ok) throw new ApiError(401, "UNAUTHENTICATED", "Signature does not match your wallet");
  return body.signature;
}

// ---- Sessions -----------------------------------------------------------------------------------

/**
 * Open an admin session for the signed-in wallet user. Unknown wallets get NOT_FOUND so the admin area
 * does not reveal itself; the attempt is still audited.
 */
export async function adminSignIn(user: User, body: { nonce?: unknown; signature?: unknown }, meta: RequestMeta) {
  if (!user.walletAddress) throw new ApiError(401, "UNAUTHENTICATED", "Sign in with your wallet first");
  const signature = await consume(user, body, { action: "ADMIN_SIGN_IN" });
  const result = await tx(async (t) => {
    let role = await t.admin.activeRole(user.id);
    if (!role && !(await t.admin.everHadRole(user.id)) && bootstrapWallets().has(user.walletAddress!.toLowerCase())) {
      await t.admin.grantRole(user.id, "owner", null);
      await writeAudit(
        t,
        { userId: user.id, role: "owner", ...meta },
        {
          action: "ADMIN_BOOTSTRAP_OWNER",
          targetType: "user",
          targetId: user.id,
          details: { wallet: user.walletAddress },
        },
      );
      role = await t.admin.activeRole(user.id);
    }
    if (!role) return null;
    const token = randomUUID();
    const now = Date.now();
    await t.admin.putSession({ token, userId: user.id, createdAt: now, lastSeenAt: now, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 200) });
    await writeAudit(t, { userId: user.id, role: role.role, ...meta }, { action: "ADMIN_SIGN_IN", signature });
    return { token, role: role.role, expiresAt: new Date(now + ADMIN_MAX_MS).toISOString() };
  });
  if (!result) {
    // Recorded in its own transaction: a throw inside the one above would roll the record back.
    await tx((t) => writeAudit(t, { userId: user.id, ...meta }, { action: "ADMIN_SIGN_IN_DENIED", details: { wallet: user.walletAddress } }));
    throw new ApiError(404, "NOT_FOUND", "Page not found");
  }
  return result;
}

/**
 * Resolve the admin session. No cookie → NOT_FOUND (the area stays invisible); an expired or
 * mismatched session → UNAUTHENTICATED so a real admin knows to unlock again.
 */
export async function resolveAdmin(token: string | undefined, mainUserId: string, perm: Permission | null, meta: RequestMeta): Promise<AdminContext> {
  if (!token) throw new ApiError(404, "NOT_FOUND", "Page not found");
  const r = await tx(async (t): Promise<AdminContext | ApiError> => {
    const s = await t.admin.getSession(token);
    const now = Date.now();
    if (!s || s.userId !== mainUserId) return new ApiError(401, "UNAUTHENTICATED", "Admin session ended. Unlock the admin area again.");
    if (now - s.createdAt > ADMIN_MAX_MS || now - s.lastSeenAt > ADMIN_IDLE_MS) {
      await t.admin.deleteSession(token);
      return new ApiError(401, "UNAUTHENTICATED", "Admin session expired. Unlock the admin area again.");
    }
    const role = await t.admin.activeRole(s.userId);
    const user = await t.users.get(s.userId);
    if (!role || !user?.walletAddress) {
      await t.admin.deleteSession(token);
      return new ApiError(404, "NOT_FOUND", "Page not found");
    }
    if (perm && !can(role.role, perm)) return new ApiError(403, "FORBIDDEN", "Your admin role cannot do this");
    if (now - s.lastSeenAt > TOUCH_MS) await t.admin.touchSession(token, now);
    return { userId: s.userId, role: role.role, wallet: user.walletAddress, name: user.name, token, sessionCreatedAt: s.createdAt, ...meta };
  });
  // Returned rather than thrown inside the transaction, so the session cleanup above is kept.
  if (r instanceof ApiError) throw r;
  return r;
}

export async function adminSignOut(ctx: AdminContext) {
  await tx(async (t) => {
    await t.admin.deleteSession(ctx.token);
    await writeAudit(t, ctx, { action: "ADMIN_SIGN_OUT" });
  });
}

/** Check the step-up signature for a risky action. Returns the signature for the audit record. */
export async function stepUp(
  ctx: AdminContext,
  body: { nonce?: unknown; signature?: unknown },
  expect: { action: StepUpAction; target: string; reason?: string },
) {
  const user = await tx((t) => t.users.get(ctx.userId));
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Admin session ended");
  return consume(user, body, expect);
}
