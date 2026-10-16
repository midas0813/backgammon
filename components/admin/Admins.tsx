"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import type { listAdmins } from "@/lib/server/admin/service";
import { ActionDialog, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof listAdmins>>;
const ROLE_INFO: Record<string, string> = {
  owner: "Everything, including settings and managing admins",
  operator: "Players, matches and reports (support)",
  finance: "Ledger, deposits, withdrawals, adjustments",
  viewer: "Read-only",
};

export default function Admins() {
  const { open, sign, me } = useAdmin();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grant, setGrant] = useState({ wallet: "", role: "operator" });
  const [dialog, setDialog] = useState<null | { kind: "grant" } | { kind: "revoke"; userId: string; name: string }>(null);
  const load = useCallback(() => {
    api<Data>("/api/admin/admins")
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  if (!d) return error ? <p className="err">{error}</p> : <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />;
  return (
    <div className="a-stack">
      <section className="a-card">
        <h3 className="a-h3">Admins</h3>
        <table className="a-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Wallet</th>
              <th>Role</th>
              <th>Granted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.admins.map((a) => (
              <tr key={a.userId}>
                <td>
                  <button className="link" onClick={() => open("users", a.userId)}>
                    {a.name}
                  </button>
                </td>
                <td className="mono">{a.wallet}</td>
                <td>
                  <span className="a-role">{a.role}</span>
                </td>
                <td className="muted">
                  {fmtDate(a.grantedAt)} · by {a.grantedBy}
                </td>
                <td>
                  {a.wallet?.toLowerCase() !== me.wallet.toLowerCase() && (
                    <button className="btn sm ghost" onClick={() => setDialog({ kind: "revoke", userId: a.userId, name: a.name })}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="a-card">
        <h3 className="a-h3">Add or change an admin</h3>
        <p className="muted small">The person must have signed in with this wallet at least once. Giving someone a new role replaces their old one.</p>
        <div className="a-actions">
          <input
            className="a-search mono"
            placeholder="0x… wallet address"
            value={grant.wallet}
            onChange={(e) => setGrant({ ...grant, wallet: e.target.value.trim() })}
          />
          <select value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value })}>
            {Object.keys(ROLE_INFO).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button className="btn sm primary" disabled={!/^0x[0-9a-fA-F]{40}$/.test(grant.wallet)} onClick={() => setDialog({ kind: "grant" })}>
            Grant…
          </button>
        </div>
        <ul className="a-list">
          {Object.entries(ROLE_INFO).map(([r, t]) => (
            <li key={r}>
              <span className="a-role">{r}</span> {t}
            </li>
          ))}
        </ul>
      </section>

      {dialog?.kind === "grant" && (
        <ActionDialog
          title={`Make ${grant.wallet.slice(0, 6)}…${grant.wallet.slice(-4)} ${grant.role}?`}
          confirmLabel="Grant role"
          signed
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            // The server names the target by user ID; look it up through search first.
            const found = await api<{ users: { id: string; wallet: string | null }[] }>(`/api/admin/users?q=${grant.wallet}`);
            const target = found.users.find((u) => u.wallet?.toLowerCase() === grant.wallet.toLowerCase());
            if (!target) throw new Error("No account uses this wallet yet. They must sign in once first.");
            const proof = await sign({ action: "ROLE_GRANT", target: `user:${target.id}:${grant.role}`, reason });
            await api("/api/admin/admins", { method: "POST", body: { wallet: grant.wallet, role: grant.role, reason, ...proof } });
            setGrant({ wallet: "", role: "operator" });
            load();
          }}
        />
      )}
      {dialog?.kind === "revoke" && (
        <ActionDialog
          title={`Remove ${dialog.name}'s admin role?`}
          description="Their admin sessions end immediately. Their player account is not affected."
          confirmLabel="Remove role"
          danger
          signed
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const proof = await sign({ action: "ROLE_REVOKE", target: `user:${dialog.userId}`, reason });
            await api(`/api/admin/admins/${dialog.userId}/revoke`, { method: "POST", body: { reason, ...proof } });
            load();
          }}
        />
      )}
    </div>
  );
}
