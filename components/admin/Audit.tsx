"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import type { listAuditAdmin } from "@/lib/server/admin/service";
import { Empty, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof listAuditAdmin>>;

export default function Audit() {
  const { open } = useAdmin();
  const [d, setD] = useState<Data | null>(null);
  const [type, setType] = useState("");
  useEffect(() => {
    api<Data>(`/api/admin/audit?targetType=${type}`).then(setD).catch(() => {});
  }, [type]);
  const go = (t?: string, id?: string) => {
    if (t === "user" && id) open("users", id);
    else if (t === "match" && id) open("matches", id);
    else if (t === "report" && id) open("reports", id);
  };
  return (
    <div className="a-stack">
      <div className="a-filters" role="group" aria-label="Target">
        {["", "user", "match", "report", "adjustment", "settings", "announcement"].map((t) => (
          <button key={t} className="chip" aria-pressed={type === t} onClick={() => setType(t)}>
            {t || "all"}
          </button>
        ))}
      </div>
      {d?.scope === "own" && <p className="muted small">Your role shows only your own actions.</p>}
      {!d ? (
        <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
      ) : d.entries.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Signed</th>
              </tr>
            </thead>
            <tbody>
              {d.entries.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{fmtDate(e.at)}</td>
                  <td>
                    {e.actorName}
                    {e.actorRole && <span className="a-role">{e.actorRole}</span>}
                  </td>
                  <td>
                    <strong>{e.action}</strong>
                  </td>
                  <td>
                    {e.targetType ? (
                      <button className="link mono small" onClick={() => go(e.targetType, e.targetId)}>
                        {e.targetType}:{e.targetId?.slice(0, 12)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="a-clip">{e.reason ?? ""}</td>
                  <td title={e.signature ?? ""}>{e.signature ? "✓ wallet" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
