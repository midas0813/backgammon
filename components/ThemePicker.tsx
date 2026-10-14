"use client";

import { useMemo, useState } from "react";
import Board from "@/components/Board";
import { initialBoard } from "@/lib/engine/board";
import { THEMES, setThemeId, useTheme, type BoardTheme } from "@/lib/client/theme";

function Swatch({ t }: { t: BoardTheme }) {
  return (
    <svg viewBox="0 0 60 36" aria-hidden>
      <rect width="60" height="36" fill={t.surface} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <polygon key={i} points={`${4 + i * 9},2 ${12 + i * 9},2 ${8 + i * 9},16`} fill={i % 2 ? t.lightPoint : t.darkPoint} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <polygon key={`b${i}`} points={`${4 + i * 9},34 ${12 + i * 9},34 ${8 + i * 9},20`} fill={i % 2 ? t.darkPoint : t.lightPoint} />
      ))}
      <circle cx="12" cy="29" r="4" fill="#F7F1E6" />
      <circle cx="48" cy="7" r="4" fill="#101A2E" stroke="#61758B" />
    </svg>
  );
}

/**
 * Six labelled board previews; the applied one carries a check mark (not colour alone).
 * With `previewFirst`, tapping a swatch shows it on a full board and an Apply button confirms it
 * (Settings → Board appearance → preview → Apply). Without it, a tap applies immediately (in-game menu).
 */
export default function ThemePicker({ previewFirst = false, mirror = false }: { previewFirst?: boolean; mirror?: boolean }) {
  const current = useTheme();
  const [preview, setPreview] = useState<BoardTheme | null>(null);
  const board = useMemo(() => initialBoard(), []);
  const shown = preview ?? current;
  return (
    <div className="theme-picker">
      {previewFirst && (
        <div className="board-wrap theme-preview" key={shown.id}>
          <Board
            board={board}
            viewer={0}
            theme={shown}
            dice={[
              { value: 5, used: false },
              { value: 3, used: false },
            ]}
            diceOwner="viewer"
            cube={{ value: 1, owner: null, disabled: false }}
            selectable={new Set()}
            selected={null}
            targets={new Map()}
            mirror={mirror}
          />
        </div>
      )}
      <div className="swatches" role="group" aria-label="Board appearance">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="swatch"
            aria-pressed={shown.id === t.id}
            onClick={() => (previewFirst ? setPreview(t.id === current.id ? null : t) : setThemeId(t.id))}
          >
            <Swatch t={t} />
            <span>
              {current.id === t.id ? "✓ " : ""}
              {t.name}
            </span>
          </button>
        ))}
      </div>
      {previewFirst && preview && preview.id !== current.id && (
        <div className="grid2">
          <button type="button" className="btn" onClick={() => setPreview(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setThemeId(preview.id);
              setPreview(null);
            }}
          >
            Apply {preview.name}
          </button>
        </div>
      )}
    </div>
  );
}
