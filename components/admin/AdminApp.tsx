"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Brand } from "@/components/BrandMark";
import WalletButton from "@/components/WalletButton";
import { ClientApiError, api } from "@/lib/client/api";
import { fmtDate, shortWallet, useAdminSigner } from "@/lib/client/admin";
import Admins from "./Admins";
import Audit from "./Audit";
import Dashboard from "./Dashboard";
import FairPlay from "./FairPlay";
import Finance from "./Finance";
import Matches from "./Matches";
import Prizes from "./Prizes";
import Reports from "./Reports";
import Settings from "./Settings";
import Users from "./Users";
import { AdminCtx, type AdminMe } from "./ui";

interface Session {
  wallet: string | null;
  admin: AdminMe | null;
}

const SECTIONS = [
  { id: "dashboard", label: "Dashboard", perm: "dashboard.view", icon: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z" },
  { id: "users", label: "Players", perm: "users.view", icon: "M16 11a4 4 0 1 0-8 0M4 21c1-4 4-6 8-6s7 2 8 6" },
  { id: "matches", label: "Matches", perm: "matches.view", icon: "M4 4h16v16H4zM4 12h16M12 4v16" },
  { id: "reports", label: "Reports", perm: "disputes.view", icon: "M4 4h16v12H8l-4 4z" },
  { id: "fairplay", label: "Fair play", perm: "matches.view", icon: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6zM9 12l2 2 4-4" },
  { id: "finance", label: "Finance", perm: "finance.view", icon: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  { id: "prizes", label: "Prizes", perm: "finance.view", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" },
  {
    id: "settings",
    label: "Settings",
    perm: "dashboard.view",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  },
  { id: "admins", label: "Admins", perm: "admins.manage", icon: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" },
  { id: "audit", label: "Audit log", perm: "dashboard.view", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
];

function parseHash(hash: string): [string, string | undefined] {
  const [s, id] = hash.replace(/^#/, "").split("/");
  return [s || "dashboard", id || undefined];
}

/** The section in the address bar (#users/<id>), followed as it changes. */
function useHash() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => window.location.hash,
    () => "",
  );
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const hash = useHash();
  const route = useMemo(() => parseHash(hash), [hash]);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    try {
      setSession(await api<Session>("/api/admin/session"));
    } catch {
      setSession({ wallet: null, admin: null });
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: state is set after the request returns
    load();
  }, [load]);

  // An expired admin session shows the unlock screen again instead of broken sections.
  useEffect(() => {
    if (!session?.admin) return;
    const t = window.setInterval(async () => {
      const s = await api<Session>("/api/admin/session").catch(() => null);
      if (s && !s.admin) {
        setExpired(true);
        setSession(s);
      }
    }, 60_000);
    return () => window.clearInterval(t);
  }, [session?.admin]);

  const sign = useAdminSigner(session?.wallet ?? null);
  const open = useCallback((s: string, id?: string) => {
    window.location.hash = id ? `${s}/${id}` : s;
    window.scrollTo({ top: 0 });
  }, []);
  const admin = session?.admin ?? null;
  const ctx = useMemo(() => (admin ? { me: admin, sign, open } : null), [admin, sign, open]);

  const unlock = async () => {
    setBusy(true);
    setUnlockError(null);
    try {
      const proof = await sign({ action: "ADMIN_SIGN_IN" });
      await api("/api/admin/signin", { method: "POST", body: proof });
      setExpired(false);
      await load();
    } catch (e) {
      setUnlockError(
        e instanceof ClientApiError && e.status === 404 ? "This wallet does not have admin access." : e instanceof Error ? e.message : "Could not unlock",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!session)
    return (
      <div className="a-gate">
        <div className="skeleton" style={{ width: 360, height: 220, borderRadius: 18 }} />
      </div>
    );

  if (!ctx) {
    return (
      <main className="a-gate">
        <div className="a-gate-card">
          <Link href="/home" className="brand">
            <Brand />
          </Link>
          <h1>Admin</h1>
          {expired && <p className="notice">Your admin session ended. Unlock again to continue.</p>}
          {!session.wallet ? (
            <>
              <p className="muted">Sign in with an admin wallet to continue.</p>
              <WalletButton className="btn primary lg block" label="Connect Wallet" />
            </>
          ) : (
            <>
              <p className="muted">
                Signed in as <span className="mono">{shortWallet(session.wallet)}</span>. Confirm it is you by signing a short message — it is free and sends no
                transaction. The admin session lasts up to 8 hours (30 minutes idle).
              </p>
              <button className="btn primary lg block" onClick={unlock} disabled={busy}>
                {busy ? "Waiting for your wallet…" : "Unlock admin area"}
              </button>
            </>
          )}
          {unlockError && <p className="err small">{unlockError}</p>}
          <Link className="muted small" href="/home">
            ← Back to the app
          </Link>
        </div>
      </main>
    );
  }

  const me = ctx.me;
  const sections = SECTIONS.filter((s) => me.permissions.includes(s.perm));
  const [section, id] = sections.some((s) => s.id === route[0]) ? route : ["dashboard", undefined];
  const title = sections.find((s) => s.id === section)?.label ?? "Dashboard";

  return (
    <AdminCtx.Provider value={ctx}>
      <div className="a-shell">
        <aside className="a-side">
          <Link href="/home" className="brand">
            <Brand />
          </Link>
          <nav aria-label="Admin sections">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} aria-current={section === s.id ? "page" : undefined}>
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d={s.icon} />
                </svg>
                {s.label}
              </a>
            ))}
          </nav>
          <div className="a-me">
            <strong>{me.name}</strong>
            <span className="mono small muted">{shortWallet(me.wallet)}</span>
            <span>
              <span className="a-role">{me.role}</span> <span className="muted small">since {fmtDate(me.since)}</span>
            </span>
            <button
              className="btn sm ghost"
              onClick={async () => {
                await api("/api/admin/signout", { method: "POST" }).catch(() => {});
                load();
              }}
            >
              Lock admin
            </button>
          </div>
        </aside>
        <main className="a-main">
          <header className="a-top">
            <h1>{title}</h1>
          </header>
          {section === "dashboard" && <Dashboard />}
          {section === "users" && <Users id={id} />}
          {section === "matches" && <Matches id={id} />}
          {section === "reports" && <Reports id={id} />}
          {section === "fairplay" && <FairPlay />}
          {section === "finance" && <Finance />}
          {section === "prizes" && <Prizes />}
          {section === "settings" && <Settings />}
          {section === "admins" && <Admins />}
          {section === "audit" && <Audit />}
        </main>
      </div>
    </AdminCtx.Provider>
  );
}
