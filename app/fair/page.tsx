"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { verifyFair, type FairCheck } from "@/lib/client/fairVerify";
import type { FairRecord } from "@/lib/server/fairCheck";

function Verifier() {
  const params = useSearchParams();
  const [id, setId] = useState(params.get("match") ?? "");
  const [rec, setRec] = useState<FairRecord | null>(null);
  const [check, setCheck] = useState<FairCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (matchId: string) => {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      const res = await fetch(`/api/fair/${encodeURIComponent(matchId.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Match not found");
      setRec(data);
      setCheck(await verifyFair(data));
    } catch (e) {
      setRec(null);
      setError(e instanceof Error ? e.message : "Could not check this match");
    } finally {
      setBusy(false);
    }
  };
  const initial = params.get("match");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: state is set after the request returns
    if (initial) void run(initial);
  }, [initial]);

  return (
    <section className="card">
      <h2>Check a game</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (id.trim()) void run(id);
        }}
      >
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Match ID (from the match page address)"
          aria-label="Match ID"
          style={{ flex: 1 }}
        />
        <button className="btn primary" disabled={busy || !id.trim()}>
          {busy ? "Checking…" : "Verify"}
        </button>
      </form>
      {error && <p className="err small">{error}</p>}
      {rec && !rec.fair.serverSeed && (
        <p className="notice">
          This match is still being played. The sealed fingerprint is <code className="mono small">{rec.fair.commit.slice(0, 16)}…</code>; the secret is
          revealed when it ends, then every roll can be checked.
        </p>
      )}
      {rec && check && (
        <>
          <p className={check.allOk ? "fair-ok" : "err"}>
            {check.allOk
              ? `✓ All ${check.rolls.length} dice in ${rec.names[0]} vs ${rec.names[1]} match the sealed secret.`
              : check.fingerprintOk
                ? "✗ Some dice do not match the sealed secret."
                : "✗ The revealed secret does not match the fingerprint shown before the game."}
          </p>
          <ul className="list small">
            <li>
              <span>Fingerprint shown before the game</span>
              <code className="mono">{rec.fair.commit.slice(0, 24)}…</code>
            </li>
            <li>
              <span>Secret revealed after</span>
              <code className="mono">{rec.fair.serverSeed!.slice(0, 24)}…</code>
            </li>
            <li>
              <span>Players&apos; device seeds</span>
              <code className="mono">
                {rec.fair.clientSeeds[0].slice(0, 8) || "—"} · {rec.fair.clientSeeds[1].slice(0, 8) || "—"}
              </code>
            </li>
          </ul>
          <div className="fair-rolls" aria-label="Every die, in order">
            {check.rolls.map((r) => (
              <span key={r.n} className={r.ok ? "ok" : "bad"} title={`Die ${r.n + 1}: played ${r.played}, expected ${r.expected}`}>
                {r.played}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Public page: how the dice are made fair, and a checker for any finished game. */
export default function FairPlayPage() {
  return (
    <main className="page">
      <span className="eyebrow">Fair play</span>
      <h1 className="display">Don&apos;t trust us — check the dice</h1>
      <section className="card">
        <h2>The sealed envelope</h2>
        <ol className="small fair-steps">
          <li>
            Before a match, our server picks a secret code that decides the dice and shows everyone only its fingerprint (SHA-256). The fingerprint can&apos;t
            be turned back into the code.
          </li>
          <li>Each player&apos;s device adds its own random number, so we can&apos;t pick the dice alone.</li>
          <li>
            Every die is calculated from the secret and the players&apos; numbers (HMAC-SHA256, the first byte below 252, modulo 6), so each face is equally
            likely.
          </li>
          <li>
            When the match ends, the secret is revealed. Your browser checks that it matches the fingerprint and recalculates every roll — not our server.
          </li>
        </ol>
        <p className="muted small">
          Open any finished match and choose <strong>Verify this game</strong>, or paste a match ID below.
        </p>
      </section>
      <Suspense>
        <Verifier />
      </Suspense>
      <Link className="btn" href="/play">
        ← Lobby
      </Link>
    </main>
  );
}
