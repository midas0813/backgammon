"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ClientApiError, api } from "@/lib/client/api";

interface Report {
  referenceId: string;
  category: string;
  status: string;
  matchId: string | null;
  createdAt: string;
}

const CATEGORIES = [
  { id: "GAME", label: "A game or match" },
  { id: "PAYMENT", label: "Tokens or payments" },
  { id: "ACCOUNT", label: "My account or wallet" },
  { id: "OTHER", label: "Something else" },
];

function SupportInner({ history }: { history: { matchId: string; label: string }[] }) {
  const params = useSearchParams();
  const preset = params.get("report");
  const [category, setCategory] = useState("GAME");
  const [matchId, setMatchId] = useState(preset ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  const load = useCallback(() => {
    api<Report[]>("/api/disputes")
      .then(setReports)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const options = preset && !history.some((h) => h.matchId === preset) ? [{ matchId: preset, label: `Match ${preset}` }, ...history] : history;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ referenceId: string }>("/api/disputes", {
        method: "POST",
        body: { category, reason, matchId: category === "GAME" && matchId ? matchId : undefined },
      });
      setMsg({ ok: true, text: `Thanks — your report ${r.referenceId} was received. Keep this reference.` });
      setReason("");
      load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ClientApiError ? err.message : "Could not send the report" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" id="support">
      <h2>Help &amp; report a problem</h2>
      <p className="muted small">
        Something wrong with a game, a result or your account? Tell us what happened. Each report gets a reference ID.
      </p>
      <form className="auth-form" onSubmit={submit}>
        <label>
          What is it about?
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {category === "GAME" && options.length > 0 && (
          <label>
            Which match?
            <select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
              <option value="">Not about a specific match</option>
              {options.map((h) => (
                <option key={h.matchId} value={h.matchId}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          What happened?
          <textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="Describe the problem and when it happened" />
        </label>
        {msg && <div className={`toast-inline ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
        <button className="btn primary" disabled={busy || reason.trim().length < 5}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </form>
      {reports.length > 0 && (
        <ul className="list small">
          {reports.map((r) => (
            <li key={r.referenceId}>
              <span className="mono">{r.referenceId}</span>
              <span className="muted">{new Date(r.createdAt).toLocaleDateString()}</span>
              <span className="badge">{r.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SupportCard(props: { history: { matchId: string; label: string }[] }) {
  return (
    <Suspense>
      <SupportInner {...props} />
    </Suspense>
  );
}
