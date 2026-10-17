"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import type { listBeta } from "@/lib/server/admin/service";
import { Empty, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof listBeta>>;

/** Invite codes per community (with sign-ups) and the feedback inbox. */
export default function Beta() {
  const { can, open } = useAdmin();
  const [d, setD] = useState<Data | null>(null);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Data>("/api/admin/beta")
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (!d) return <div className="skeleton" style={{ height: 240, borderRadius: 12 }} />;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="a-stack">
      <section className="a-card">
        <h3 className="a-h3">Invite codes</h3>
        <p className="muted small">
          Share a link per community to see where players come from.{" "}
          {d.inviteOnly ? "The beta is invite-only: new accounts need a valid code." : "Codes are optional right now (Settings → invite-only)."}
        </p>
        {can("settings.manage") && (
          <form
            className="a-actions"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await api("/api/admin/beta/codes", { method: "POST", body: { label, code: code || undefined, maxUses: maxUses || undefined } });
                setLabel("");
                setCode("");
                setMaxUses("");
                load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not create");
              }
            }}
          >
            <input placeholder="Community (e.g. Discord)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} />
            <input placeholder="Max uses (optional)" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            <button className="btn sm primary" disabled={label.trim().length < 2}>
              Create code
            </button>
          </form>
        )}
        {error && <p className="err small">{error}</p>}
        {d.codes.length === 0 ? (
          <Empty>No codes yet.</Empty>
        ) : (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Community</th>
                  <th className="num">Accounts</th>
                  <th className="num">Uses</th>
                  <th>Link</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.codes.map((c) => (
                  <tr key={c.code} style={c.active ? undefined : { opacity: 0.5 }}>
                    <td className="mono">{c.code}</td>
                    <td>{c.label}</td>
                    <td className="num">{c.signups}</td>
                    <td className="num">
                      {c.uses}
                      {c.maxUses ? ` / ${c.maxUses}` : ""}
                    </td>
                    <td>
                      <button className="link small" onClick={() => navigator.clipboard?.writeText(`${origin}/?invite=${c.code}`)}>
                        Copy link
                      </button>
                    </td>
                    <td>
                      {can("settings.manage") && (
                        <button
                          className="btn sm ghost"
                          onClick={() => api(`/api/admin/beta/codes/${c.code}`, { method: "POST", body: { active: !c.active } }).then(load)}
                        >
                          {c.active ? "Disable" : "Enable"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="a-card">
        <h3 className="a-h3">Feedback ({d.feedback.filter((f) => f.status === "NEW").length} new)</h3>
        {d.feedback.length === 0 ? (
          <Empty>No feedback yet.</Empty>
        ) : (
          <ol className="a-events">
            {d.feedback.map((f) => (
              <li key={f.id} style={f.status === "DONE" ? { opacity: 0.55 } : undefined}>
                <strong>{f.kind}</strong> <span className="muted small">{fmtDate(f.createdAt)}</span>{" "}
                {f.userId ? (
                  <button className="link small" onClick={() => open("users", f.userId!)}>
                    {f.userName}
                  </button>
                ) : (
                  <span className="muted small">{f.userName}</span>
                )}
                {f.path && <span className="muted small"> · {f.path}</span>}
                <code>{f.message}</code>
                {can("disputes.manage") && f.status !== "DONE" && (
                  <button
                    className="btn sm ghost"
                    onClick={() => api(`/api/admin/beta/feedback/${f.id}`, { method: "POST", body: { status: "DONE" } }).then(load)}
                  >
                    Mark done
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
