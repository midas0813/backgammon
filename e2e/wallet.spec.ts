import { expect, test, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * A browser wallet stand-in: announces itself like an extension (EIP-6963) and signs with a test key,
 * so the real connect → sign → verify flow runs end to end.
 */
/** Hardhat's public development key #1 — the test server's bootstrap admin (playwright.config.ts). */
const TEST_ADMIN_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function installWallet(page: Page, key = generatePrivateKey()) {
  const account = privateKeyToAccount(key);
  await page.exposeFunction("__testWalletSign", (hex: `0x${string}`) => account.signMessage({ message: { raw: hex } }));
  await page.addInitScript((address: string) => {
    const w = window as unknown as { __testWalletSign: (hex: string) => Promise<string> };
    // Like a real wallet: no accounts are shared until the site asks and the user approves; the
    // approval is remembered across page loads.
    let approved = sessionStorage.getItem("test-wallet-approved") === "1";
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case "eth_requestAccounts":
            approved = true;
            sessionStorage.setItem("test-wallet-approved", "1");
            return [address];
          case "eth_accounts":
            return approved ? [address] : [];
          case "eth_chainId":
            return "0x2105"; // Base
          case "net_version":
            return "8453";
          case "personal_sign":
            return w.__testWalletSign(params![0] as string);
          case "wallet_requestPermissions":
          case "wallet_getPermissions":
            return [{ parentCapability: "eth_accounts" }];
          case "wallet_revokePermissions":
          case "wallet_switchEthereumChain":
            return null;
          default:
            throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
        }
      },
      on: () => {},
      removeListener: () => {},
    };
    const info = {
      uuid: "4f4c1d06-0000-4000-8000-000000000001",
      name: "Test Wallet",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
      rdns: "com.example.testwallet",
    };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, account.address);
  return account;
}

test("a new wallet signs in, creates its account, and returns to it after signing out", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  // WebKit reports prefetches cancelled by a navigation as errors; those are not app failures.
  page.on("pageerror", (e) => !/_rsc=.*access control checks/.test(String(e)) && errors.push(String(e)));
  const key = generatePrivateKey();
  const account = await installWallet(page, key);

  await page.goto("/play");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Wallet" });
  await dialog.getByRole("button", { name: /Test Wallet/ }).click();
  await page.waitForURL(/\/welcome/);
  const me = await (await page.request.get("/api/me")).json();
  expect(me).toMatchObject({ registered: true, walletAddress: account.address });

  // Sign out, then sign in again: the same account, no onboarding.
  await page.goto("/profile");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).registered).toBe(false);
  await page.waitForURL((u) => u.pathname === "/"); // signing out returns to the landing page
  await page.goto("/play");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page
    .getByRole("dialog", { name: "Connect Wallet" })
    .getByRole("button", { name: /Test Wallet|^Sign$/ })
    .first()
    .click();
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).walletAddress).toBe(account.address);
  expect(page.url()).not.toContain("/welcome");
  expect(errors).toEqual([]);
  await ctx.close();
});

test("the admin wallet unlocks the admin area with a signature", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await installWallet(page, TEST_ADMIN_KEY);
  await page.goto("/play");
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page
    .getByRole("dialog", { name: "Connect Wallet" })
    .getByRole("button", { name: /Test Wallet/ })
    .click();
  // (New account or returning one, depending on which browser ran first against this server.)
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).registered).toBe(true);
  await page.goto("/admin");
  await page.getByRole("button", { name: /Unlock admin area/ }).click();
  await expect(page.getByText(/owner/i).first()).toBeVisible();
  expect((await page.request.get("/api/admin/dashboard")).status()).toBe(200);
  await ctx.close();
});
