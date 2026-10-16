"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { useDisconnect } from "wagmi";
import WalletButton, { shortAddress } from "@/components/WalletButton";
import { signOutEverywhere } from "@/components/Web3Provider";
import SupportCard from "@/components/SupportCard";
import ThemePicker from "@/components/ThemePicker";
import { api } from "@/lib/client/api";
import { uploadAvatar } from "@/lib/client/avatar";
import { setMe, useMe, type Profile } from "@/lib/client/me";

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  11155111: "Sepolia",
  84532: "Base Sepolia",
};
const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  10: "https://optimistic.etherscan.io",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  11155111: "https://sepolia.etherscan.io",
  84532: "https://sepolia.basescan.org",
};

function WinRing({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 84 84" width="84" height="84" className="win-ring" aria-label={`Win rate ${pct}%`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
      <circle
        cx="42"
        cy="42"
        r={r}
        fill="none"
        stroke="url(#wr)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 42 42)"
        className="win-ring-arc"
        style={{ "--len": `${c}` } as React.CSSProperties}
      />
      <defs>
        <linearGradient id="wr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#65E2BC" />
          <stop offset="1" stopColor="#F4CF87" />
        </linearGradient>
      </defs>
      <text x="42" y="47" textAnchor="middle" fontSize="17" fontWeight="800" fill="#EDF3F9">
        {pct}%
      </text>
    </svg>
  );
}

export default function ProfilePage() {
  const me = useMe();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", bio: "", country: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);
  // Older match history, loaded a page at a time.
  const [more, setMore] = useState<{ items: Profile["stats"]["history"]; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  if (!me) {
    return (
      <main className="page">
        <div className="card skeleton" style={{ height: 220 }} />
        <div className="card skeleton" style={{ height: 160 }} />
      </main>
    );
  }

  const flash = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    window.setTimeout(() => setMsg(null), 3500);
  };

  const SWITCHES = ["sound", "highContrast", "reducedMotion", "orientation"];
  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    // Switches update instantly; the server's answer confirms (or the old value comes back on error).
    const before = me;
    const instant = Object.fromEntries(Object.entries(patch).filter(([k]) => SWITCHES.includes(k)));
    if (Object.keys(instant).length) setMe({ ...me, ...instant } as Profile);
    try {
      setMe(await api<Profile>("/api/me", { method: "PATCH", body: patch }));
      return true;
    } catch (e) {
      setMe(before);
      flash("err", e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setMe(await uploadAvatar(file));
      flash("ok", "Photo updated");
    } catch (err) {
      flash("err", err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    setUploading(true);
    try {
      setMe(await api<Profile>("/api/me/avatar", { method: "DELETE" }));
    } finally {
      setUploading(false);
    }
  };

  const signOut = async () => {
    await signOutEverywhere();
    disconnect();
    router.push("/");
    router.refresh();
  };

  const st = me.stats;
  const since = new Date(me.registeredAt ?? me.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <main className="page">
      {/* Identity */}
      <section className="card profile-hero">
        <div className="profile-cover" aria-hidden />
        <div className="profile-id">
          <div className="avatar-edit">
            <Avatar name={me.name} src={me.avatarUrl} size={104} />
          </div>
          <div className="profile-photo-actions">
            <button className="btn sm primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : me.avatarUrl ? "Change photo" : "Upload photo"}
            </button>
            {me.avatarUrl && (
              <button className="btn sm ghost" onClick={removePhoto} disabled={uploading}>
                Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
          </div>
        </div>

        {editing ? (
          <form
            className="profile-edit"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save(form)) {
                setEditing(false);
                flash("ok", "Profile saved");
              }
            }}
          >
            <label>
              Display name
              <input value={form.name} maxLength={20} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Country or region
              <input value={form.country} maxLength={40} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Optional" />
            </label>
            <label>
              Bio
              <textarea
                value={form.bio}
                maxLength={160}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Favourite opening? Cube style?"
              />
              <span className="small" style={{ alignSelf: "flex-end" }}>
                {form.bio.length}/160
              </span>
            </label>
            <div className="grid2">
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn primary" disabled={saving || form.name.trim().length < 2}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <div className="profile-info">
            <div className="spread">
              <h1>{me.name}</h1>
              <button
                className="btn sm"
                onClick={() => {
                  setForm({ name: me.name, bio: me.bio, country: me.country });
                  setEditing(true);
                }}
              >
                Edit profile
              </button>
            </div>
            <div className="row">
              {me.registered ? <span className="badge ok">Member</span> : <span className="badge warn">Guest</span>}
              {me.country && <span className="badge">{me.country}</span>}
              <span className="badge">Since {since}</span>
            </div>
            {me.walletAddress && <div className="muted small mono">{shortAddress(me.walletAddress)}</div>}
            <p className={me.bio ? "" : "muted small"}>{me.bio || "No bio yet — tell opponents about your style."}</p>
          </div>
        )}
        {msg && <div className={`toast-inline ${msg.kind}`}>{msg.text}</div>}
      </section>

      {!me.registered && (
        <section className="notice row" style={{ justifyContent: "space-between" }}>
          <span>You&apos;re a guest. Connect your wallet to create your account and keep this profile, photo and stats.</span>
          <WalletButton className="btn sm gold" />
        </section>
      )}

      {/* Stats */}
      <section className="card">
        <h2>Statistics</h2>
        <div className="stats-wrap">
          <WinRing pct={st.winRate} />
          <div className="stat-grid">
            {[
              ["Matches", st.played],
              ["Wins", st.wins],
              ["Losses", st.losses],
              ["Gammons", st.gammons],
              ["Points won", st.points],
              ["Best streak", st.bestStreak],
            ].map(([label, value]) => (
              <div key={label} className="stat">
                <strong className="mono">{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="muted small">Completed online and computer matches. Pass-and-play games are not counted. Ratings arrive with Ranked play.</p>
      </section>

      <section className="card">
        <h2>Match history</h2>
        {st.history.length === 0 ? (
          <div className="empty">
            <p className="muted">No finished matches yet.</p>
            <Link className="btn primary" href="/play">
              Play your first match
            </Link>
          </div>
        ) : (
          <ul className="list">
            {[...st.history, ...(more?.items ?? [])].map((h) => (
              <li key={h.matchId}>
                <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                  <span className={`result-pill ${h.won ? "win" : "loss"}`}>{h.won ? "W" : "L"}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      vs {h.opponent}
                    </span>
                    <span className="muted small">
                      {new Date(h.date).toLocaleDateString()} · {h.targetPoints}-pt
                      {h.reason === "forfeit" ? " · forfeit" : h.reason === "abandoned" ? " · abandoned" : ""}
                    </span>
                  </span>
                </span>
                <Link className="mono" href={`/match/${h.matchId}`} style={{ textDecoration: "none", fontWeight: 700 }}>
                  {h.score[0]}–{h.score[1]}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(more ? more.hasMore : st.historyMore) && (
          <button
            className="btn block"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              try {
                const page = await api<{ items: Profile["stats"]["history"]; hasMore: boolean }>(
                  `/api/me/history?offset=${st.history.length + (more?.items.length ?? 0)}`,
                );
                setMore((m) => ({ items: [...(m?.items ?? []), ...page.items], hasMore: page.hasMore }));
              } finally {
                setLoadingMore(false);
              }
            }}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </section>

      {/* Account wallet */}
      <section className="card" id="wallet">
        <div className="spread">
          <h2>Account wallet</h2>
          {me.registered && <span className="badge ok">Verified by signature</span>}
        </div>
        {me.walletAddress ? (
          <>
            <div className="wallet-id">
              <span className="wallet-dot" />
              <span className="mono" style={{ wordBreak: "break-all" }}>
                {me.walletAddress}
              </span>
            </div>
            <div className="row">
              <button
                className="btn sm"
                onClick={() => {
                  navigator.clipboard?.writeText(me.walletAddress!).then(() => setCopied(true));
                  window.setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied ✓" : "Copy address"}
              </button>
              {me.chainId && EXPLORERS[me.chainId] && (
                <a className="btn sm ghost" href={`${EXPLORERS[me.chainId]}/address/${me.walletAddress}`} target="_blank" rel="noreferrer">
                  View on explorer
                </a>
              )}
              <WalletButton />
            </div>
            <p className="muted small">
              This address is your account. Signed in on {CHAIN_NAMES[me.chainId ?? 0] ?? "an EVM network"}
              {me.registeredAt ? ` · member since ${new Date(me.registeredAt).toLocaleDateString()}` : ""}. Keep your wallet&apos;s recovery phrase safe —
              without the wallet you can&apos;t sign in.
            </p>
          </>
        ) : (
          <>
            <p className="muted small">Connect a wallet and sign one free message to turn this guest profile into your account.</p>
            <WalletButton className="btn gold" />
          </>
        )}
      </section>

      <section className="card">
        <h2>Board appearance</h2>
        <p className="muted small">Changes only your view, even mid-game.</p>
        <ThemePicker previewFirst mirror={me.orientation === "left"} />
      </section>

      <section className="card">
        <h2>Settings</h2>
        <label className="toggle">
          <span>
            <strong>Reduce motion</strong>
            <span className="muted small" style={{ display: "block" }}>
              Turns off dice, checker and page animations.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={me.reducedMotion} onChange={(e) => save({ reducedMotion: e.target.checked })} />
        </label>
        <label className="toggle">
          <span>
            <strong>Sound</strong>
            <span className="muted small" style={{ display: "block" }}>
              Dice, moves and a chime when it&apos;s your turn.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={me.sound} onChange={(e) => save({ sound: e.target.checked })} />
        </label>
        <label className="toggle">
          <span>
            <strong>High contrast</strong>
            <span className="muted small" style={{ display: "block" }}>
              Brighter text, stronger outlines and borders.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={me.highContrast} onChange={(e) => save({ highContrast: e.target.checked })} />
        </label>
        <div className="toggle" style={{ display: "flex" }}>
          <span>
            <strong>Board orientation</strong>
            <span className="muted small" style={{ display: "block" }}>
              Where your home board sits.
            </span>
          </span>
          <span className="row" role="group" aria-label="Board orientation" style={{ flexWrap: "nowrap" }}>
            <button className="chip" aria-pressed={me.orientation === "left"} onClick={() => save({ orientation: "left" })}>
              Left
            </button>
            <button className="chip" aria-pressed={me.orientation === "right"} onClick={() => save({ orientation: "right" })}>
              Right
            </button>
          </span>
        </div>
        <ul className="list small">
          <li>
            <span>Free play</span>
            <span className="badge ok">Available</span>
          </li>
          <li>
            <span>Token play</span>
            <span className="badge warn">Not enabled</span>
          </li>
          <li>
            <span>Withdrawals</span>
            <span className="badge warn">Simulated only</span>
          </li>
        </ul>
      </section>

      <SupportCard history={st.history.map((h) => ({ matchId: h.matchId, label: `vs ${h.opponent} · ${new Date(h.date).toLocaleDateString()}` }))} />

      {me.registered && (
        <button className="btn danger block" onClick={signOut}>
          Sign out
        </button>
      )}
    </main>
  );
}
