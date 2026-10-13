import { beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { read, resetDb } from "@/lib/server/db";
import { sniffImage } from "@/lib/server/avatars";
import { logIn, logOut, profileOf, resolveSession, signUp } from "@/lib/server/users";
import { createChallenge, verifyAndLink } from "@/lib/server/walletLink";

const T1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const T2 = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe("accounts", () => {
  beforeEach(() => resetDb());

  it("sign-up upgrades the guest in place, keeping its id and practice credits", () => {
    const guest = resolveSession(T1).user;
    const { user, token } = signUp(T1, { email: "Ann@Example.com", password: "board1234", name: "Ann", acceptTerms: true });
    expect(user.id).toBe(guest.id);
    expect(token).toBe(T1);
    const p = profileOf(user.id);
    expect(p).toMatchObject({ registered: true, email: "ann@example.com", name: "Ann" });
    expect(JSON.stringify(p)).not.toContain("scrypt");
  });

  it("rejects weak passwords, bad emails, duplicates and missing consent", () => {
    resolveSession(T1);
    expect(codeOf(() => signUp(T1, { email: "x@y.io", password: "short1", name: "Ann", acceptTerms: true }))).toBe("INVALID_INPUT");
    expect(codeOf(() => signUp(T1, { email: "nope", password: "board1234", name: "Ann", acceptTerms: true }))).toBe("INVALID_INPUT");
    expect(codeOf(() => signUp(T1, { email: "x@y.io", password: "board1234", name: "Ann" }))).toBe("INVALID_INPUT");
    signUp(T1, { email: "x@y.io", password: "board1234", name: "Ann", acceptTerms: true });
    resolveSession(T2);
    expect(codeOf(() => signUp(T2, { email: "X@y.io", password: "board1234", name: "Bob", acceptTerms: true }))).toBe("EMAIL_TAKEN");
  });

  it("logs in with a fresh session token, logs out, and rate-limits guessing", () => {
    resolveSession(T1);
    const { user } = signUp(T1, { email: "c@d.io", password: "board1234", name: "Cy", acceptTerms: true });
    logOut(T1);
    expect(read((db) => db.sessions[T1])).toBeUndefined();

    resolveSession(T2);
    const res = logIn(T2, { email: "c@d.io", password: "board1234" }, "ip1");
    expect(res.user.id).toBe(user.id);
    expect(res.token).not.toBe(T2);
    expect(read((db) => db.sessions[T2])).toBeUndefined();

    expect(codeOf(() => logIn(undefined, { email: "c@d.io", password: "wrong" }, "ip2"))).toBe("UNAUTHENTICATED");
    for (let i = 0; i < 8; i++) codeOf(() => logIn(undefined, { email: "c@d.io", password: "wrong" }, "ip3"));
    expect(codeOf(() => logIn(undefined, { email: "c@d.io", password: "board1234" }, "ip3"))).toBe("RATE_LIMITED");
  });
});

describe("connect wallet", () => {
  beforeEach(() => resetDb());
  const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

  it("links a wallet only with a valid one-time signature", async () => {
    const { user } = resolveSession(T1);
    const { message } = createChallenge(T1, account.address, 8453, "localhost");
    const signature = await account.signMessage({ message });
    const wallets = await verifyAndLink(T1, { address: account.address, signature, chainId: 8453 });
    expect(wallets[0]).toMatchObject({ address: account.address, chainId: 8453 });
    expect(profileOf(user.id).wallets).toHaveLength(1);
    // Replay of the same signature fails: the challenge is single-use.
    await expect(verifyAndLink(T1, { address: account.address, signature, chainId: 8453 })).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });

  it("rejects a signature from a different key and a wallet owned by another account", async () => {
    resolveSession(T1);
    const other = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const { message } = createChallenge(T1, account.address, 1, "localhost");
    const forged = await other.signMessage({ message });
    await expect(verifyAndLink(T1, { address: account.address, signature: forged, chainId: 1 })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const ok = await account.signMessage({ message });
    await verifyAndLink(T1, { address: account.address, signature: ok, chainId: 1 });
    resolveSession(T2);
    const c2 = createChallenge(T2, account.address, 1, "localhost");
    const s2 = await account.signMessage({ message: c2.message });
    await expect(verifyAndLink(T2, { address: account.address, signature: s2, chainId: 1 })).rejects.toMatchObject({ code: "WALLET_TAKEN" });
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
