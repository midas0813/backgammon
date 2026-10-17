"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import type { dashboard, listAnnouncementsAdmin } from "@/lib/server/admin/service";
import { ActionDialog, Empty, Status, useAdmin } from "./ui";

type Dash = Awaited<ReturnType<typeof dashboard>>;
type Anns = Awaited<ReturnType<typeof listAnnouncementsAdmin>>;

export default function Settings() {
  const { can, sign } = useAdmin();
  const manage = can("settings.manage");
  const [settings, setSettings] = useState<Dash["settings"] | null>(null);
  const [draft, setDraft] = useState<Dash["settings"] | null>(null);
  const [anns, setAnns] = useState<Anns | null>(null);
  // When the list was loaded, for "still running" (read once per load, not on every render).
  const [now, setNow] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState({ message: "", tone: "info", hours: "" });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Dash>("/api/admin/dashboard").then((d) => {
      setSettings(d.settings);
      setDraft(d.settings);
    });
    api<Anns>("/api/admin/announcements").then((a) => {
      setAnns(a);
      setNow(Date.now());
    });
  }, []);
  useEffect(load, [load]);
  if (!settings || !draft) return <div className="skeleton" style={{ height: 240, borderRadius: 12 }} />;
  const changed = JSON.stringify(settings) !== JSON.stringify(draft);

  const publish = async () => {
    setError(null);
    try {
      await api("/api/admin/announcements", {
        method: "POST",
        body: { message: msg.message, tone: msg.tone, hours: msg.hours ? Number(msg.hours) : undefined },
      });
      setMsg({ message: "", tone: "info", hours: "" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="a-stack">
      <section className="a-card">
        <h3 className="a-h3">Operator switches</h3>
        <label className="toggle">
          <span>
            <strong>Maintenance mode</strong>
            <span className="muted small" style={{ display: "block" }}>
              Blocks new matches and tables. Games in progress continue. Players see the message below.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            disabled={!manage}
            checked={draft.maintenance.enabled}
            onChange={(e) => setDraft({ ...draft, maintenance: { ...draft.maintenance, enabled: e.target.checked } })}
          />
        </label>
        <label>
          Maintenance message
          <input
            disabled={!manage}
            maxLength={200}
            value={draft.maintenance.message}
            onChange={(e) => setDraft({ ...draft, maintenance: { ...draft.maintenance, message: e.target.value } })}
          />
        </label>
        <label className="toggle">
          <span>
            <strong>Spectators</strong>
            <span className="muted small" style={{ display: "block" }}>
              When off, nobody can watch other players&apos; matches and the lobby hides “Watch now”.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            disabled={!manage}
            checked={draft.spectators}
            onChange={(e) => setDraft({ ...draft, spectators: e.target.checked })}
          />
        </label>
        <label className="toggle">
          <span>
            <strong>Weekly prize pool</strong>
            <span className="muted small" style={{ display: "block" }}>
              Top {draft.prizePool.split.length} eligible players each week ({draft.prizePool.split.join(" / ")}%), paid after an admin&apos;s check under
              Prizes.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            disabled={!manage}
            checked={draft.prizePool.enabled}
            onChange={(e) => setDraft({ ...draft, prizePool: { ...draft.prizePool, enabled: e.target.checked } })}
          />
        </label>
        <div className="grid2">
          <label>
            Pool per week (tokens)
            <input
              type="number"
              min={0}
              step={1}
              disabled={!manage}
              value={draft.prizePool.units / 100}
              onChange={(e) => setDraft({ ...draft, prizePool: { ...draft.prizePool, units: Math.max(0, Math.round(Number(e.target.value) * 100)) } })}
            />
          </label>
          <label>
            Different opponents needed
            <input
              type="number"
              min={1}
              max={50}
              disabled={!manage}
              value={draft.prizePool.minOpponents}
              onChange={(e) => setDraft({ ...draft, prizePool: { ...draft.prizePool, minOpponents: Math.max(1, Math.round(Number(e.target.value))) } })}
            />
          </label>
        </div>
        {manage ? (
          <div className="a-actions">
            <button className="btn sm primary" disabled={!changed} onClick={() => setConfirm(true)}>
              Save changes…
            </button>
            {changed && (
              <button className="btn sm ghost" onClick={() => setDraft(settings)}>
                Discard
              </button>
            )}
          </div>
        ) : (
          <p className="muted small">Only an Owner can change these.</p>
        )}
      </section>

      <section className="a-card">
        <h3 className="a-h3">Announcements</h3>
        <p className="muted small">Shown at the top of Home and the Lobby. Up to three are shown at once.</p>
        {manage && (
          <>
            <textarea
              rows={2}
              maxLength={280}
              placeholder="e.g. Friday night tournament starts at 20:00 UTC!"
              value={msg.message}
              onChange={(e) => setMsg({ ...msg, message: e.target.value })}
            />
            <div className="a-actions">
              <select value={msg.tone} onChange={(e) => setMsg({ ...msg, tone: e.target.value })}>
                <option value="info">Info</option>
                <option value="ok">Good news</option>
                <option value="warn">Warning</option>
              </select>
              <input
                className="a-small-input"
                inputMode="numeric"
                placeholder="Hours (optional)"
                value={msg.hours}
                onChange={(e) => setMsg({ ...msg, hours: e.target.value })}
              />
              <button className="btn sm primary" disabled={msg.message.trim().length < 3} onClick={publish}>
                Publish
              </button>
            </div>
            {error && <p className="err small">{error}</p>}
          </>
        )}
        {!anns ? null : anns.announcements.length === 0 ? (
          <Empty>No announcements yet.</Empty>
        ) : (
          <ul className="a-list">
            {anns.announcements.map((a) => {
              const live = a.active && (!a.expiresAt || Date.parse(a.expiresAt) > now);
              return (
                <li key={a.id} className="spread">
                  <span>
                    <Status value={live ? "ACTIVE" : "COMPLETED"} /> {a.message}
                    <span className="muted small">
                      {" "}
                      · {fmtDate(a.createdAt)}
                      {a.expiresAt ? ` · ends ${fmtDate(a.expiresAt)}` : ""}
                    </span>
                  </span>
                  {manage && live && (
                    <button className="btn sm ghost" onClick={() => api(`/api/admin/announcements/${a.id}/end`, { method: "POST" }).then(load)}>
                      End
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {confirm && (
        <ActionDialog
          title="Save operator settings?"
          description={
            <>
              Maintenance {draft.maintenance.enabled ? "ON" : "off"} · Spectators {draft.spectators ? "on" : "OFF"} · Prize pool{" "}
              {draft.prizePool.enabled ? `${draft.prizePool.units / 100} tokens a week` : "OFF"}. Takes effect within about ten seconds.
            </>
          }
          confirmLabel="Save"
          signed
          onClose={() => setConfirm(false)}
          onConfirm={async (reason) => {
            const proof = await sign({ action: "SETTINGS_UPDATE", target: "settings", reason });
            await api("/api/admin/settings", { method: "POST", body: { patch: draft, reason, ...proof } });
            load();
          }}
        />
      )}
    </div>
  );
}
