import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { sniffImage } from "@/lib/server/avatars";
import { createMatch } from "@/lib/server/matches";
import { createNonce, verifySiwe } from "@/lib/server/siwe";
import { tx } from "@/lib/server/store";
import { logOut, profileOf, resolveSession } from "@/lib/server/users";
import { getWallet } from "@/lib/server/wallet";

const HOST = "localhost:3000";
const T1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const T2 = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const mallory = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

async function siweMessage(token: string, address: `0x${string}`, opts: { domain?: string; chainId?: number } = {}) {
  const nonce = await createNonce(token);
  return createSiweMessage({
    domain: opts.domain ?? HOST,
    address,
    statement: "Sign in to Backgammon.",
    uri: `http://${HOST}`,
    version: "1",
    chainId: opts.chainId ?? 8453,
    nonce,
  });
}

async function signIn(token: string, account = alice) {
  await resolveSession(token);
  const message = await siweMessage(token, account.address);
  const signature = await account.signMessage({ message });
  return verifySiwe({ sessionToken: token, host: HOST }, { message, signature });
}

describe("wallet accounts (Sign-In with Ethereum)", () => {
  it("first sign-in creates the account by upgrading the guest in place", async () => {
    const guest = (await resolveSession(T1)).user;
    const { matchId } = await createMatch(guest.id, "bot", 1);
    expect((await getWallet(guest.id)).balances.freeCredits).toBe(0); // guests get no credits
    const res = await signIn(T1);
    expect(res.isNew).toBe(true);
    expect(res.profile).toMatchObject({ registered: true, walletAddress: alice.address, chainId: 8453 });
    expect(res.token).not.toBe(T1); // session rotated
    const user = await tx((t) => t.users.byWallet(alice.address.toLowerCase()));
    expect(user?.id).toBe(guest.id); // guest games carried over; the welcome credits arrive with the account
    expect((await tx((t) => t.matches.get(matchId)))?.seats[0]).toBe(guest.id);
    expect((await getWallet(guest.id)).balances.freeCredits).toBeGreaterThan(0);
  });

  it("signing in again with the same wallet from another browser returns to the same account", async () => {
    const first = await signIn(T1);
    const second = await signIn(T2);
    expect(second.isNew).toBe(false);
    const a = await tx((t) => t.sessions.get(first.token));
    const b = await tx((t) => t.sessions.get(second.token));
    expect(a?.userId).toBe(b?.userId);
    expect(await tx((t) => t.users.count())).toBe(2); // the second browser's guest stays a separate guest
  });

  it("rejects a signature from a different key, a replayed nonce, the wrong domain and unsupported chains", async () => {
    await resolveSession(T1);
    let message = await siweMessage(T1, alice.address);
    const forged = await mallory.signMessage({ message });
    await expect(verifySiwe({ sessionToken: T1, host: HOST }, { message, signature: forged })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const good = await alice.signMessage({ message });
    const ok = await verifySiwe({ sessionToken: T1, host: HOST }, { message, signature: good });
    // Replaying the same signed message on the new session fails: nonces are single-use and session-bound.
    await expect(verifySiwe({ sessionToken: ok.token, host: HOST }, { message, signature: good })).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });

    await resolveSession(T2);
    message = await siweMessage(T2, alice.address, { domain: "evil.example" });
    await expect(verifySiwe({ sessionToken: T2, host: HOST }, { message, signature: await alice.signMessage({ message }) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    message = await siweMessage(T2, alice.address, { chainId: 56 });
    await expect(verifySiwe({ sessionToken: T2, host: HOST }, { message, signature: await alice.signMessage({ message }) })).rejects.toMatchObject({
      code: "UNSUPPORTED_CHAIN",
    });
  });

  it("sign-out ends the session; the next request is a fresh guest", async () => {
    const { token } = await signIn(T1);
    await logOut(token);
    expect(await tx((t) => t.sessions.get(token))).toBeUndefined();
    const next = await resolveSession(token);
    expect((await profileOf(next.user.id)).registered).toBe(false);
  });
});

describe("avatar upload validation", () => {
  it("identifies images by magic bytes, not by the declared type", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});
