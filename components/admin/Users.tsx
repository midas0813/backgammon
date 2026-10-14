"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/client/api";
import { fmtDate, shortWallet } from "@/lib/client/admin";
import { formatTokens } from "@/lib/fees";
import type { searchUsers, userDetail } from "@/lib/server/admin/service";
import { ActionDialog, Empty, Status, useAdmin } from "./ui";

type List = Awaited<ReturnType<typeof searchUsers>>;
type Detail = Awaited<ReturnType<typeof userDetail>>;

export default function Users({ id }: { id?: string }) {
  return id ? <UserDetail id={id} /> : <UserList />;
}

function UserList() {
  const { open } = useAdmin();
  const [q, setQ] = useState("");
  const [data, setData] = useState<List | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      api<List>(`/api/admin/users?q=${encodeURIComponent(q)}`).then(setData).catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="a-stack">
      <input className="a-search" placeholder="Search by name, wallet address or user ID…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {!data ? (
        <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
      ) : data.users.length === 0 ? (
        <Empty>No players match “{q}”.</Empty>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Wallet</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => open("users", u.id)}>
                  <td>
                    <span className="a-who">
                      <Avatar name={u.name} src={u.avatarUrl} size={28} />
                      <span>
                        {u.name}
                        {u.role && <span className="a-role">{u.role}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="mono">{u.wallet ? shortWallet(u.wallet) : <span className="muted">guest</span>}</td>
                  <td>
                    <Status value={u.status} />
                  </td>
                  <td className="muted">{fmtDate(u.createdAt)}</td>
                  <td className="muted">{fmtDate(u.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserDetail({ id }: { id: string }) {
  const { open, can, sign, me } = useAdmin();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "suspend" | "unsuspend" | "logout" | "reset" | "adjust">(null);
  const [days, setDays] = useState("7");
  const [reset, setReset] = useState({ name: true, avatar: false, bio: false });
  const [adj, setAdj] = useState({ amount: "", kind: "PAID_AVAILABLE" });
  const load = useCallback(() => {
    api<Detail>(`/api/admin/users/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <p className="err">{error}</p>;
  if (!d) return <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />;
  const u = d.user;
  const self = u.wallet?.toLowerCase() === me.wallet.toLowerCase();
  const post = (action: string, body: object) => api(`/api/admin/users/${id}/${action}`, { method: "POST", body });

  return (
    <div className="a-stack">
      <button className="link" onClick={() => open("users")}>
        ← All players
      </button>
      <section className="a-card a-person">
        <Avatar name={u.name} src={u.avatarUrl} size={64} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>
            {u.name} {u.role && <span className="a-role">{u.role}</span>}
          </h2>
          <div className="mono small muted">{u.wallet ?? "Guest (no wallet)"}</div>
          <div className="mono small muted">ID {u.id}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <Status value={u.status} />
            {u.suspendedUntil && <span className="muted small">until {fmtDate(u.suspendedUntil)}</span>}
            {u.suspendedReason && <span className="muted small">· “{u.suspendedReason}”</span>}
          </div>
        </div>
        {can("users.moderate") && !self && (
          <div className="a-actions">
            {u.status === "suspended" ? (
              <button className="btn sm" onClick={() => setDialog("unsuspend")}>
                Lift suspension
              </button>
            ) : (
              <button className="btn sm danger" onClick={() => setDialog("suspend")}>
                Suspend…
              </button>
            )}
            <button className="btn sm" onClick={() => setDialog("logout")}>
              Force logout
            </button>
            <button className="btn sm" onClick={() => setDialog("reset")}>
              Reset profile…
            </button>
          </div>
        )}
      </section>

      <div className="a-grid2">
        <section className="a-card">
          <h3 className="a-h3">Profile & activity</h3>
          <dl className="a-dl">
            <dt>Joined</dt>
            <dd>{fmtDate(u.createdAt)}</dd>
            <dt>Last seen</dt>
            <dd>{fmtDate(u.lastSeenAt)}</dd>
            <dt>Country</dt>
            <dd>{u.country || "—"}</dd>
            <dt>Bio</dt>
            <dd>{u.bio || "—"}</dd>
            <dt>Matches</dt>
            <dd>
              {d.stats.played} played · {d.stats.wins} won · {d.stats.winRate}% · best streak {d.stats.bestStreak}
            </dd>
          </dl>
        </section>
        <section className="a-card">
          <div className="spread">
            <h3 className="a-h3">Balances</h3>
            {can("finance.adjust") && (
              <button className="btn sm" onClick={() => setDialog("adjust")}>
                Request adjustment…
              </button>
            )}
          </div>
          <dl className="a-dl">
            <dt>Tokens available</dt>
            <dd className="mono">{formatTokens(d.balances.available)}</dd>
            <dt>Practice credits</dt>
            <dd className="mono">{formatTokens(d.balances.freeCredits)}</dd>
            <dt>Reserved</dt>
            <dd className="mono">
              {formatTokens(d.balances.matchReserved)} match · {formatTokens(d.balances.withdrawalReserved)} withdrawal
            </dd>
          </dl>
          {d.transactions && (
            <details>
              <summary className="muted small">Last {d.transactions.length} ledger transactions</summary>
              <table className="a-table compact">
                <tbody>
                  {d.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{fmtDate(t.createdAt)}</td>
                      <td>{t.type}</td>
                      <td className="num mono">{formatTokens(t.entries.reduce((s, e) => s + e.amount, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      </div>

      <section className="a-card">
        <h3 className="a-h3">Recent matches</h3>
        {d.matches.length === 0 ? (
          <Empty>No matches yet.</Empty>
        ) : (
          <table className="a-table compact">
            <tbody>
              {d.matches.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => open("matches", m.id)}>
                  <td className="mono">{m.id}</td>
                  <td>
                    {m.names[0]} vs {m.names[1]}
                  </td>
                  <td>{m.mode}</td>
                  <td>
                    <Status value={m.status} />
                  </td>
                  <td className="muted">{fmtDate(m.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="a-grid2">
        <section className="a-card">
          <h3 className="a-h3">Reports by this player</h3>
          {d.reports.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="a-list">
              {d.reports.map((r) => (
                <li key={r.id}>
                  <button className="link mono" onClick={() => open("reports", r.id)}>
                    {r.id}
                  </button>{" "}
                  {r.category} <Status value={r.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="a-card">
          <h3 className="a-h3">Admin history</h3>
          {d.audit.length === 0 ? (
            <Empty>No admin actions on this player.</Empty>
          ) : (
            <ul className="a-list">
              {d.audit.map((e) => (
                <li key={e.id}>
                  <strong>{e.action}</strong> <span className="muted small">{fmtDate(e.at)}</span>
                  {e.reason && <div className="muted small">“{e.reason}”</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {dialog === "suspend" && (
        <ActionDialog
          title={`Suspend ${u.name}?`}
          description="They are signed out everywhere and cannot sign in with their wallet or start or join matches until the suspension ends."
          confirmLabel="Suspend"
          danger
          signed
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const target = `user:${id}`;
            const proof = await sign({ action: "USER_SUSPEND", target, reason });
            await post("suspend", { reason, days: days === "" ? null : Number(days), ...proof });
            load();
          }}
        >
          <label>
            Length
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="">Until lifted</option>
            </select>
          </label>
        </ActionDialog>
      )}
      {dialog === "unsuspend" && (
        <ActionDialog
          title={`Lift ${u.name}'s suspension?`}
          confirmLabel="Lift suspension"
          signed
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const proof = await sign({ action: "USER_UNSUSPEND", target: `user:${id}`, reason });
            await post("unsuspend", { reason, ...proof });
            load();
          }}
        />
      )}
      {dialog === "logout" && (
        <ActionDialog
          title={`Sign ${u.name} out everywhere?`}
          description="Ends all their sessions. A wallet account can sign in again; a guest becomes a new guest."
          confirmLabel="Force logout"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await post("logout", { reason });
            load();
          }}
        />
      )}
      {dialog === "reset" && (
        <ActionDialog
          title="Reset profile"
          description="Use for names, photos or bios that break the rules."
          confirmLabel="Reset"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await post("reset", { reason, ...reset });
            load();
          }}
        >
          {(["name", "avatar", "bio"] as const).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={reset[k]} onChange={(e) => setReset({ ...reset, [k]: e.target.checked })} />
              {k === "name" ? "Name (back to a default)" : k === "avatar" ? "Photo (delete)" : "Bio (clear)"}
            </label>
          ))}
        </ActionDialog>
      )}
      {dialog === "adjust" && (
        <ActionDialog
          title={`Request a balance adjustment for ${u.name}`}
          description="A different admin with the Finance or Owner role must approve it before the ledger changes."
          confirmLabel="Request"
          signed
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const amount = Math.round(Number(adj.amount) * 100);
            if (!Number.isFinite(amount) || amount === 0) throw new Error("Enter a token amount, e.g. 25 or -10");
            const proof = await sign({ action: "ADJUST_REQUEST", target: `user:${id}:${adj.kind}:${amount}`, reason });
            await api("/api/admin/finance/adjustments", { method: "POST", body: { userId: id, accountKind: adj.kind, amount, reason, ...proof } });
          }}
        >
          <div className="grid2">
            <label>
              Account
              <select value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}>
                <option value="PAID_AVAILABLE">Tokens</option>
                <option value="FREE_CREDITS">Practice credits</option>
              </select>
            </label>
            <label>
              Amount (tokens, − to remove)
              <input inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} placeholder="25.00" />
            </label>
          </div>
        </ActionDialog>
      )}
    </div>
  );
}
