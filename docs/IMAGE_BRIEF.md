# AI image brief

The site already runs with built-in vector artwork. Each image below has a fixed slot: save the generated file
in `public/images/` with **exactly** the file name shown, and it replaces the built-in art automatically
(restart `npm run dev`, or rebuild for production).

## Shared style (append to every prompt)

> Cinematic, photoreal, dark navy (#0B1220) ambience, warm walnut wood and cream/ink-blue checkers, mint-green (#65E2BC) and soft gold (#F4CF87) rim lighting, shallow depth of field, premium and calm, no text, no letters, no logos, no watermarks, no human faces in focus.

Keep one visual family: same lighting, same walnut board, same cream and ink-blue checkers. Generate at the size
shown or larger with the same aspect ratio, then export **WebP at quality 80–85** (aim for under 300 KB each,
under 500 KB for the hero). Check every image for extra or melted dice pips, wrong checker counts, and stray text.

## Images (11)

| # | File | Size (px) | Where it appears |
| --- | --- | --- | --- |
| 1 | `hero.webp` | 1920 × 1080 | Landing hero background (cropped to centre on phones — keep the subject in the middle 50%) |
| 2 | `intro-history.webp` | 1200 × 900 | Landing — “What is backgammon?” section |
| 3 | `mode-quick.webp` | 1200 × 675 | Landing — Quick match card |
| 4 | `mode-computer.webp` | 1200 × 675 | Landing — vs Computer card |
| 5 | `mode-ranked.webp` | 1200 × 675 | Landing — Ranked card (shown as “coming soon”) |
| 6 | `mode-tournament.webp` | 1200 × 675 | Landing — Tournaments card (shown as “coming soon”) |
| 7 | `feature-fair-dice.webp` | 1200 × 675 | Landing — Fair dice feature |
| 8 | `feature-wallet.webp` | 1200 × 675 | Landing — Wallet & tokens feature |
| 9 | `cta-background.webp` | 1920 × 800 | Landing — final call-to-action band (dark overlay is added on top) |
| 10 | `auth-panel.webp` | 1080 × 1440 | Sign-up and sign-in pages (side panel on desktop, header strip on phones) |
| 11 | `og-image.png` | 1200 × 630 | Link previews (WhatsApp, X, Slack, iMessage). Text may be added afterwards in a design tool. |

## Prompts

### 1. `hero.webp` — hero

- **Size:** 1920 × 1080
- **Alt text (already in the code):** A walnut backgammon board under dramatic light with dice mid-roll
- **Prompt:** Low-angle close-up of a luxurious walnut backgammon board on a dark table, two ivory dice frozen mid-air above it, cream and deep-navy checkers stacked on the points, glowing mint and gold rim light, floating dust particles, dramatic negative space on the left for headline text. + shared style above.

### 2. `intro-history.webp` — history

- **Size:** 1200 × 900
- **Alt text (already in the code):** An ancient board game carved in stone beside a modern backgammon board
- **Prompt:** An ancient Mesopotamian race game board carved in stone (Royal Game of Ur style) beside a modern polished walnut backgammon board, museum lighting, sand and gold tones blending into navy shadows, sense of 5,000 years of history. + shared style above.

### 3. `mode-quick.webp` — modeQuick

- **Size:** 1200 × 675
- **Alt text (already in the code):** Two dice tumbling with motion trails
- **Prompt:** Two ivory dice tumbling fast across a navy felt surface, crisp mint-green motion trails, energetic, macro photo. + shared style above.

### 4. `mode-computer.webp` — modeComputer

- **Size:** 1200 × 675
- **Alt text (already in the code):** A glowing circuit pattern forming a backgammon board
- **Prompt:** Backgammon board whose triangle points are made of glowing mint circuit traces on dark glass, a single cream checker in focus, futuristic but warm, subtle gold highlights. + shared style above.

### 5. `mode-ranked.webp` — modeRanked

- **Size:** 1200 × 675
- **Alt text (already in the code):** A gold trophy beside stacked backgammon checkers
- **Prompt:** A small brushed-gold trophy next to a tall stack of cream checkers on walnut, spotlight from above, navy background. + shared style above.

### 6. `mode-tournament.webp` — modeTournament

- **Size:** 1200 × 675
- **Alt text (already in the code):** Several backgammon boards in a dim tournament hall
- **Prompt:** Rows of backgammon boards on tables in a dim elegant tournament hall, bokeh lights, mint and gold accents, no people in focus, anticipation. + shared style above.

### 7. `feature-fair-dice.webp` — fairDice

- **Size:** 1200 × 675
- **Alt text (already in the code):** A die inside a translucent protective shield
- **Prompt:** A single ivory die suspended inside a translucent hexagonal glass shield, mint glow, clean dark background, trust and fairness. + shared style above.

### 8. `feature-wallet.webp` — wallet

- **Size:** 1200 × 675
- **Alt text (already in the code):** Gold tokens stacked beside a digital wallet
- **Prompt:** Stacks of minimal gold game tokens embossed with a die pip pattern beside a sleek dark smartphone showing an abstract glowing wallet card, soft reflections. Avoid real currency symbols or crypto brand logos. + shared style above.

### 9. `cta-background.webp` — cta

- **Size:** 1920 × 800
- **Alt text (already in the code):** A backgammon board seen from above at night
- **Prompt:** Top-down view of a walnut backgammon board mid-game at night, warm lamp light from one side, deep shadows, wide banner composition. + shared style above.

### 10. `auth-panel.webp` — auth

- **Size:** 1080 × 1440
- **Alt text (already in the code):** A hand placing a checker on a backgammon board
- **Prompt:** Elegant close-up of a hand placing a cream checker on a walnut backgammon board, face not visible, warm gold light, navy background, vertical portrait composition. + shared style above.

### 11. `og-image.png` — og

- **Size:** 1200 × 630
- **Alt text (already in the code):** Backgammon social preview
- **Prompt:** Wide hero shot of a walnut backgammon board with dice, generous empty space on the right for a title to be added later. + shared style above.

## Not AI-generated on purpose

- **"How to play" diagrams** are drawn in code so the checker positions and rules are exactly right.
- **The six board themes** use the real game board renderer, so what visitors see is what they play on.
- **Avatars** are uploaded by players; without one, a coloured initials badge is shown.

## Optional extras

- A set of 6–8 default avatar portraits (512 × 512, abstract or animal mascots, no real people) players could pick from
  instead of uploading. This needs a small code change to offer them.
- An app icon / favicon set (512 × 512 PNG, simple mark, no text).
