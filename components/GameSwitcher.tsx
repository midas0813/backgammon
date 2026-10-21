"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Modal from "@/components/Modal";
import { lobbyPath, setCurrentGame } from "@/lib/client/game";
import { GAMES, type GameType } from "@/lib/games";

/** "♟ Chess ▾": shows the current game and opens a sheet to switch to another. */
export default function GameSwitcher({ game }: { game: GameType }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current = GAMES.find((g) => g.id === game)!;
  return (
    <>
      <button className="game-switch" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Game: ${current.name}. Change game`}>
        <span className="game-switch-icon" aria-hidden>
          {current.icon}
        </span>
        <span>{current.name}</span>
        <span aria-hidden className="muted">
          ▾
        </span>
      </button>
      {open && (
        <Modal title="Choose a game" onClose={() => setOpen(false)}>
          <div className="game-pick">
            {GAMES.map((g) => (
              <button
                key={g.id}
                className="choice game-pick-item"
                aria-pressed={g.id === game}
                onClick={() => {
                  setCurrentGame(g.id);
                  setOpen(false);
                  router.push(lobbyPath(g.id));
                }}
              >
                <span className="game-pick-icon" aria-hidden>
                  {g.icon}
                </span>
                <span>
                  <strong>{g.name}</strong>
                  <span className="muted small" style={{ display: "block" }}>
                    {g.tagline}
                  </span>
                </span>
              </button>
            ))}
            <div className="choice game-pick-item" aria-disabled>
              <span className="game-pick-icon" aria-hidden>
                🂡
              </span>
              <span>
                <strong>Poker</strong>
                <span className="muted small" style={{ display: "block" }}>
                  Coming soon
                </span>
              </span>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
