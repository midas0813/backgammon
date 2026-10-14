"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import type { listReports, reportDetail } from "@/lib/server/admin/service";
import { Empty, Status, useAdmin } from "./ui";

type List = Awaited<ReturnType<typeof listReports>>;
type Detail = Awaited<ReturnType<typeof reportDetail>>;
const STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED", ""];

export default function Reports({ id }: { id?: string }) {
  return id ? <ReportDetail id={id} /> : <ReportList />;
}

function ReportList() {
  const { open } = useAdmin();
  const [status, setStatus] = useState("OPEN");
  const [data, setData] = useState<List | null>(null);
  useEffect(() => {
    setData(null);
    api<List>(`/api/admin/reports?status=${status}`).then(setData).catch(() => {});
  }, [status]);
  return (
    <div className="a-stack">
      <div className="a-filters" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? s.replace("_", " ").toLowerCase() : "all"}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
      ) : data.reports.length === 0 ? (
        <Empty>No reports here. 🎉</Empty>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>From</th>
                <th>Category</th>
                <th>Problem</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => open("reports", r.id)}>
                  <td className="mono">{r.id}</td>
                  <td>{r.userName}</td>
                  <td>{r.category.toLowerCase()}</td>
                  <td className="a-clip">{r.reason}</td>
                  <td>
                    <Status value={r.status} />
                  </td>
                  <td className="muted">{r.assignedName ?? "—"}</td>
                  <td className="muted">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportDetail({ id }: { id: string }) {
  const { open, can } = useAdmin();
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Detail>(`/api/admin/reports/${id}`)
      .then((x) => {
        setD(x);
        setResolution(x.report.resolution ?? "");
      })
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  const update = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/reports/${id}`, { method: "POST", body });
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };
  if (!d) return error ? <p className="err">{error}</p> : <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />;
  const r = d.report;
  const manage = can("disputes.manage");
  return (
    <div className="a-stack">
      <button className="link" onClick={() => open("reports")}>
        ← All reports
      </button>
      <section className="a-card">
        <div className="spread">
          <h2 className="mono">{r.id}</h2>
          <Status value={r.status} />
        </div>
        <dl className="a-dl">
          <dt>From</dt>
          <dd>
            <button className="link" onClick={() => open("users", r.userId)}>
              {r.userName}
            </button>
          </dd>
          <dt>Category</dt>
          <dd>{r.category.toLowerCase()}</dd>
          {r.matchId && (
            <>
              <dt>Match</dt>
              <dd>
                <button className="link mono" onClick={() => open("matches", r.matchId!)}>
                  {r.matchId}
                </button>
              </dd>
            </>
          )}
          {r.transactionId && (
            <>
              <dt>Transaction</dt>
              <dd className="mono">{r.transactionId}</dd>
            </>
          )}
          <dt>Sent</dt>
          <dd>{fmtDate(r.createdAt)}</dd>
          <dt>Assigned</dt>
          <dd>{r.assignedName ?? "Nobody yet"}</dd>
        </dl>
        <blockquote className="a-quote">{r.reason}</blockquote>
      </section>

      <section className="a-card">
        <h3 className="a-h3">Internal notes</h3>
        {d.notes.length === 0 ? (
          <Empty>No notes yet.</Empty>
        ) : (
          <ul className="a-list">
            {d.notes.map((n) => (
              <li key={n.id}>
                <strong>{n.authorName}</strong> <span className="muted small">{fmtDate(n.createdAt)}</span>
                <div>{n.note}</div>
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <>
            <textarea rows={2} placeholder="Add a note for other admins (players never see these)…" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="a-actions">
              <button className="btn sm" disabled={busy || !note.trim()} onClick={() => update({ note })}>
                Add note
              </button>
              {!r.assignedTo && (
                <button className="btn sm" disabled={busy} onClick={() => update({ assignToMe: true, status: "IN_REVIEW" })}>
                  Assign to me
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {manage && (
        <section className="a-card">
          <h3 className="a-h3">Resolution</h3>
          <textarea rows={3} placeholder="What was found and what was done (required to close)…" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          <div className="a-actions">
            <button className="btn sm primary" disabled={busy} onClick={() => update({ status: "RESOLVED", resolution })}>
              Resolve
            </button>
            <button className="btn sm" disabled={busy} onClick={() => update({ status: "REJECTED", resolution })}>
              Reject
            </button>
            {(r.status === "RESOLVED" || r.status === "REJECTED") && (
              <button className="btn sm ghost" disabled={busy} onClick={() => update({ status: "IN_REVIEW" })}>
                Reopen
              </button>
            )}
          </div>
          {error && <p className="err small">{error}</p>}
        </section>
      )}
    </div>
  );
}
