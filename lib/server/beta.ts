import { ApiError } from "./errors";
import { operatorSettings } from "./settings";
import { tx, type InviteCode, type Tx } from "./store";

/**
 * Beta tools: invite codes per community (where players come from; optionally required to create an
 * account) and in-app feedback. Guests can always play free games.
 */
export const normalizeCode = (v: unknown) =>
  typeof v === "string"
    ? v
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, "")
        .slice(0, 24)
    : "";

const usable = (c: InviteCode | undefined, now: number) =>
  !!c && c.active && (!c.expiresAt || Date.parse(c.expiresAt) > now) && (c.maxUses === null || c.uses < c.maxUses);

/**
 * For a new wallet account: record (and count) its invite code. When the beta is invite-only, a valid
 * code is required. Returns the code to store on the account, if any.
 */
export async function claimInviteCode(t: Tx, raw: unknown, now = Date.now()) {
  const code = normalizeCode(raw);
  const settings = await operatorSettings(t);
  const c = code ? await t.beta.getCode(code, { lock: true }) : undefined;
  if (!usable(c, now)) {
    if (settings.inviteOnly)
      throw new ApiError(403, "INELIGIBLE", code ? "That invite code is not valid any more." : "The beta is invite-only: open your invite link first.");
    return undefined;
  }
  await t.beta.putCode({ ...c!, uses: c!.uses + 1 });
  return c!.code;
}

/** Public: is this code usable (for the sign-up page)? */
export function checkCode(raw: unknown) {
  return tx(async (t) => {
    const c = await t.beta.getCode(normalizeCode(raw));
    return { valid: usable(c, Date.now()), label: usable(c, Date.now()) ? c!.label : null, inviteOnly: (await operatorSettings(t)).inviteOnly };
  });
}

export async function submitFeedback(userId: string, body: { kind?: unknown; message?: unknown; path?: unknown }, userAgent?: string) {
  const kind = body.kind === "idea" || body.kind === "bug" ? body.kind : "other";
  const message = typeof body.message === "string" ? body.message.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim() : "";
  if (message.length < 3 || message.length > 2000) throw new ApiError(400, "INVALID_INPUT", "Please write a few words (up to 2000 characters)");
  const path = typeof body.path === "string" ? body.path.slice(0, 200) : undefined;
  return tx(async (t) => ({ id: await t.beta.addFeedback({ userId, kind, message, path, userAgent: userAgent?.slice(0, 300) }) }));
}
