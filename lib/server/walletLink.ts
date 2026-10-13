import { randomBytes } from "node:crypto";
import { getAddress, isAddress, verifyMessage } from "viem";
import { read, transact } from "./db";
import { ApiError } from "./errors";

/**
 * "Connect Wallet": prove control of an EVM address by signing a one-time challenge
 * (EIP-4361 style). Signing costs no gas and moves no funds. Linking a wallet does not enable
 * on-chain deposits — stablecoin deposits still go through the (simulated) payment adapter.
 */
const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_WALLETS = 3;

export const SUPPORTED_CHAINS: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  11155111: "Sepolia (test)",
  84532: "Base Sepolia (test)",
};

export function createChallenge(sessionToken: string, addressInput: unknown, chainId: unknown, host: string) {
  if (typeof addressInput !== "string" || !isAddress(addressInput)) throw new ApiError(400, "INVALID_INPUT", "Invalid wallet address");
  const address = getAddress(addressInput);
  const chain = Number(chainId);
  const nonce = randomBytes(12).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = [
    `${host} wants you to link your wallet to your Backgammon account:`,
    address,
    "",
    "Signing proves you control this address. It costs no gas and does not move any funds.",
    "",
    `Chain ID: ${Number.isInteger(chain) ? chain : "unknown"}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
  transact((db) => {
    const s = db.sessions[sessionToken];
    if (!s) throw new ApiError(401, "UNAUTHENTICATED", "Session expired; reload the page");
    s.walletNonce = { nonce, message, expiresAt: Date.now() + NONCE_TTL_MS };
  });
  return { message };
}

export async function verifyAndLink(sessionToken: string, body: { address?: unknown; signature?: unknown; chainId?: unknown }) {
  if (typeof body.address !== "string" || !isAddress(body.address)) throw new ApiError(400, "INVALID_INPUT", "Invalid wallet address");
  if (typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    throw new ApiError(400, "INVALID_INPUT", "Invalid signature");
  }
  const address = getAddress(body.address);
  const challenge = read((db) => db.sessions[sessionToken]?.walletNonce);
  if (!challenge || challenge.expiresAt < Date.now() || !challenge.message.includes(address)) {
    throw new ApiError(400, "CHALLENGE_EXPIRED", "The signing request expired. Please try again.");
  }
  const ok = await verifyMessage({ address, message: challenge.message, signature: body.signature as `0x${string}` }).catch(() => false);
  if (!ok) throw new ApiError(401, "UNAUTHENTICATED", "Signature does not match this wallet");

  const chainId = Number(body.chainId) || 0;
  return transact((db) => {
    const session = db.sessions[sessionToken];
    if (!session?.walletNonce || session.walletNonce.nonce !== challenge.nonce) {
      throw new ApiError(400, "CHALLENGE_EXPIRED", "The signing request was already used");
    }
    delete session.walletNonce; // one-time use
    const owner = Object.values(db.users).find((u) => u.wallets?.some((w) => w.address === address));
    if (owner && owner.id !== session.userId) throw new ApiError(409, "WALLET_TAKEN", "This wallet is linked to another account");
    const user = db.users[session.userId];
    const wallets = (user.wallets ?? []).filter((w) => w.address !== address);
    if (wallets.length >= MAX_WALLETS) throw new ApiError(409, "INVALID_INPUT", `You can link up to ${MAX_WALLETS} wallets`);
    user.wallets = [{ address, chainId, verifiedAt: new Date().toISOString() }, ...wallets];
    return user.wallets;
  });
}

export function unlinkWallet(userId: string, addressInput: unknown) {
  if (typeof addressInput !== "string" || !isAddress(addressInput)) throw new ApiError(400, "INVALID_INPUT", "Invalid wallet address");
  const address = getAddress(addressInput);
  return transact((db) => {
    const user = db.users[userId];
    user.wallets = (user.wallets ?? []).filter((w) => w.address !== address);
    return user.wallets;
  });
}
