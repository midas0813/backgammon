import { expect, test } from "@playwright/test";
import { openLobby, openTable, player } from "./helpers";

test("a host opens a table, another player joins from the room browser, and both reach the board", async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);
  await openTable(host.page, { points: 5 });
  await expect(host.page.getByText(/Finding an opponent/)).toBeVisible();

  await guest.page.goto("/play?find=1");
  const browserDialog = guest.page.getByRole("dialog", { name: "Find a game" });
  await expect(browserDialog.locator(".room-card").first()).toBeVisible();
  // Filters: the table is a 5-pointer.
  await browserDialog.getByRole("button", { name: "1 pt", exact: true }).click();
  await expect(browserDialog.getByText("No open tables match these filters")).toBeVisible();
  await browserDialog.getByRole("button", { name: "5 pt", exact: true }).click();
  await browserDialog.getByRole("button", { name: "Join table" }).first().click();

  await expect(guest.page.locator(".board-wrap")).toBeVisible();
  await expect(host.page.locator(".board-wrap")).toBeVisible({ timeout: 20_000 });
  await expect(host.page.locator(".info")).toContainText("5-pt");
  expect([...host.errors, ...guest.errors]).toEqual([]);
  await host.close();
  await guest.close();
});

test("players chat with presets and their own words; a spectator reacts", async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);
  const viewer = await player(browser);
  const url = await openTable(host.page);
  await guest.page.goto(url);
  await guest.page.getByRole("button", { name: "Join as Black" }).click();
  await expect(host.page.locator(".board-wrap")).toBeVisible({ timeout: 20_000 });

  await host.page.locator(".chat-btn").click();
  await host.page.getByRole("button", { name: "Good luck!" }).click();
  await expect(host.page.locator(".chat-list")).toContainText("Good luck!");
  await host.page.getByRole("button", { name: "Close chat" }).click();

  await expect(guest.page.locator(".chat-badge")).toHaveText("1", { timeout: 15_000 });
  await guest.page.locator(".chat-btn").click();
  await guest.page.getByLabel("Message", { exact: true }).fill("Thanks, you too");
  await guest.page.getByRole("button", { name: "Send" }).click();
  await expect(guest.page.locator(".chat-list")).toContainText("Thanks, you too");

  await viewer.page.goto(url);
  await expect(viewer.page.getByText("Watching")).toBeVisible();
  await viewer.page.getByRole("button", { name: "React 🔥" }).click();
  await expect(host.page.locator(".reaction-float")).toBeVisible({ timeout: 15_000 });
  await host.close();
  await guest.close();
  await viewer.close();
});

test("one game at a time: a second tab is told and can end the first game", async ({ browser }) => {
  const p = await player(browser);
  await openLobby(p.page);
  await p.page.getByRole("button", { name: /vs Computer/ }).click();
  await p.page.waitForURL(/\/match\//);
  const second = await p.page.context().newPage();
  await openLobby(second);
  await second.getByRole("button", { name: /Pass & play/ }).click();
  const guard = second.getByRole("dialog", { name: "You're already in a game" });
  await expect(guard).toContainText("game against the computer");
  await guard.getByRole("button", { name: "End this game" }).click();
  await second.getByRole("button", { name: /Pass & play/ }).click();
  await second.waitForURL(/\/match\//);
  await expect(second.locator(".board-wrap")).toBeVisible();
  await p.close();
});

test("pass & play: move checkers by tapping, undo, and confirm a turn", async ({ browser }) => {
  const p = await player(browser, { mobile: true });
  await openLobby(p.page);
  await p.page.getByRole("button", { name: /Pass & play/ }).click();
  await expect(p.page.locator(".board-wrap")).toBeVisible();
  const undo = p.page.getByRole("button", { name: "Undo" });
  const confirm = p.page.getByRole("button", { name: "Confirm turn" });
  const points = p.page.locator(".board-wrap svg rect[fill='transparent']");
  const dests = p.page.locator(".dest-buttons button");

  /** Move one checker: tap a movable point, then a destination button if one is offered. */
  const moveOne = async () => {
    const used = () => p.page.locator(".board-wrap [aria-label$=' used']").count();
    const before = await used();
    for (let rel = 24; rel >= 1; rel--) {
      await points.nth(rel - 1).click();
      if (await dests.count()) {
        await dests.first().click();
        return;
      }
      if ((await used()) > before) return; // a one-tap move
    }
    throw new Error("no movable checker found");
  };

  await moveOne();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  for (let i = 0; i < 4 && !(await confirm.isEnabled()); i++) await moveOne();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(p.page.locator(".controls")).toContainText("Roll the dice");
  expect(p.errors).toEqual([]);
  await p.close();
});

test("the forfeit confirmation appears above the menu, and themes switch", async ({ browser }) => {
  const p = await player(browser);
  await openLobby(p.page);
  await p.page.getByRole("button", { name: /vs Computer/ }).click();
  await expect(p.page.locator(".board-wrap")).toBeVisible();
  await p.page.getByRole("button", { name: "Menu" }).click();
  const menu = p.page.getByRole("dialog", { name: "Match menu" });
  await menu.getByRole("button", { name: /slate/i }).click();
  await menu.getByRole("button", { name: "Forfeit match…" }).click();
  await expect(menu).toBeHidden();
  const ask = p.page.getByRole("dialog", { name: "Forfeit the whole match?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Forfeit match" }).click();
  await expect(p.page.getByText("You lost the match")).toBeVisible();
  await p.close();
});

test("the admin area stays locked without an admin wallet", async ({ browser }) => {
  const p = await player(browser);
  await p.page.goto("/admin");
  await expect(p.page.getByText("Sign in with an admin wallet to continue.")).toBeVisible();
  const res = await p.page.request.get("/api/admin/dashboard");
  expect(res.status()).toBe(404);
  await p.close();
});

test("lobby looks right", async ({ browser }) => {
  const p = await player(browser);
  await openLobby(p.page);
  await p.page.waitForTimeout(800);
  await expect(p.page.locator(".play-tiles")).toHaveScreenshot("lobby-tiles.png");
  await p.close();
});

test("losing the connection shows a banner that goes away when it returns", async ({ browser }) => {
  const p = await player(browser);
  await openLobby(p.page);
  await p.page.context().setOffline(true);
  await expect(p.page.getByText(/Offline — reconnecting/)).toBeVisible();
  await p.page.context().setOffline(false);
  await expect(p.page.getByText(/Offline — reconnecting/)).toBeHidden();
  await p.close();
});
