"use client";

import { useEffect, useMemo, useState } from "react";
import Board from "@/components/Board";
import { initialBoard } from "@/lib/engine/board";
import { THEMES, setThemeId } from "@/lib/client/theme";

/** The real game board, auto-cycling through the six themes until the visitor picks one. */
export default function BoardShowcase() {
  const [i, setI] = useState(0);
  const [pinned, setPinned] = useState(false);
  const board = useMemo(() => initialBoard(), []);
  useEffect(() => {
    if (pinned) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % THEMES.length), 2800);
    return () => window.clearInterval(t);
  }, [pinned]);
  const theme = THEMES[i];
  return (
    <div className="showcase">
      <div className="showcase-board board-wrap" key={theme.id}>
        <Board
          board={board}
          viewer={0}
          theme={theme}
          dice={[
            { value: 6, used: false },
            { value: 5, used: false },
          ]}
          diceOwner="viewer"
          cube={{ value: 1, owner: null, disabled: false }}
          selectable={new Set()}
          selected={null}
          targets={new Map()}
          rollKey={`show-${theme.id}`}
        />
      </div>
      <div className="showcase-picker" role="group" aria-label="Board theme">
        {THEMES.map((t, k) => (
          <button
            key={t.id}
            className="showcase-chip"
            aria-pressed={k === i}
            onClick={() => {
              setI(k);
              setPinned(true);
              setThemeId(t.id);
            }}
          >
            <span className="sw" style={{ background: `linear-gradient(135deg, ${t.lightPoint} 0 50%, ${t.darkPoint} 50% 100%)`, borderColor: t.surface }} />
            {t.name}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ textAlign: "center" }}>
        {pinned ? `“${theme.name}” saved as your board.` : "Tap a board to make it yours — you can change it any time, even mid-game."}
      </p>
    </div>
  );
}
