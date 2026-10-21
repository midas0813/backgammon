import { expect, type Browser, type Page } from "@playwright/test";

/** A fresh player: a new browser context is a new guest. */
export async function player(browser: Browser, opts: { mobile?: boolean } = {}) {
  const ctx = await browser.newContext(opts.mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : {});
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, errors, close: () => ctx.close() };
}

export async function openLobby(page: Page) {
  await page.goto("/play/backgammon");
  await expect(page.locator(".play-tile").first()).toBeVisible();
}

/** Host opens a public table; returns its URL. */
export async function openTable(page: Page, opts: { points?: number; visibility?: "public" | "private" } = {}) {
  await openLobby(page);
  await page.getByRole("button", { name: /Create table/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create a table" });
  if (opts.points) await dialog.getByRole("button", { name: `${opts.points} pt`, exact: true }).click();
  if (opts.visibility === "private") await dialog.getByRole("button", { name: /Invite only/ }).click();
  await dialog.getByRole("button", { name: "Open table" }).click();
  await page.waitForURL(/\/match\//);
  return page.url();
}
