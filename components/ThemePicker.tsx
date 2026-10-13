"use client";

import { THEMES, setThemeId, useTheme } from "@/lib/client/theme";

/** Six labelled board previews; the selected one carries a check mark (not colour alone). */
export default function ThemePicker() {
  const current = useTheme();
  return (
    <div className="swatches" role="group" aria-label="Board appearance">
      {THEMES.map((t) => (
        <button key={t.id} type="button" className="swatch" aria-pressed={current.id === t.id} onClick={() => setThemeId(t.id)}>
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
          <span>
            {current.id === t.id ? "✓ " : ""}
            {t.name}
          </span>
        </button>
      ))}
    </div>
  );
}
