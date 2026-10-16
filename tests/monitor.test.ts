import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { recordError } from "@/lib/server/monitor";
import { tx } from "@/lib/server/store";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_WEBHOOK_URL;
});

describe("error monitoring (G4)", () => {
  it("stores unexpected errors with the player's reference, but not ordinary refusals", async () => {
    const res = errorResponse(new Error("boom"));
    const { error } = await res.json();
    expect(res.status).toBe(500);
    await vi.waitFor(async () => expect((await tx((t) => t.errors.recent(5))).map((e) => e.ref)).toContain(error.referenceId));
    errorResponse(new ApiError(409, "EVENT_FULL", "Seat taken"));
    await new Promise((r) => setTimeout(r, 50));
    expect(await tx((t) => t.errors.countSince(0))).toBe(1);
  });

  it("alerts the team at once for payment errors and when errors spike", async () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook";
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).content);
      return new Response(null, { status: 204 });
    });
    await recordError({ ref: "p1", source: "server", message: "withdrawal webhook failed" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Payment-related");
    for (let i = 0; i < 5; i++) await recordError({ ref: `e${i}`, source: "client", message: "render crash" });
    expect(sent.some((m) => m.includes("errors in the last 5 minutes"))).toBe(true);
    const spikes = sent.filter((m) => m.includes("errors in the last 5 minutes")).length;
    await recordError({ ref: "e9", source: "client", message: "render crash" });
    expect(sent.filter((m) => m.includes("errors in the last 5 minutes"))).toHaveLength(spikes); // not repeated within 10 min
  });
});
