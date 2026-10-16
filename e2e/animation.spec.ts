import { expect, test } from "@playwright/test";
import { openLobby, player } from "./helpers";

/** Moves and rolls must animate (dice tumble, checkers slide), not just jump to the new state. */
test("dice and checkers animate in a computer game", async ({ browser }) => {
  const p = await player(browser);
  await openLobby(p.page);
  await p.page.getByRole("button", { name: /vs Computer/ }).click();
  await expect(p.page.locator(".board-wrap")).toBeVisible();
  await p.page.evaluate(() => {
    const w = window as unknown as { __anims: Set<string> };
    w.__anims = new Set();
    const tick = () => {
      document.getAnimations().forEach((a) => w.__anims.add((a as CSSAnimation).animationName));
      requestAnimationFrame(tick);
    };
    tick();
  });
  const points = p.page.locator(".board-wrap svg rect[fill='transparent']");
  const dests = p.page.locator(".dest-buttons button");
  const roll = p.page.getByRole("button", { name: "Roll" });
  const confirm = p.page.getByRole("button", { name: "Confirm turn" });
  const seen = () => p.page.evaluate(() => [...(window as unknown as { __anims: Set<string> }).__anims]);

  for (let step = 0; step < 80; step++) {
    const names = await seen();
    if (names.includes("checker-arrive") && names.includes("dice-roll") && step > 12) break;
    if (await roll.isVisible()) {
      await roll.click();
      await p.page.waitForTimeout(900);
    } else if ((await confirm.isVisible()) && (await confirm.isEnabled())) {
      await confirm.click();
      await p.page.waitForTimeout(2500); // the computer replies
    } else if (await confirm.isVisible()) {
      for (let rel = 24; rel >= 1; rel--) {
        await points.nth(rel - 1).click();
        if (await dests.count()) {
          await dests.first().click();
          break;
        }
      }
      await p.page.waitForTimeout(400);
    } else {
      await p.page.waitForTimeout(700);
    }
  }
  const names = await seen();
  expect(names).toContain("dice-roll");
  expect(names).toContain("checker-arrive");
  await p.close();
});
