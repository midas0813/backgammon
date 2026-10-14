"use client";

import { createContext, useContext, useState } from "react";
import Modal from "@/components/Modal";
import type { Proof, SignDetails } from "@/lib/client/admin";

export interface AdminMe {
  name: string;
  wallet: string;
  role: "owner" | "operator" | "finance" | "viewer";
  permissions: string[];
  since: string;
}

export const AdminCtx = createContext<{ me: AdminMe; sign: (d: SignDetails) => Promise<Proof>; open: (s: string, id?: string) => void } | null>(null);
export function useAdmin() {
  const c = useContext(AdminCtx);
  if (!c) throw new Error("AdminCtx missing");
  return { ...c, can: (p: string) => c.me.permissions.includes(p) };
}

const STATUS_TONE: Record<string, string> = {
  active: "ok",
  suspended: "bad",
  WAITING: "info",
  ACTIVE: "ok",
  COMPLETED: "muted",
  CANCELLED: "muted",
  VOIDED: "bad",
  OPEN: "warn",
  IN_REVIEW: "info",
  RESOLVED: "ok",
  REJECTED: "muted",
  PENDING: "warn",
  APPROVED: "ok",
  CREDITED: "ok",
  REVIEW: "bad",
  FAILED: "bad",
};

/** Status always has a text label; tone is a secondary cue. */
export function Status({ value }: { value: string }) {
  return <span className={`a-status ${STATUS_TONE[value] ?? "muted"}`}>{value.replace(/_/g, " ").toLowerCase()}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="a-empty">{children}</p>;
}

/**
 * Confirmation with a required reason. `signed` actions are confirmed in the admin's wallet; the
 * dialog says so before the wallet pops up.
 */
export function ActionDialog({
  title,
  description,
  confirmLabel,
  danger,
  signed,
  reasonRequired = true,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  signed?: boolean;
  reasonRequired?: boolean;
  children?: React.ReactNode;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      {description && <div className="muted small">{description}</div>}
      {children}
      {reasonRequired && (
        <label>
          Reason (saved in the audit log)
          <textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </label>
      )}
      {signed && <p className="muted small">Your wallet will ask you to sign a message naming this action. Signing is free.</p>}
      {error && <p className="err small">{error}</p>}
      <div className="grid2">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={`btn ${danger ? "danger" : "primary"}`} onClick={submit} disabled={busy || (reasonRequired && reason.trim().length < 3)}>
          {busy ? (signed ? "Waiting for signature…" : "Working…") : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** One-series daily column chart: hover a column for its value; the table view carries every number. */
export function DailyBars({ title, data, color }: { title: string; data: { day: string; n: number }[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 560,
    H = 180,
    L = 32,
    B = 22,
    T = 10;
  const max = Math.max(1, ...data.map((d) => d.n));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * 4;
  const slot = (W - L) / Math.max(1, data.length);
  const bw = Math.min(24, slot - 6);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const total = data.reduce((s, d) => s + d.n, 0);
  return (
    <figure className="a-chart">
      <figcaption>
        <span>
          <strong>{title}</strong> <span className="muted small">· last {data.length} days · {total} total</span>
        </span>
        <button className="btn sm ghost" onClick={() => setTable((v) => !v)}>
          {table ? "Chart" : "Table"}
        </button>
      </figcaption>
      {table ? (
        <table className="a-table compact">
          <thead>
            <tr>
              <th>Day (UTC)</th>
              <th className="num">Count</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td className="num">{d.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="a-chart-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, last ${data.length} days`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <line x1={L} x2={W} y1={y(step * i)} y2={y(step * i)} className="grid" />
                <text x={L - 6} y={y(step * i) + 4} textAnchor="end" className="tick">
                  {step * i}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = L + i * slot + (slot - bw) / 2;
              const h = H - B - y(d.n);
              const r = Math.min(4, h);
              return (
                <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
                  {d.n > 0 && (
                    <path
                      d={`M${x},${H - B} V${H - B - h + r} Q${x},${H - B - h} ${x + r},${H - B - h} H${x + bw - r} Q${x + bw},${H - B - h} ${x + bw},${H - B - h + r} V${H - B} Z`}
                      fill={color}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  {(i === 0 || i === data.length - 1 || i % 3 === 0) && (
                    <text x={L + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="tick">
                      {d.day.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="a-tip" style={{ left: `${((L + hover * slot + slot / 2) / W) * 100}%` }}>
              <strong>{data[hover].n}</strong> <span className="muted">{data[hover].day}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
