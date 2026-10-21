"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { api } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/admin";
import { TIME_CONTROLS } from "@/lib/chess/rules";
import { GAMES } from "@/lib/games";
import type { listTournamentsAdmin } from "@/lib/server/admin/service";
import {
  DEFAULT_REWARDS,
  KIND_LABEL,
  MAX_SIZES,
  PLACES,
  POINT_CHOICES,
  SITGO_SIZES,
  WEEKDAYS,
  formatLabel,
  gameName,
  scheduleLabel,
  type TournamentKind,
  type TournamentSeries,
} from "@/lib/tournaments";
import { ActionDialog, Empty, Status, useAdmin } from "./ui";

type Data = Awaited<ReturnType<typeof listTournamentsAdmin>>;
type Row = Data["tournaments"][number];

const KINDS: TournamentKind[] = ["weekly", "monthly", "event", "sitgo"];

function blank(kind: TournamentKind): TournamentSeries {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return {
    id: "",
    name: kind === "event" ? "Special event" : kind === "sitgo" ? "Sit & go" : `${KIND_LABEL[kind]} cup`,
    game: "backgammon",
    kind,
    enabled: true,
    size: kind === "sitgo" ? 4 : 32,
    minPlayers: 4,
    weekday: 6,
    monthDay: 1,
    date: tomorrow,
    time: "18:00",
    registrationHours: kind === "monthly" ? 168 : kind === "sitgo" ? 0 : 72,
    points: 3,
    clock: "standard",
    timeControl: "3+2",
    description: "",
    rewards: DEFAULT_REWARDS[kind].map((r) => ({ ...r })),
  };
}

const rewardSummary = (s: Pick<TournamentSeries, "rewards">) =>
  s.rewards
    .map((r, i) =>
      r.xp || r.credits || r.prize ? `${PLACES[i]}: ${[r.xp && `${r.xp} XP`, r.credits && `${r.credits} credits`, r.prize].filter(Boolean).join(" + ")}` : null,
    )
    .filter(Boolean)
    .join(" · ") || "No rewards";

/** Tournament series (who organises: admins only), their schedules and rewards, and the tournaments they produce. */
export default function Tournaments() {
  const { can, open } = useAdmin();
  const manage = can("tournaments.manage");
  const [d, setD] = useState<Data | null>(null);
  const [edit, setEdit] = useState<{ index: number | null; s: TournamentSeries } | null>(null);
  const [cancel, setCancel] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Data>("/api/admin/tournaments")
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (!d) return <div className="skeleton" style={{ height: 240, borderRadius: 12 }} />;

  const save = async (series: TournamentSeries[]) => {
    setError(null);
    try {
      setD(await api<Data>("/api/admin/tournaments", { method: "PUT", body: { series } }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      return false;
    }
  };
  const act = async (id: string, body: { action: "start" | "cancel"; reason?: string }) => {
    setD(await api<Data>(`/api/admin/tournaments/${id}`, { method: "POST", body }));
  };

  const live = d.tournaments.filter((t) => t.status === "REGISTERING" || t.status === "RUNNING");
  const ended = d.tournaments.filter((t) => t.status === "COMPLETED" || t.status === "CANCELLED");

  return (
    <div className="a-stack">
      <section className="a-card">
        <div className="spread">
          <h3 className="a-h3">Series</h3>
          {manage && (
            <div className="row" style={{ gap: 6 }}>
              {KINDS.map((k) => (
                <button key={k} className="btn sm" onClick={() => setEdit({ index: null, s: blank(k) })}>
                  + {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="muted small">
          Only admins organise tournaments. Weekly and monthly cups repeat on their day; an event runs once. Registration opens the set number of hours before
          the start; at the start the bracket is built from whoever registered (top seeds get byes), or the tournament is cancelled if fewer than the minimum
          signed up. Sit &amp; go tables start the moment they are full. Times are UTC. Credits are practice credits (no cash value); a prize described in words
          is shown to players and handed out by the team.
        </p>
        {error && <p className="err small">{error}</p>}
        {d.series.length === 0 ? (
          <Empty>No series. Players will see no tournaments until you add one.</Empty>
        ) : (
          <div className="a-series">
            {d.series.map((s, i) => (
              <article key={s.id} className={`a-series-row${s.enabled ? "" : " off"}`}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong>{s.name}</strong>
                    <span className="a-role">{KIND_LABEL[s.kind]}</span>
                    <span className="a-role">{gameName(s.game)}</span>
                    {!s.enabled && <Status value="PAUSED" />}
                  </div>
                  <div className="muted small">
                    {scheduleLabel(s)} · {formatLabel(s)} · {s.kind === "sitgo" ? `${s.size} players` : `up to ${s.size}, at least ${s.minPlayers}`}
                    {s.kind !== "sitgo" && ` · registration opens ${s.registrationHours}h before`}
                  </div>
                  <div className="small">{rewardSummary(s)}</div>
                </div>
                {manage && (
                  <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <button className="btn sm" onClick={() => save(d.series.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}>
                      {s.enabled ? "Pause" : "Resume"}
                    </button>
                    <button className="btn sm" onClick={() => setEdit({ index: i, s: structuredClone(s) })}>
                      Edit
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => window.confirm(`Remove “${s.name}”? Tournaments already open keep running.`) && save(d.series.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="a-card">
        <h3 className="a-h3">Open and running</h3>
        {live.length === 0 ? (
          <Empty>Nothing open right now.</Empty>
        ) : (
          <table className="a-table">
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Status</th>
                <th>Starts</th>
                <th className="num">Players</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {live.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <div className="muted small">
                      {gameName(t.game)} · {KIND_LABEL[t.kind]} · {formatLabel(t)}
                    </div>
                  </td>
                  <td>
                    <Status value={t.status} />
                  </td>
                  <td className="small">{t.startsAt ? fmtDate(t.startsAt) : t.status === "RUNNING" ? fmtDate(t.startedAt!) : "when full"}</td>
                  <td className="num mono">
                    {t.registered}/{t.size}
                  </td>
                  <td>
                    {manage && (
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        {t.status === "REGISTERING" && t.registered >= 2 && (
                          <button
                            className="btn sm"
                            onClick={() => window.confirm(`Start “${t.name}” now with ${t.registered} players?`) && act(t.id, { action: "start" })}
                          >
                            Start now
                          </button>
                        )}
                        <button className="btn sm ghost" onClick={() => setCancel(t)}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="a-card">
        <h3 className="a-h3">Recent results and rewards</h3>
        {ended.length === 0 ? (
          <Empty>No finished tournaments yet.</Empty>
        ) : (
          <table className="a-table">
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Ended</th>
                <th>Rewards given</th>
              </tr>
            </thead>
            <tbody>
              {ended.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <div className="muted small">
                      {gameName(t.game)} · {KIND_LABEL[t.kind]}
                    </div>
                  </td>
                  <td className="small">
                    <Status value={t.status} /> {t.completedAt && fmtDate(t.completedAt)}
                    {t.cancelReason && <div className="muted small">{t.cancelReason}</div>}
                  </td>
                  <td className="small">
                    {t.awards.length === 0
                      ? "—"
                      : t.awards.map((a) => (
                          <div key={`${a.userId}${a.place}`}>
                            {a.place}:{" "}
                            <button className="link" onClick={() => open("users", a.userId)}>
                              {a.name}
                            </button>{" "}
                            <span className="muted">{[a.xp && `${a.xp} XP`, a.credits && `${a.credits} credits`, a.prize].filter(Boolean).join(" + ")}</span>
                          </div>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {edit && (
        <SeriesEditor
          initial={edit.s}
          onClose={() => setEdit(null)}
          onSave={async (s) => {
            const list = edit.index === null ? [...d.series, s] : d.series.map((x, j) => (j === edit.index ? s : x));
            if (await save(list)) setEdit(null);
          }}
          error={error}
        />
      )}
      {cancel && (
        <ActionDialog
          title={`Cancel ${cancel.name}?`}
          description={
            cancel.status === "RUNNING"
              ? "Matches already being played finish, but nobody moves on and no rewards are given."
              : "Registered players are released."
          }
          confirmLabel="Cancel tournament"
          danger
          onConfirm={(reason) => act(cancel.id, { action: "cancel", reason })}
          onClose={() => setCancel(null)}
        />
      )}
    </div>
  );
}

function SeriesEditor({
  initial,
  onSave,
  onClose,
  error,
}: {
  initial: TournamentSeries;
  onSave: (s: TournamentSeries) => Promise<void>;
  onClose: () => void;
  error: string | null;
}) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TournamentSeries>(k: K, v: TournamentSeries[K]) => setS((x) => ({ ...x, [k]: v }));
  const setReward = (i: number, k: "xp" | "credits" | "prize", v: string) =>
    setS((x) => ({ ...x, rewards: x.rewards.map((r, j) => (j === i ? { ...r, [k]: k === "prize" ? v : Math.max(0, Math.trunc(Number(v) || 0)) } : r)) }));
  const sitgo = s.kind === "sitgo";
  return (
    <Modal title={initial.id ? `Edit ${initial.name}` : `New ${KIND_LABEL[s.kind].toLowerCase()} series`} onClose={onClose}>
      <div className="a-form">
        <label>
          Name
          <input maxLength={48} value={s.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <div className="grid2">
          <label>
            Game
            <select value={s.game} onChange={(e) => set("game", e.target.value as TournamentSeries["game"])}>
              {GAMES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={s.kind}
              onChange={(e) => {
                const kind = e.target.value as TournamentKind;
                const sizes = kind === "sitgo" ? SITGO_SIZES : MAX_SIZES;
                setS((x) => ({ ...x, kind, size: sizes.includes(x.size) ? x.size : sizes[0], rewards: DEFAULT_REWARDS[kind].map((r) => ({ ...r })) }));
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!sitgo && (
          <div className="grid2">
            {s.kind === "weekly" && (
              <label>
                Day
                <select value={s.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {s.kind === "monthly" && (
              <label>
                Day of the month
                <input type="number" min={1} max={28} value={s.monthDay} onChange={(e) => set("monthDay", Number(e.target.value))} />
              </label>
            )}
            {s.kind === "event" && (
              <label>
                Date
                <input type="date" value={s.date} onChange={(e) => set("date", e.target.value)} />
              </label>
            )}
            <label>
              Start time (UTC)
              <input type="time" value={s.time} onChange={(e) => set("time", e.target.value)} />
            </label>
          </div>
        )}

        <div className="grid2">
          <label>
            {sitgo ? "Players (starts when full)" : "Most players"}
            <select value={s.size} onChange={(e) => set("size", Number(e.target.value))}>
              {(sitgo ? SITGO_SIZES : MAX_SIZES).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {!sitgo && (
            <label>
              Fewest players to start
              <input type="number" min={2} max={s.size} value={s.minPlayers} onChange={(e) => set("minPlayers", Number(e.target.value))} />
            </label>
          )}
        </div>
        {!sitgo && (
          <label>
            Registration opens (hours before the start)
            <input type="number" min={1} max={720} value={s.registrationHours} onChange={(e) => set("registrationHours", Number(e.target.value))} />
          </label>
        )}

        {s.game === "chess" ? (
          <label>
            Time control
            <select value={s.timeControl} onChange={(e) => set("timeControl", e.target.value)}>
              {TIME_CONTROLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} {t.kind}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="grid2">
            <label>
              Match length
              <select value={s.points} onChange={(e) => set("points", Number(e.target.value))}>
                {POINT_CHOICES.map((p) => (
                  <option key={p} value={p}>
                    {p} point{p === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clock
              <select value={s.clock} onChange={(e) => set("clock", e.target.value as TournamentSeries["clock"])}>
                <option value="standard">Standard</option>
                <option value="fast">Fast</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
        )}
        <label>
          Description (shown to players)
          <input maxLength={200} value={s.description} onChange={(e) => set("description", e.target.value)} />
        </label>

        <fieldset className="a-rewards">
          <legend>
            Rewards{" "}
            <button
              type="button"
              className="link small"
              onClick={() =>
                set(
                  "rewards",
                  DEFAULT_REWARDS[s.kind].map((r) => ({ ...r })),
                )
              }
            >
              Use the {KIND_LABEL[s.kind].toLowerCase()} defaults
            </button>
          </legend>
          <div className="a-rewards-grid">
            <span />
            <span className="muted small">XP</span>
            <span className="muted small">Credits</span>
            <span className="muted small">Prize (text)</span>
            {PLACES.map((p, i) => (
              <RewardRow key={p} label={p} r={s.rewards[i]} onChange={(k, v) => setReward(i, k, v)} />
            ))}
          </div>
        </fieldset>
        <label className="toggle">
          <span>
            <strong>Active</strong>
            <span className="muted small" style={{ display: "block" }}>
              Paused series open no new tournaments.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        </label>
        {error && <p className="err small">{error}</p>}
        <div className="grid2">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || s.name.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              await onSave(s);
              setBusy(false);
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RewardRow({
  label,
  r,
  onChange,
}: {
  label: string;
  r: TournamentSeries["rewards"][number];
  onChange: (k: "xp" | "credits" | "prize", v: string) => void;
}) {
  return (
    <>
      <span className="small">{label}</span>
      <input type="number" min={0} aria-label={`${label} XP`} value={r.xp} onChange={(e) => onChange("xp", e.target.value)} />
      <input type="number" min={0} aria-label={`${label} credits`} value={r.credits} onChange={(e) => onChange("credits", e.target.value)} />
      <input maxLength={60} aria-label={`${label} prize`} placeholder="e.g. Gold frame" value={r.prize} onChange={(e) => onChange("prize", e.target.value)} />
    </>
  );
}
