/**
 * AI-generated image slots. Put each file in /public/images/<file>; until then a built-in SVG scene
 * renders instead. Full brief with prompts: docs/IMAGE_BRIEF.md.
 */
export type ArtKey = "hero" | "history" | "modeQuick" | "modeComputer" | "modeRanked" | "modeTournament" | "fairDice" | "wallet" | "cta" | "auth" | "og";

export interface ArtSlot {
  file: string;
  width: number;
  height: number;
  alt: string;
  usedOn: string;
  prompt: string;
  fallback: "hero" | "quick" | "computer" | "ranked" | "tournament" | "history" | "fair" | "wallet" | "cta" | "auth";
}

export const ART: Record<ArtKey, ArtSlot> = {
  hero: {
    file: "hero.webp",
    width: 1920,
    height: 1080,
    alt: "Players around a backgammon table in a rooftop lounge at night, city skyline behind",
    usedOn: "Landing hero background (cropped to centre on phones — keep the subject in the middle 50%)",
    prompt:
      "Low-angle close-up of a luxurious walnut backgammon board on a dark table, two ivory dice frozen mid-air above it, " +
      "cream and deep-navy checkers stacked on the points, glowing mint and gold rim light, floating dust particles, " +
      "dramatic negative space on the left for headline text.",
    fallback: "hero",
  },
  history: {
    file: "intro-history.webp",
    width: 1200,
    height: 900,
    alt: "An ancient board game carved in stone beside a modern backgammon board",
    usedOn: "Landing — “What is backgammon?” section",
    prompt:
      "An ancient Mesopotamian race game board carved in stone (Royal Game of Ur style) beside a modern polished walnut " +
      "backgammon board, museum lighting, sand and gold tones blending into navy shadows, sense of 5,000 years of history.",
    fallback: "history",
  },
  modeQuick: {
    file: "mode-quick.webp",
    width: 1200,
    height: 675,
    alt: "Two dice tumbling with motion trails",
    usedOn: "Landing — Quick match card",
    prompt: "Two ivory dice tumbling fast across a navy felt surface, crisp mint-green motion trails, energetic, macro photo.",
    fallback: "quick",
  },
  modeComputer: {
    file: "mode-computer.webp",
    width: 1200,
    height: 675,
    alt: "A glowing circuit pattern forming a backgammon board",
    usedOn: "Landing — vs Computer card",
    prompt:
      "Backgammon board whose triangle points are made of glowing mint circuit traces on dark glass, a single cream checker " +
      "in focus, futuristic but warm, subtle gold highlights.",
    fallback: "computer",
  },
  modeRanked: {
    file: "mode-ranked.webp",
    width: 1200,
    height: 675,
    alt: "A gold trophy beside stacked backgammon checkers",
    usedOn: "Landing — Ranked card (shown as “coming soon”)",
    prompt: "A small brushed-gold trophy next to a tall stack of cream checkers on walnut, spotlight from above, navy background.",
    fallback: "ranked",
  },
  modeTournament: {
    file: "mode-tournament.webp",
    width: 1200,
    height: 675,
    alt: "Several backgammon boards in a dim tournament hall",
    usedOn: "Landing — Tournaments card (shown as “coming soon”)",
    prompt: "Rows of backgammon boards on tables in a dim elegant tournament hall, bokeh lights, mint and gold accents, no people " + "in focus, anticipation.",
    fallback: "tournament",
  },
  fairDice: {
    file: "feature-fair-dice.webp",
    width: 1200,
    height: 675,
    alt: "A die inside a translucent protective shield",
    usedOn: "Landing — Fair dice feature",
    prompt: "A single ivory die suspended inside a translucent hexagonal glass shield, mint glow, clean dark background, trust and fairness.",
    fallback: "fair",
  },
  wallet: {
    file: "feature-wallet.webp",
    width: 1200,
    height: 675,
    alt: "Gold tokens stacked beside a digital wallet",
    usedOn: "Landing — Wallet & tokens feature",
    prompt:
      "Stacks of minimal gold game tokens embossed with a die pip pattern beside a sleek dark smartphone showing an abstract " +
      "glowing wallet card, soft reflections. Avoid real currency symbols or crypto brand logos.",
    fallback: "wallet",
  },
  cta: {
    file: "cta-background.webp",
    width: 1920,
    height: 800,
    alt: "A backgammon board seen from above at night",
    usedOn: "Landing — final call-to-action band (dark overlay is added on top)",
    prompt: "Top-down view of a walnut backgammon board mid-game at night, warm lamp light from one side, deep shadows, wide banner composition.",
    fallback: "cta",
  },
  auth: {
    file: "auth-panel.webp",
    width: 1080,
    height: 1440,
    alt: "A hand placing a checker on a backgammon board",
    usedOn: "Sign-up and sign-in pages (side panel on desktop, header strip on phones)",
    prompt:
      "Elegant close-up of a hand placing a cream checker on a walnut backgammon board, face not visible, warm gold light, " +
      "navy background, vertical portrait composition.",
    fallback: "auth",
  },
  og: {
    file: "og-image.png",
    width: 1200,
    height: 630,
    alt: "Backgammon social preview",
    usedOn: "Link previews (WhatsApp, X, Slack, iMessage). Text may be added afterwards in a design tool.",
    prompt: "Wide hero shot of a walnut backgammon board with dice, generous empty space on the right for a title to be added later.",
    fallback: "hero",
  },
};
