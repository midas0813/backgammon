import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/lib/server/store/postgres";
import { migrationFiles, pgliteDriver } from "./pglite";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("migrations", () => {
  it("moves legacy event and action logs out of match documents and backfills results", async () => {
    const db = new PGlite();
    const driver = pgliteDriver(db);
    const all = migrationFiles();
    const cut = all.findIndex((m) => m.name.startsWith("20261017090000"));
    await runMigrations(driver, all.slice(0, cut));
    const legacy = {
      id: "legacy1",
      mode: "quick",
      seats: [A, B],
      names: ["Ann", "Bob"],
      state: {
        status: "COMPLETED",
        targetPoints: 3,
        score: [3, 1],
        winner: 0,
        endReason: "points",
        results: [
          { gameNumber: 1, winner: 1, kind: "single", cube: 1, points: 1, scoreAfter: [0, 1] },
          { gameNumber: 2, winner: 0, kind: "backgammon", cube: 1, points: 3, scoreAfter: [3, 1] },
        ],
      },
      events: [
        { seq: 1, type: "MATCH_CREATED", stateVersion: 1, serverTime: "2026-10-10T10:00:00.000Z", payload: {} },
        { seq: 2, type: "MATCH_COMPLETED", stateVersion: 9, serverTime: "2026-10-10T10:30:00.000Z", payload: { winner: 0 } },
      ],
      actions: { act1: { fingerprint: "f", response: { version: 9 } } },
      eventSeq: 2,
    };
    await db.query(
      `insert into matches (id, mode, status, target_points, created_by, seat0, seat1, version, created_at, data, completed_at)
       values ('legacy1', 'quick', 'COMPLETED', 3, $1::uuid, $1::text, $2, 9, now(), $3::jsonb, now())`,
      [A, B, JSON.stringify(legacy)],
    );
    // Up to (not including) the one-time clean-up of test data, which empties these tables.
    await runMigrations(
      driver,
      all.filter((m) => m.name < "20261017130000"),
    );
    const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
    expect((await q(`select seq, type from match_events order by seq`)).map((r) => r.type)).toEqual(["MATCH_CREATED", "MATCH_COMPLETED"]);
    expect(await q(`select action_id, fingerprint from match_actions`)).toEqual([{ action_id: "act1", fingerprint: "f" }]);
    expect((await q(`select data->'events' as e, data->'actions' as a from matches`))[0]).toEqual({ e: [], a: {} });
    const results = await q(`select user_id, won, points, games, gammons, opponent, score_for, score_against from match_results order by user_id`);
    expect(results).toEqual([
      { user_id: A, won: true, points: 3, games: 2, gammons: 1, opponent: "Bob", score_for: 3, score_against: 1 },
      { user_id: B, won: false, points: 1, games: 2, gammons: 0, opponent: "Ann", score_for: 1, score_against: 3 },
    ]);
    expect((await q(`select value from app_counters where key = 'games'`))[0].value).toBe(2);
  });
});
