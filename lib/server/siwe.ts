import { randomUUID } from "node:crypto";
import { createPublicClient, getAddress, http, verifyMessage, type Chain } from "viem";
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon, sepolia } from "viem/chains";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { ApiError } from "./errors";
import { tx, type User } from "./store";
import { createGuest, profileIn } from "./users";

/**
 * Sign-In with Ethereum (EIP-4361). The wallet IS the account: the first successful sign-in with an
 * address creates the account; later sign-ins with the same address return to it.
 * Flow: GET nonce → wallet signs the SIWE message → POST message + signature → session bound to user.
 */
export const SIWE_CHAINS: Chain[] = [base, mainnet, optimism, arbitrum, polygon, baseSepolia, sepolia];
const NONCE_TTL_MS = 10 * 60 * 1000;

export async function createNonce(sessionToken: string): Promise<string> {
  return tx(async (t) => {
    const session = await t.sessions.get(sessionToken);
    if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Session expired; reload the page");
    session.siweNonce = generateSiweNonce();
    session.siweNonceExpiresAt = Date.now() + NONCE_TTL_MS;
    await t.sessions.put(sessionToken, session);
    return session.siweNonce;
  });
}

/** EOA signatures verify offline; smart-contract wallets (EIP-1271/6492) need an RPC read. */
async function verifySignature(address: `0x${string}`, message: string, signature: `0x${string}`, chainId: number) {
  if (await verifyMessage({ address, message, signature }).catch(() => false)) return true;
  const chain = SIWE_CHAINS.find((c) => c.id === chainId);
  if (!chain) return false;
  const client = createPublicClient({ chain, transport: http(undefined, { timeout: 8000 }) });
  return client.verifyMessage({ address, message, signature }).catch(() => false);
}

export interface VerifyContext {
  sessionToken: string;
  host: string; // expected SIWE domain
}

export async function verifySiwe(ctx: VerifyContext, body: { message?: unknown; signature?: unknown }) {
  if (typeof body.message !== "string" || body.message.length > 4000) throw new ApiError(400, "INVALID_INPUT", "Invalid sign-in message");
  if (typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    throw new ApiError(400, "INVALID_INPUT", "Invalid signature");
  }
  const fields = parseSiweMessage(body.message);
  if (!fields.address || !fields.nonce || !fields.chainId) throw new ApiError(400, "INVALID_INPUT", "Malformed sign-in message");
  if (!SIWE_CHAINS.some((c) => c.id === fields.chainId)) throw new ApiError(400, "UNSUPPORTED_CHAIN", "Switch to a supported network to sign in");

  const session = await tx((t) => t.sessions.get(ctx.sessionToken));
  if (!session?.siweNonce || (session.siweNonceExpiresAt ?? 0) < Date.now()) {
    throw new ApiError(400, "CHALLENGE_EXPIRED", "Sign-in request expired. Please try again.");
  }
  const valid = validateSiweMessage({ message: fields, domain: ctx.host, nonce: session.siweNonce });
  if (!valid) throw new ApiError(400, "INVALID_INPUT", "Sign-in message is for a different site or has expired");

  const address = getAddress(fields.address);
  const ok = await verifySignature(address, body.message, body.signature as `0x${string}`, fields.chainId);
  if (!ok) throw new ApiError(401, "UNAUTHENTICATED", "Signature does not match this wallet");

  return tx(async (t) => {
    const current = await t.sessions.get(ctx.sessionToken);
    if (!current || current.siweNonce !== session.siweNonce) throw new ApiError(400, "CHALLENGE_EXPIRED", "This sign-in request was already used");
    await t.sessions.delete(ctx.sessionToken); // rotate the session token on every sign-in

    let user: User | undefined = await t.users.byWallet(address);
    let isNew = false;
    if (!user) {
      isNew = true;
      const sessionUser = await t.users.get(current.userId);
      // A guest who signs in for the first time keeps their games and practice credits.
      user = sessionUser && !sessionUser.walletAddress ? sessionUser : await createGuest(t);
      user.walletAddress = address;
      user.registeredAt = new Date().toISOString();
      if (user.name.startsWith("Guest-")) user.name = `Player ${address.slice(2, 6).toUpperCase()}`;
    }
    user.chainId = fields.chainId;
    await t.users.put(user);
    const token = randomUUID();
    await t.sessions.put(token, { userId: user.id, createdAt: new Date().toISOString() });
    return { token, isNew, profile: await profileIn(t, user.id) };
  });
}
