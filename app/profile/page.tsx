"use client";

import { useEffect, useState } from "react";
import ThemePicker from "@/components/ThemePicker";
import { api } from "@/lib/client/api";

interface Me {
  id: string;
  name: string;
  themeId: string;
  reducedMotion: boolean;
  createdAt: string;
}

export default function Profile() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Me>("/api/me").then((m) => {
      setMe(m);
      setName(m.name);
    });
  }, []);

  const save = async (patch: Partial<Me>) => {
    const m = await api<Me>("/api/me", { method: "PATCH", body: patch });
    setMe(m);
    setName(m.name);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <main className="page">
      <h1>Profile</h1>
      <section className="card">
        <h2>Account</h2>
        <label>
          Display name
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary" onClick={() => save({ name })} disabled={!me || name.trim().length < 2}>
          {saved ? "Saved ✓" : "Save name"}
        </button>
        <div className="muted small">
          Guest account (stored in a browser cookie). Sign-in, verification and eligibility checks are required before token play and are not
          part of this MVP.
        </div>
      </section>

      <section className="card">
        <h2>Board appearance</h2>
        <p className="muted small">Changes only your view, even mid-game. Saved to this device and your profile.</p>
        <ThemePicker />
      </section>

      <section className="card">
        <h2>Accessibility</h2>
        <label style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <span>Reduce motion</span>
          <input
            type="checkbox"
            style={{ width: 24, minHeight: 24 }}
            checked={me?.reducedMotion ?? false}
            onChange={(e) => save({ reducedMotion: e.target.checked })}
          />
        </label>
      </section>

      <section className="card">
        <h2>Eligibility</h2>
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
    </main>
  );
}
