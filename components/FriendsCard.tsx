"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { api, isHandled } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import type { listFriends } from "@/lib/server/social";

type Data = Awaited<ReturnType<typeof listFriends>>;

/** Friends with online status: invite one to a match, watch their game, answer requests. */
export default function FriendsCard() {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [points, setPoints] = useState(3);
  const load = useCallback(() => {
    api<Data>("/api/friends")
      .then(setD)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => window.clearInterval(t);
  }, [load]);
  if (!d) return null;
  const act = async (path: string, body: Record<string, unknown>, after?: (r: { matchId?: string }) => void) => {
    try {
      const r = await api<{ matchId?: string }>(path, { method: "POST", body });
      after?.(r);
      load();
    } catch (e) {
      if (!isHandled(e)) toast(e instanceof Error ? e.message : "Could not do that", { tone: "warn" });
    }
  };
  return (
    <section className="card" id="friends">
      <div className="spread">
        <h2>Friends</h2>
        <div className="seg compact" role="group" aria-label="Match length for invites">
          {[1, 3, 5, 7].map((p) => (
            <button key={p} className="chip" aria-pressed={points === p} onClick={() => setPoints(p)}>
              {p} pt
            </button>
          ))}
        </div>
      </div>
      {d.incoming.length > 0 && (
        <ul className="list">
          {d.incoming.map((f) => (
            <li key={f.id}>
              <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                <Avatar name={f.name} src={f.avatarUrl} size={32} frame={f.frame} />
                <span className="ellipsis">{f.name} wants to be friends</span>
              </span>
              <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <button className="btn sm ghost" onClick={() => act(`/api/friends/${f.id}`, { accept: false })}>
                  Decline
                </button>
                <button className="btn sm primary" onClick={() => act(`/api/friends/${f.id}`, { accept: true })}>
                  Accept
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.friends.length === 0 ? (
        <p className="muted small">Add friends from the end of a match. Then you can see when they&apos;re online and invite them straight to a game.</p>
      ) : (
        <ul className="list">
          {d.friends.map((f) => (
            <li key={f.id}>
              <span className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                <span style={{ position: "relative", display: "inline-flex" }}>
                  <Avatar name={f.name} src={f.avatarUrl} size={32} frame={f.frame} />
                  <span className={`presence ${f.online ? "on" : "away"}`} aria-label={f.online ? "online" : "offline"} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong className="ellipsis" style={{ display: "block" }}>
                    {f.name}
                  </strong>
                  <span className="muted small">
                    Lv {f.level} · {f.rating} · {f.playing ? "in a match" : f.online ? "online" : "offline"}
                  </span>
                </span>
              </span>
              <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                {f.playing?.watchable && (
                  <Link className="btn sm ghost" href={`/match/${f.playing.matchId}`}>
                    Watch
                  </Link>
                )}
                {!f.playing && (
                  <button
                    className="btn sm primary"
                    onClick={() => act(`/api/friends/${f.id}/invite`, { targetPoints: points }, (r) => r.matchId && router.push(`/match/${r.matchId}`))}
                  >
                    Invite
                  </button>
                )}
                <button
                  className="btn sm ghost"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => confirm(`Remove ${f.name} from your friends?`) && act(`/api/friends/${f.id}`, { accept: false })}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.outgoing.length > 0 && <p className="muted small">Waiting for {d.outgoing.map((f) => f.name).join(", ")} to accept.</p>}
    </section>
  );
}
