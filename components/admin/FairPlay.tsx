"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import type { listFlags } from "@/lib/server/admin/service";
import { ActionDialog, Empty, Status, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof listFlags>>;
const STATUSES = ["OPEN", "DISMISSED", "ACTIONED", ""];

/**
 * Anti-cheat flags: open the players and the move-by-move match logs, then dismiss (the matches count
 * again) or void the matches. Suspensions are done from the player's page.
 */
export default function FairPlay() {
  const { can, sign, open } = useAdmin();
  const [status, setStatus] = useState("OPEN");
  const [d, setD] = useState<Data | null>(null);
  const [decide, setDecide] = useState<{ id: number; decision: "dismiss" | "void" } | null>(null);
  const load = useCallback(() => {
    api<Data>(`/api/admin/flags?status=${status}`)
      .then(setD)
      .catch(() => {});
  }, [status]);
  useEffect(load, [load]);
  return (
    <div className="a-stack">
      <div className="a-filters" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button
            key={s}
            className="chip"
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s);
              setD(null);
            }}
          >
            {s ? s.toLowerCase() : "all"}
          </button>
        ))}
      </div>
      <p className="muted small">Flagged matches don&apos;t count toward prizes until you decide. Nothing happens to anyone automatically.</p>
      {!d ? (
        <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
      ) : d.flags.length === 0 ? (
        <Empty>No flags.</Empty>
      ) : (
        d.flags.map((f) => (
          <section key={f.id} className="a-card">
            <div className="spread">
              <h3 className="a-h3">{f.label}</h3>
              <Status value={f.status === "OPEN" ? "PENDING" : f.status === "ACTIONED" ? "VOIDED" : "CANCELLED"} />
            </div>
            <div className="muted small">
              Raised {fmtDate(f.createdAt)}
              {Object.keys(f.details).length > 0 &&
                ` · ${Object.entries(f.details)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}`}
            </div>
            <div className="a-actions">
              {f.players.map((p) => (
                <button key={p.id} className="btn sm" onClick={() => open("users", p.id)}>
                  {p.name}
                  {p.wallet ? "" : " (guest)"}
                </button>
              ))}
              {f.matchIds.map((m) => (
                <button key={m} className="btn sm ghost" onClick={() => open("matches", m)}>
                  Match {m} · replay
                </button>
              ))}
            </div>
            {f.status === "OPEN" && can("matches.manage") ? (
              <div className="a-actions">
                <button className="btn sm" onClick={() => setDecide({ id: f.id, decision: "dismiss" })}>
                  Dismiss…
                </button>
                {f.matchIds.length > 0 && (
                  <button className="btn sm danger" onClick={() => setDecide({ id: f.id, decision: "void" })}>
                    Void the match{f.matchIds.length > 1 ? "es" : ""}…
                  </button>
                )}
              </div>
            ) : (
              f.decidedAt && (
                <p className="muted small">
                  {f.status === "DISMISSED" ? "Dismissed" : "Actioned"} by {f.decidedByName} {fmtDate(f.decidedAt)} — “{f.note}”
                </p>
              )
            )}
          </section>
        ))
      )}
      {decide && (
        <ActionDialog
          title={decide.decision === "void" ? "Void the flagged matches?" : "Dismiss this flag?"}
          description={
            decide.decision === "void"
              ? "The matches stop counting for stats, points and prizes. The players see why."
              : "The matches count again for points and prizes."
          }
          confirmLabel={decide.decision === "void" ? "Void" : "Dismiss"}
          danger={decide.decision === "void"}
          signed={decide.decision === "void"}
          onClose={() => setDecide(null)}
          onConfirm={async (reason) => {
            const proof = decide.decision === "void" ? await sign({ action: "FLAG_ACTION", target: `flag:${decide.id}`, reason }) : {};
            await api(`/api/admin/flags/${decide.id}`, { method: "POST", body: { decision: decide.decision, reason, ...proof } });
            load();
          }}
        />
      )}
    </div>
  );
}
