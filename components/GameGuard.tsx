"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { ALREADY_IN_GAME_EVENT, api, type CurrentGame } from "@/lib/client/api";
import { unwatchTable } from "@/lib/client/tables";
import { toast } from "@/lib/client/toast";

/** What the player's current game is, in words. */
function describe(g: CurrentGame) {
  if (g.status === "WAITING") return g.mode === "private" ? "Your invite-only table is waiting for your friend." : "Your table is waiting for an opponent.";
  if (g.mode === "bot") return "You have a game against the computer in progress.";
  if (g.mode === "local") return "You have a pass & play game in progress.";
  return `You're in a match${g.opponent ? ` with ${g.opponent}` : ""}.`;
}

/**
 * One game at a time: when the server refuses a new game (ALREADY_IN_GAME, from any tab or window),
 * explain why and offer to resume the current game or leave it.
 */
export default function GameGuard() {
  const router = useRouter();
  const [game, setGame] = useState<CurrentGame | null>(null);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const on = (e: Event) => {
      const g = (e as CustomEvent<CurrentGame | undefined>).detail;
      if (!g) return;
      setGame(g);
      setConfirmForfeit(false);
    };
    window.addEventListener(ALREADY_IN_GAME_EVENT, on);
    return () => window.removeEventListener(ALREADY_IN_GAME_EVENT, on);
  }, []);

  if (!game) return null;
  const close = () => setGame(null);
  const online = game.mode === "quick" || game.mode === "private";
  const leave = async () => {
    setBusy(true);
    try {
      await api(`/api/matches/${game.matchId}/leave`, { method: "POST" });
      unwatchTable(game.matchId);
      toast(
        game.status === "WAITING"
          ? "Table closed. You can start a new game now."
          : online
            ? "Match forfeited. You can start a new game now."
            : "Game ended. You can start a new game now.",
        { tone: "ok" },
      );
      close();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not leave the game", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  };

  if (confirmForfeit) {
    return (
      <Modal title="Forfeit your match?" onClose={() => setConfirmForfeit(false)}>
        <p className="muted">{game.opponent ?? "Your opponent"} will be declared the winner. This cannot be undone.</p>
        <div className="grid2">
          <button className="btn" onClick={() => setConfirmForfeit(false)}>
            Keep playing
          </button>
          <button className="btn danger" disabled={busy} onClick={leave}>
            Forfeit match
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="You're already in a game" onClose={close}>
      <p className="muted">{describe(game)} You can play one game at a time — finish it or leave it to start another.</p>
      <button
        className="btn primary block"
        onClick={() => {
          close();
          router.push(`/match/${game.matchId}`);
        }}
      >
        {game.status === "WAITING" ? "Go to my table" : "Resume game"}
      </button>
      {game.status === "WAITING" ? (
        <button className="btn block" disabled={busy} onClick={leave}>
          Close my table
        </button>
      ) : online ? (
        <button className="btn danger block" onClick={() => setConfirmForfeit(true)}>
          Forfeit match…
        </button>
      ) : (
        <button className="btn block" disabled={busy} onClick={leave}>
          End this game
        </button>
      )}
      <button className="btn ghost block" onClick={close}>
        Cancel
      </button>
    </Modal>
  );
}
