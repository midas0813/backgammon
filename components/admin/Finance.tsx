"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate, shortId } from "@/lib/client/admin";
import { formatTokens } from "@/lib/fees";
import type { financeOverview } from "@/lib/server/admin/service";
import { ActionDialog, Empty, Status, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof financeOverview>>;

export default function Finance() {
  const { open, can, sign, me } = useAdmin();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decide, setDecide] = useState<{ id: string; approve: boolean } | null>(null);
  const load = useCallback(() => {
    api<Data>("/api/admin/finance")
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  if (!d) return error ? <p className="err">{error}</p> : <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />;
  const pending = d.adjustments.filter((a) => a.status === "PENDING");
  return (
    <div className="a-stack">
      <div className={`a-banner ${d.reconciliation.mismatches.length ? "bad" : "ok"}`}>
        {d.reconciliation.mismatches.length
          ? `Ledger mismatch on ${d.reconciliation.mismatches.length} account(s): ${d.reconciliation.mismatches.join(", ")}`
          : `Ledger reconciled: every balance matches its ${d.reconciliation.transactions} journal transactions.`}
      </div>

      <section className="a-card">
        <h3 className="a-h3">Adjustments waiting for a second admin ({pending.length})</h3>
        {pending.length === 0 ? (
          <Empty>Nothing to approve.</Empty>
        ) : (
          <table className="a-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Account</th>
                <th className="num">Amount</th>
                <th>Reason</th>
                <th>Requested by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button className="link" onClick={() => open("users", a.userId)}>
                      {a.userName}
                    </button>
                  </td>
                  <td>{a.accountKind === "FREE_CREDITS" ? "Practice" : "Tokens"}</td>
                  <td className="num mono">{formatTokens(a.amount)}</td>
                  <td className="a-clip">{a.reason}</td>
                  <td className="muted">
                    {a.requestedByName} · {fmtDate(a.requestedAt)}
                  </td>
                  <td>
                    {can("finance.adjust") && a.requestedByName !== me.name ? (
                      <span className="a-actions">
                        <button className="btn sm primary" onClick={() => setDecide({ id: a.id, approve: true })}>
                          Approve
                        </button>
                        <button className="btn sm" onClick={() => setDecide({ id: a.id, approve: false })}>
                          Reject
                        </button>
                      </span>
                    ) : (
                      <span className="muted small">needs another admin</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="a-grid2">
        <section className="a-card">
          <h3 className="a-h3">System accounts</h3>
          <table className="a-table compact">
            <tbody>
              {d.systemAccounts.map((s) => (
                <tr key={s.account}>
                  <td className="mono">{s.account}</td>
                  <td className="num mono">{formatTokens(s.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="a-card">
          <h3 className="a-h3">Adjustment history</h3>
          {d.adjustments.filter((a) => a.status !== "PENDING").length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <table className="a-table compact">
              <tbody>
                {d.adjustments
                  .filter((a) => a.status !== "PENDING")
                  .map((a) => (
                    <tr key={a.id}>
                      <td>{a.userName}</td>
                      <td className="num mono">{formatTokens(a.amount)}</td>
                      <td>
                        <Status value={a.status} />
                      </td>
                      <td className="muted small">
                        {a.requestedByName} → {a.decidedByName}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="a-grid2">
        <section className="a-card">
          <h3 className="a-h3">Recent deposits</h3>
          {d.deposits.length === 0 ? (
            <Empty>No deposits yet.</Empty>
          ) : (
            <table className="a-table compact">
              <tbody>
                {d.deposits.map((x) => (
                  <tr key={x.id} className="clickable" onClick={() => open("users", x.userId)}>
                    <td className="mono">{shortId(x.id)}</td>
                    <td>{x.method}</td>
                    <td className="num mono">{formatTokens(x.tokenUnits)}</td>
                    <td>
                      <Status value={x.status} />
                    </td>
                    <td className="muted">{fmtDate(x.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="a-card">
          <h3 className="a-h3">Recent withdrawals</h3>
          {d.withdrawals.length === 0 ? (
            <Empty>No withdrawals yet.</Empty>
          ) : (
            <table className="a-table compact">
              <tbody>
                {d.withdrawals.map((x) => (
                  <tr key={x.id} className="clickable" onClick={() => open("users", x.userId)}>
                    <td className="mono">{shortId(x.id)}</td>
                    <td className="num mono">{formatTokens(x.amountUnits)}</td>
                    <td>
                      <Status value={x.status} />
                    </td>
                    <td className="muted">{fmtDate(x.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <p className="muted small">To request an adjustment, open a player from Players and use “Request adjustment”.</p>

      {decide && (
        <ActionDialog
          title={decide.approve ? "Approve this adjustment?" : "Reject this adjustment?"}
          description={decide.approve ? "A balanced ledger transaction is posted immediately." : "Nothing changes in the ledger."}
          confirmLabel={decide.approve ? "Approve" : "Reject"}
          danger={!decide.approve}
          signed
          reasonRequired={false}
          onClose={() => setDecide(null)}
          onConfirm={async () => {
            const proof = await sign({ action: decide.approve ? "ADJUST_APPROVE" : "ADJUST_REJECT", target: `adjustment:${decide.id}` });
            await api(`/api/admin/finance/adjustments/${decide.id}`, { method: "POST", body: { approve: decide.approve, ...proof } });
            load();
          }}
        />
      )}
    </div>
  );
}
