"use client";

import { useCallback, useEffect, useState } from "react";
import ConnectWalletButton, { chainName, shortAddress } from "@/components/ConnectWallet";
import { api, sendIdempotent } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";
import { formatTokens } from "@/lib/fees";

interface HistoryItem {
  status: string;
  at: string;
  note?: string;
}
interface Deposit {
  id: string;
  method: "CARD" | "STABLECOIN";
  asset?: string;
  network?: string;
  tokenUnits: number;
  usdCents: number;
  feeCents: number;
  rate: string;
  status: string;
  instructions: string;
  expiresAt: string;
  history: HistoryItem[];
}
interface Withdrawal {
  id: string;
  amountUnits: number;
  destination: string;
  status: string;
  history: HistoryItem[];
}
interface Txn {
  id: string;
  type: string;
  memo: string;
  createdAt: string;
  entries: { account: string; amount: number }[];
}
interface WalletData {
  balances: { freeCredits: number; available: number; matchReserved: number; withdrawalReserved: number; pendingDeposits: number };
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  transactions: Txn[];
  adapter: string;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ACCOUNT_LABEL: Record<string, string> = {
  FREE_CREDITS: "practice",
  PAID_AVAILABLE: "available",
  PAID_MATCH_RESERVED: "match reserve",
  PAID_WITHDRAWAL_RESERVED: "withdrawal reserve",
};

export default function WalletPage() {
  const me = useMe();
  const [w, setW] = useState<WalletData | null>(null);
  const [qty, setQty] = useState("25");
  const [method, setMethod] = useState<"CARD" | "STABLECOIN">("CARD");
  const [wdAmount, setWdAmount] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastEvent, setLastEvent] = useState<Record<string, string>>({});
  const [log, setLog] = useState<string | null>(null);

  const load = useCallback(async () => {
    setW(await api<WalletData>("/api/wallet"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
      load();
    }
  };

  const simulate = (kind: "DEPOSIT" | "WITHDRAWAL", id: string, status: string, extra: Record<string, unknown> = {}) =>
    run(async () => {
      const r = await api<{ eventId: string; duplicate: boolean; outcome: string }>("/api/dev/simulate-payment-event", {
        method: "POST",
        body: { kind, id, status, ...extra },
      });
      setLastEvent((m) => ({ ...m, [id]: r.eventId }));
      setLog(`Event ${r.eventId} (${status}) → ${r.duplicate ? "duplicate ignored" : r.outcome}`);
    });

  const b = w?.balances;
  return (
    <main className="page">
      <h1>Wallet</h1>
      <div className="notice">
        <strong>Simulated payments.</strong> Provider: <code>{w?.adapter ?? "…"}</code>. No card data is collected and no real transfer happens.
        Development tokens have no cash value. 1 BGT = $1.00 USD.
      </div>

      <section className="card wallet-connect">
        <div className="spread">
          <div>
            <h2>Crypto wallet</h2>
            <p className="muted small">Link a wallet to deposit stablecoins from it later. Signing is free and moves no funds.</p>
          </div>
          <ConnectWalletButton className="btn gold" />
        </div>
        {me?.wallets && me.wallets.length > 0 && (
          <div className="row">
            {me.wallets.map((w) => (
              <span key={w.address} className="badge ok" title={w.address}>
                {shortAddress(w.address)} · {chainName(w.chainId)}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Balances</h2>
        <div className="grid2">
          <Stat label="Spendable tokens" value={b ? formatTokens(b.available) : "…"} strong />
          <Stat label="Pending deposits (not spendable)" value={b ? formatTokens(b.pendingDeposits) : "…"} />
          <Stat label="Reserved for matches" value={b ? formatTokens(b.matchReserved) : "…"} />
          <Stat label="Reserved for withdrawals" value={b ? formatTokens(b.withdrawalReserved) : "…"} />
        </div>
        <Stat label="Practice credits — free play only, never redeemable or usable for paid stakes" value={b ? formatTokens(b.freeCredits) : "…"} />
      </section>

      <section className="card">
        <h2>Buy tokens</h2>
        <div className="grid2" role="group" aria-label="Payment method">
          <button className="chip" aria-pressed={method === "CARD"} onClick={() => setMethod("CARD")}>
            Card (simulated)
          </button>
          <button className="chip" aria-pressed={method === "STABLECOIN"} onClick={() => setMethod("STABLECOIN")}>
            USDC · sim-chain
          </button>
        </div>
        <label>
          Tokens
          <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
        </label>
        <div className="muted small">
          Quote: {qty || 0} BGT = {usd(Number(qty || 0) * 100)} · provider/network fees shown separately and never reduce credited tokens.
        </div>
        <button
          className="btn primary"
          disabled={busy || !qty}
          onClick={() => run(() => sendIdempotent("/api/purchase-intents", { quantity: Number(qty), method }))}
        >
          Create purchase quote
        </button>
        {error && <p className="err small">{error}</p>}
        {log && <p className="muted small mono">{log}</p>}
      </section>

      {w && w.deposits.length > 0 && (
        <section className="card">
          <h2>Purchases</h2>
          <ul className="list">
            {w.deposits.map((d) => (
              <li key={d.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="spread">
                  <strong>
                    {formatTokens(d.tokenUnits)} BGT · {usd(d.usdCents)}
                  </strong>
                  <StatusBadge status={d.status} />
                </div>
                <div className="muted small">
                  {d.method === "STABLECOIN" ? `${d.asset} on ${d.network}` : "Card"} · {d.rate} · fees {usd(d.feeCents)} · quote expires{" "}
                  {new Date(d.expiresAt).toLocaleTimeString()}
                </div>
                <div className="muted small">{d.instructions}</div>
                <div className="muted small">{d.history.map((h) => h.status + (h.note ? ` (${h.note})` : "")).join(" → ")}</div>
                <div className="row">
                  {d.status === "CREATED" && (
                    <button className="btn sm primary" disabled={busy} onClick={() => simulate("DEPOSIT", d.id, "PENDING")}>
                      Pay (simulated)
                    </button>
                  )}
                  {(d.status === "PENDING" || d.status === "CREATED") && (
                    <>
                      <button className="btn sm" disabled={busy} onClick={() => simulate("DEPOSIT", d.id, "CONFIRMED")}>
                        Provider: confirm
                      </button>
                      <button
                        className="btn sm"
                        disabled={busy}
                        onClick={() => simulate("DEPOSIT", d.id, "CONFIRMED", { amountTokens: d.tokenUnits / 100 - 1 })}
                      >
                        Underpay by 1
                      </button>
                      <button className="btn sm danger" disabled={busy} onClick={() => simulate("DEPOSIT", d.id, "FAILED")}>
                        Fail
                      </button>
                    </>
                  )}
                  {lastEvent[d.id] && (
                    <button
                      className="btn sm"
                      disabled={busy}
                      onClick={() => simulate("DEPOSIT", d.id, "CONFIRMED", { replayEventId: lastEvent[d.id] })}
                    >
                      Replay last callback
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Withdraw (simulated)</h2>
        <p className="muted small">
          Moves tokens from spendable to a withdrawal reserve immediately, so they cannot back a match. Real redemption rules are not yet defined.
        </p>
        <label>
          Tokens
          <input inputMode="numeric" value={wdAmount} onChange={(e) => setWdAmount(e.target.value.replace(/\D/g, ""))} />
        </label>
        <button
          className="btn"
          disabled={busy || !wdAmount}
          onClick={() => run(() => sendIdempotent("/api/withdrawal-intents", { amount: Number(wdAmount), destination: "Simulated bank account" }))}
        >
          Request withdrawal
        </button>
        {w && w.withdrawals.length > 0 && (
          <ul className="list">
            {w.withdrawals.map((x) => (
              <li key={x.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="spread">
                  <strong>{formatTokens(x.amountUnits)} BGT</strong>
                  <StatusBadge status={x.status} />
                </div>
                <div className="muted small">{x.history.map((h) => h.status).join(" → ")}</div>
                {!["PAID", "REJECTED", "CANCELLED", "FAILED"].includes(x.status) && (
                  <div className="row">
                    {x.status === "PENDING_REVIEW" && (
                      <>
                        <button className="btn sm" disabled={busy} onClick={() => run(() => api(`/api/withdrawal-intents/${x.id}/cancel`, { method: "POST" }))}>
                          Cancel
                        </button>
                        <button className="btn sm" disabled={busy} onClick={() => simulate("WITHDRAWAL", x.id, "APPROVED")}>
                          Ops: approve
                        </button>
                        <button className="btn sm danger" disabled={busy} onClick={() => simulate("WITHDRAWAL", x.id, "REJECTED")}>
                          Ops: reject
                        </button>
                      </>
                    )}
                    {x.status === "APPROVED" && (
                      <button className="btn sm" disabled={busy} onClick={() => simulate("WITHDRAWAL", x.id, "PROCESSING")}>
                        Provider: processing
                      </button>
                    )}
                    {x.status === "PROCESSING" && (
                      <>
                        <button className="btn sm" disabled={busy} onClick={() => simulate("WITHDRAWAL", x.id, "PAID")}>
                          Provider: paid
                        </button>
                        <button className="btn sm danger" disabled={busy} onClick={() => simulate("WITHDRAWAL", x.id, "FAILED")}>
                          Provider: failed
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Transactions</h2>
        {!w || w.transactions.length === 0 ? (
          <p className="muted small">No transactions yet.</p>
        ) : (
          <ul className="list">
            {w.transactions.map((t) => (
              <li key={t.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="spread">
                  <span style={{ fontWeight: 600 }}>{t.type.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="muted small">{new Date(t.createdAt).toLocaleString()}</span>
                </div>
                <div className="small mono">
                  {t.entries
                    .map((e) => `${e.amount > 0 ? "+" : ""}${formatTokens(e.amount)} ${ACCOUNT_LABEL[e.account.split(":")[2]] ?? ""}`)
                    .join(" · ")}
                </div>
                <div className="muted small">
                  {t.id}
                  {t.memo ? ` · ${t.memo}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 12, minWidth: 0 }}>
      <div className="muted small">{label}</div>
      <div className="mono" style={{ fontSize: strong ? 24 : 18, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = ["CREDITED", "PAID"].includes(status);
  const bad = ["FAILED", "REJECTED", "REVIEW", "EXPIRED"].includes(status);
  return <span className={`badge ${ok ? "ok" : bad ? "warn" : ""}`}>{status.replace("_", " ")}</span>;
}
