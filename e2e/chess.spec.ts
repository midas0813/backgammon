import { expect, test } from "@playwright/test";

/** Chess end to end: the game picker, a computer game, and an online game between two browsers. */
test("chess: pick the game on Home, play the computer, and Play remembers chess", async ({ browser }) => {
  const errs: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("/home");
  await p.waitForTimeout(1500);
  await p.locator(".home-games").scrollIntoViewIfNeeded();
  await p.locator(".game-chess").click();
  await p.waitForURL(/\/play\/chess/);
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: /vs Computer/ }).click();
  await p.getByRole("button", { name: "♔ White" }).click();
  await p.getByRole("button", { name: "Start game" }).click();
  await p.waitForURL(/\/match\//);
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /^e2/ }).click();
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: /^e4/ }).click();
  await expect(p.locator(".chess-moves")).toContainText("e4");
  await expect.poll(async () => (await p.locator(".chess-moves").innerText()).split(/\s+/).length, { timeout: 15000 }).toBeGreaterThan(2);
  await p.waitForTimeout(800);
  // Back to Play remembers chess.
  await p.goto("/play");
  await p.waitForURL(/\/play\/chess/);
  expect(errs).toEqual([]);
  await ctx.close();
});
test("chess online: two players move, offer and accept a draw", async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const b = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const pa = await a.newPage();
  const pb = await b.newPage();
  await pa.goto("/play/chess");
  const { matchId } = await (
    await pa.request.post("/api/tables", { data: { game: "chess", timeControl: "3+2", visibility: "public", color: "white" } })
  ).json();
  await pb.goto("/play/chess");
  await pb.request.post(`/api/matches/${matchId}/join`);
  await pa.goto(`/match/${matchId}`);
  await pb.goto(`/match/${matchId}`);
  await pa.waitForTimeout(1500);
  await pa.getByRole("button", { name: /^d2/ }).click();
  await pa.getByRole("button", { name: /^d4/ }).click();
  await expect(pb.locator(".chess-moves")).toContainText("d4", { timeout: 15000 });
  await pb.getByRole("button", { name: /^d7/ }).click();
  await pb.getByRole("button", { name: /^d5/ }).click();
  await expect(pa.locator(".chess-moves")).toContainText("d5", { timeout: 15000 });
  await pa.getByRole("button", { name: /Offer draw/ }).click();
  await expect(pb.getByRole("button", { name: "Accept draw" })).toBeVisible({ timeout: 15000 });
  await pb.getByRole("button", { name: "Accept draw" }).click();
  await expect(pa.getByRole("heading", { name: "Draw" })).toBeVisible({ timeout: 15000 });
  await a.close();
  await b.close();
});
