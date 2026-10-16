"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Confetti from "@/components/Confetti";
import { shortAddress } from "@/components/WalletButton";
import { api } from "@/lib/client/api";
import { uploadAvatar } from "@/lib/client/avatar";
import { setMe, useMe, type Profile } from "@/lib/client/me";

/** First-run setup after a wallet creates an account: display name and photo. */
export default function WelcomePage() {
  const me = useMe();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // null until edited: shows the account name.
  const [edited, setName] = useState<string | null>(null);
  const name = edited ?? me?.name ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me && !me.registered) router.replace("/signup");
  }, [me, router]);

  if (!me?.registered || !me.walletAddress) {
    return (
      <main className="page">
        <div className="card skeleton" style={{ height: 320 }} />
      </main>
    );
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setMe(await uploadAvatar(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMe(await api<Profile>("/api/me", { method: "PATCH", body: { name } }));
      router.push("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <Confetti pieces={60} />
      <section className="card accent welcome">
        <span className="eyebrow">Account created</span>
        <h1 className="display">Welcome to the table</h1>
        <p className="muted">
          Your account is linked to <span className="mono">{shortAddress(me.walletAddress)}</span>. Choose how other players see you.
        </p>
        <div className="welcome-avatar">
          <div className="avatar-edit">
            <Avatar name={name || me.name} src={me.avatarUrl} size={112} />
          </div>
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {me.avatarUrl ? "Change photo" : "Add a photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
        </div>
        <form onSubmit={finish} className="auth-form">
          <label>
            Display name
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          {error && <p className="err small">{error}</p>}
          <button className="btn primary lg block" disabled={busy || name.trim().length < 2}>
            {busy ? "Saving…" : "Start playing"}
          </button>
          <Link className="btn ghost block" href="/home">
            Skip for now
          </Link>
        </form>
      </section>
    </main>
  );
}
