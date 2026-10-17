"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { api, isHandled } from "@/lib/client/api";
import { sounds } from "@/lib/client/sound";
import { toast } from "@/lib/client/toast";

const BEAT_MS = 15_000;

interface Invite {
  id: number;
  from: string;
  matchId: string;
  targetPoints: number;
  clock: string;
  rematch: boolean;
}

/**
 * Keeps "players online" accurate (a heartbeat while the app is visible, a goodbye when it's not) and
 * brings friends' invites and rematch requests to the player wherever they are in the app.
 */
export default function OnlineHeartbeat() {
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [ready, setReady] = useState<{ matchId: string; opponent: string; tournament: string } | null>(null);
  const shown = useRef(new Set<number>());
  const shownMatches = useRef(new Set<string>());

  useEffect(() => {
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch("/api/presence", { method: "POST", keepalive: true })
        .then((x) => (x.ok ? (x.json() as Promise<{ invites?: Invite[]; ready?: { matchId: string; opponent: string; tournament: string }[] }>) : null))
        .catch(() => null);
      // A tournament round is ready: call the player to the board (unless they're already there).
      const round = r?.ready?.find((m) => !shownMatches.current.has(m.matchId) && !window.location.pathname.endsWith(m.matchId));
      if (round) {
        shownMatches.current.add(round.matchId);
        setReady(round);
        sounds.joined();
        navigator.vibrate?.([80, 40, 80]);
      }
      const next = r?.invites?.find((i) => !shown.current.has(i.id));
      if (next) {
        shown.current.add(next.id);
        setInvite(next);
        sounds.joined();
        navigator.vibrate?.([60, 40, 60]);
      }
    };
    const away = () => navigator.sendBeacon?.("/api/presence?away=1");
    void beat();
    const t = window.setInterval(beat, BEAT_MS);
    const onVisibility = () => (document.visibilityState === "visible" ? void beat() : away());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", away);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", away);
    };
  }, []);

  if (ready) {
    return (
      <Modal title={`Your ${ready.tournament} match is ready`} onClose={() => setReady(null)}>
        <p className="muted">You play {ready.opponent}. Your clock starts in about 2 minutes, so head to the board now.</p>
        <button
          className="btn primary block"
          onClick={() => {
            setReady(null);
            router.push(`/match/${ready.matchId}`);
          }}
        >
          Go to the board
        </button>
      </Modal>
    );
  }
  if (!invite) return null;
  const respond = async (accept: boolean) => {
    const i = invite;
    setInvite(null);
    try {
      const r = await api<{ matchId?: string }>(`/api/invites/${i.id}`, { method: "POST", body: { accept } });
      if (accept && r.matchId) router.push(`/match/${r.matchId}`);
    } catch (e) {
      if (!isHandled(e)) toast(e instanceof Error ? e.message : "That invite is no longer open", { tone: "warn" });
    }
  };
  return (
    <Modal title={invite.rematch ? `${invite.from} wants a rematch` : `${invite.from} invites you to play`} onClose={() => setInvite(null)}>
      <p className="muted">
        {invite.targetPoints}-point match · {invite.clock === "none" ? "no clock" : `${invite.clock} clock`} · free
      </p>
      <div className="grid2">
        <button className="btn" onClick={() => respond(false)}>
          Decline
        </button>
        <button className="btn primary" onClick={() => respond(true)}>
          Join
        </button>
      </div>
    </Modal>
  );
}
