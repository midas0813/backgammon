"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ClientApiError, api } from "@/lib/client/api";
import { setMe, type Profile } from "@/lib/client/me";

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
  return { score, label: ["Too short", "Weak", "Okay", "Good", "Strong"][score] };
}

export default function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/play";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = strength(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const profile = await api<Profile>(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        body: mode === "signup" ? { name, email, password, acceptTerms: accept } : { email, password },
      });
      setMe(profile);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {mode === "signup" && (
        <label>
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={20} placeholder="e.g. DiceQueen" required />
        </label>
      )}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" placeholder="you@example.com" required />
      </label>
      <label>
        Password
        <span className="pw">
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={8}
            required
          />
          <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      {mode === "signup" && password && (
        <div className="pw-meter" aria-live="polite">
          <div className="bars">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < s.score ? `on s${s.score}` : ""} />
            ))}
          </div>
          <span className="muted small">{s.label} · at least 8 characters with a letter and a number</span>
        </div>
      )}
      {mode === "signup" && (
        <label className="check">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>I am 18 or older and agree to the terms of play. Free play only in this preview — no real money.</span>
        </label>
      )}
      {error && (
        <p className="err small" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary lg block" disabled={busy || !email || !password || (mode === "signup" && (!name || !accept))}>
        {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      {mode === "signup" ? (
        <p className="muted small" style={{ textAlign: "center" }}>
          Already have an account? <Link href={`/login${next !== "/play" ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
        </p>
      ) : (
        <p className="muted small" style={{ textAlign: "center" }}>
          New here? <Link href="/signup">Create a free account</Link>
        </p>
      )}
      <Link className="btn ghost block" href="/play">
        Continue as guest
      </Link>
    </form>
  );
}
