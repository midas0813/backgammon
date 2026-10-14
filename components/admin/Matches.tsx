"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Board from "@/components/Board";
import { api } from "@/lib/client/api";
import { fmtDate, shortId } from "@/lib/client/admin";
import { useTheme } from "@/lib/client/theme";
import type { listMatchesAdmin, matchDetail } from "@/lib/server/admin/service";
import { ActionDialog, Empty, Status, useAdmin } from "./ui";

type List = Awaited<ReturnType<typeof listMatchesAdmin>>;
type Detail = Awaited<ReturnType<typeof matchDetail>>;
const STATUSES = ["", "ACTIVE", "WAITING", "COMPLETED", "VOIDED", "CANCELLED"];

export default function Matches({ id }: { id?: string }) {
  return id ? <MatchDetail id={id} /> : <MatchList />;
}

function MatchList() {
  const { open } = useAdmin();
  const [status, setStatus] = useState("ACTIVE");
  const [data, setData] = useState<List | null>(null);
  useEffect(() => {
    setData(null);
    const load = () => api<List>(`/api/admin/matches?status=${status}`).then(setData).catch(() => {});
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, [status]);
  return (
    <div className="a-stack">
      <div className="a-filters" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? s.toLowerCase() : "all"}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
      ) : data.matches.length === 0 ? (
        <Empty>No matches with this status.</Empty>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Players</th>
                <th>Mode</th>
                <th>Score</th>
                <th>Status</th>
                <th className="num">Watching</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.matches.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => open("matches", m.id)}>
                  <td className="mono">{m.id}</td>
                  <td>
                    {m.names[0]} vs {m.names[1]}
                  </td>
                  <td>{m.mode}</td>
                  <td className="mono">
                    {m.score[0]}–{m.score[1]} / {m.targetPoints}
                  </td>
                  <td>
                    <Status value={m.status} />
                  </td>
                  <td className="num">{m.spectators || ""}</td>
                  <td className="muted">{fmtDate(m.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MatchDetail({ id }: { id: string }) {
  const { open, can, sign } = useAdmin();
  const theme = useTheme();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "void" | "cancel">(null);
  const load = useCallback(() => {
    api<Detail>(`/api/admin/matches/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  const events = useMemo(() => (d ? [...d.events].reverse() : []), [d]);

  if (error) return <p className="err">{error}</p>;
  if (!d) return <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />;
  return (
    <div className="a-stack">
      <button className="link" onClick={() => open("matches")}>
        ← All matches
      </button>
      <section className="a-card">
        <div className="spread">
          <div>
            <h2 className="mono">{d.id}</h2>
            <div className="muted small">
              {d.mode} · {d.targetPoints}-point · created {fmtDate(d.createdAt)}
              {d.completedAt ? ` · finished ${fmtDate(d.completedAt)}` : ""} · spectators {d.allowSpectators ? "on" : "off"}
            </div>
          </div>
          <div className="a-actions">
            <Status value={d.status} />
            {can("matches.manage") && d.status === "WAITING" && (
              <button className="btn sm" onClick={() => setDialog("cancel")}>
                Close table
              </button>
            )}
            {can("matches.manage") && (d.status === "ACTIVE" || d.status === "COMPLETED") && (
              <button className="btn sm danger" onClick={() => setDialog("void")}>
                Void match…
              </button>
            )}
          </div>
        </div>
        {d.voided && (
          <div className="a-banner bad">
            Voided {fmtDate(d.voided.at)} — “{d.voided.reason}”
          </div>
        )}
        <div className="a-players">
          {d.players.map((p) => (
            <div key={p.seat} className="a-player">
              <span className="muted small">{p.seat === 0 ? "White" : "Black"}</span>
              <strong>{p.name}</strong>
              {p.userId ? (
                <button className="link small" onClick={() => open("users", p.userId!)}>
                  {p.wallet ? `${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)}` : `guest ${shortId(p.userId)}`}
                </button>
              ) : (
                <span className="muted small">{p.bot ? "computer" : "empty seat"}</span>
              )}
              <span className="mono">{d.score[p.seat]}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="a-grid2">
        <section className="a-card">
          <h3 className="a-h3">Position {d.game ? `· game ${d.game.gameNumber} · ${d.game.phase.toLowerCase().replace("_", " ")}` : ""}</h3>
          {d.game ? (
            <div className="board-wrap">
              <Board
                board={d.game.board}
                viewer={0}
                theme={theme}
                dice={d.game.dice ? d.game.dice.map((v) => ({ value: v, used: false })) : null}
                diceOwner={d.game.turn === 0 ? "viewer" : "opponent"}
                cube={{ value: d.game.cubeValue, owner: null, disabled: false }}
                selectable={new Set()}
                selected={null}
                targets={new Map()}
              />
            </div>
          ) : (
            <Empty>No game started.</Empty>
          )}
          {d.results.length > 0 && (
            <table className="a-table compact">
              <tbody>
                {d.results.map((r) => (
                  <tr key={r.gameNumber}>
                    <td>Game {r.gameNumber}</td>
                    <td>{d.players[r.winner].name}</td>
                    <td>{r.kind}</td>
                    <td className="num mono">+{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="a-card">
          <h3 className="a-h3">Event log ({d.events.length} most recent)</h3>
          <ol className="a-events">
            {events.map((e) => (
              <li key={e.seq}>
                <span className="mono muted">#{e.seq}</span> <strong>{e.type}</strong>{" "}
                <span className="muted small">{new Date(e.serverTime).toLocaleTimeString()}</span>
                <code>{JSON.stringify(e.payload)}</code>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {d.audit.length > 0 && (
        <section className="a-card">
          <h3 className="a-h3">Admin history</h3>
          <ul className="a-list">
            {d.audit.map((e) => (
              <li key={e.id}>
                <strong>{e.action}</strong> <span className="muted small">{fmtDate(e.at)}</span> {e.reason && <span className="muted">“{e.reason}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog === "void" && (
        <ActionDialog
          title={`Void match ${d.id}?`}
          description="The match stays on record as VOIDED with your reason; it no longer counts in either player's stats. Free matches hold no tokens, so nothing is reversed in the ledger."
          confirmLabel="Void match"
          danger
          signed
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const proof = await sign({ action: "MATCH_VOID", target: `match:${d.id}`, reason });
            await api(`/api/admin/matches/${d.id}/void`, { method: "POST", body: { reason, ...proof } });
            load();
          }}
        />
      )}
      {dialog === "cancel" && (
        <ActionDialog
          title="Close this waiting table?"
          confirmLabel="Close table"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api(`/api/admin/matches/${d.id}/cancel`, { method: "POST", body: { reason } });
            load();
          }}
        />
      )}
    </div>
  );
}
