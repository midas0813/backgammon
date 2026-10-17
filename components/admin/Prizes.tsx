"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import { formatTokens } from "@/lib/fees";
import type { listPrizeWeeks } from "@/lib/server/admin/service";
import { ActionDialog, Empty, Status, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof listPrizeWeeks>>;

/** Each finished week's proposed winners: check, then pay (signed) or skip. */
export default function Prizes() {
  const { can, sign, open } = useAdmin();
  const [d, setD] = useState<Data | null>(null);
  const [decide, setDecide] = useState<{ week: string; approve: boolean } | null>(null);
  const load = useCallback(() => {
    api<Data>("/api/admin/prizes")
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (!d) return <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />;
  return (
    <div className="a-stack">
      <p className="muted small">
        Pool {d.settings.enabled ? `${formatTokens(d.settings.units)} tokens a week, split ${d.settings.split.join(" / ")}%` : "is OFF"} · eligible: wallet
        account and at least {d.settings.minOpponents} different opponents. Results under anti-cheat review are left out. Change these in Settings.
      </p>
      {d.weeks.length === 0 ? (
        <Empty>No finished weeks yet. The first week is proposed here the Monday after it ends.</Empty>
      ) : (
        d.weeks.map((w) => (
          <section key={w.weekKey} className="a-card">
            <div className="spread">
              <h3 className="a-h3">Week of {w.weekKey}</h3>
              <Status value={w.status === "PENDING_REVIEW" ? "PENDING" : w.status === "PAID" ? "COMPLETED" : "CANCELLED"} />
            </div>
            {w.winners.length === 0 ? (
              <p className="muted small">{w.note ?? "No winners."}</p>
            ) : (
              <table className="a-table compact">
                <tbody>
                  {w.winners.map((x) => (
                    <tr key={x.userId}>
                      <td>#{x.place}</td>
                      <td>
                        <button className="link" onClick={() => open("users", x.userId)}>
                          {x.name}
                        </button>
                      </td>
                      <td className="num mono">{x.points} pts</td>
                      <td className="num mono">{formatTokens(x.units)} tokens</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {w.decidedAt && (
              <p className="muted small">
                Decided {fmtDate(w.decidedAt)}
                {w.note ? ` — ${w.note}` : ""}
              </p>
            )}
            {w.status === "PENDING_REVIEW" && can("finance.adjust") && (
              <div className="a-actions">
                <button className="btn sm primary" onClick={() => setDecide({ week: w.weekKey, approve: true })}>
                  Pay winners…
                </button>
                <button className="btn sm" onClick={() => setDecide({ week: w.weekKey, approve: false })}>
                  Skip week…
                </button>
              </div>
            )}
          </section>
        ))
      )}
      {decide && (
        <ActionDialog
          title={decide.approve ? `Pay the winners of the week of ${decide.week}?` : `Skip the week of ${decide.week}?`}
          description={decide.approve ? "Each winner's token balance is credited at once (from system:PRIZES)." : "Nobody is paid for this week."}
          confirmLabel={decide.approve ? "Pay" : "Skip"}
          danger={!decide.approve}
          signed
          reasonRequired={!decide.approve}
          onClose={() => setDecide(null)}
          onConfirm={async (reason) => {
            const proof = await sign({ action: decide.approve ? "PRIZE_PAY" : "PRIZE_SKIP", target: `prizes:${decide.week}`, reason: reason || undefined });
            await api(`/api/admin/prizes/${decide.week}`, { method: "POST", body: { approve: decide.approve, note: reason || undefined, ...proof } });
            load();
          }}
        />
      )}
    </div>
  );
}
