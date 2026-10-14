import Link from "next/link";
import Art from "@/components/Art";
import { Brand } from "@/components/BrandMark";
import WalletButton from "@/components/WalletButton";
import Reveal from "@/components/Reveal";
import BoardShowcase from "@/components/landing/BoardShowcase";
import LandingNav from "@/components/landing/LandingNav";
import OpenAppLink from "@/components/landing/OpenAppLink";
import LiveStats from "@/components/landing/LiveStats";
import StepDiagram from "@/components/landing/StepDiagram";
import type { ArtKey } from "@/lib/art";
import { BRAND } from "@/lib/brand";
import "./landing.css";

const MARQUEE = [
  "Server-rolled fair dice",
  "Six handcrafted boards",
  "Doubling cube & Crawford rule",
  "Play the computer instantly",
  "Invite a friend with a link",
  "Built for one-handed phone play",
];

const STEPS = [
  { step: "roll" as const, title: "Roll", text: "Two dice decide how far you move. Doubles play four times." },
  {
    step: "move" as const,
    title: "Race home",
    text: "Move all 15 checkers around the board to your home. A point held by two opposing checkers is blocked.",
  },
  {
    step: "hit" as const,
    title: "Hit & block",
    text: "Land on a lone opposing checker to send it to the bar. Build walls of points to trap your opponent.",
  },
  { step: "off" as const, title: "Bear off", text: "Once every checker is home, take them off. First to clear all 15 wins." },
];

const MODES: { art: ArtKey; title: string; text: string; status: "live" | "soon"; href?: string }[] = [
  { art: "modeComputer", title: "vs Computer", text: "Jump straight into a game against the house bot — no waiting.", status: "live", href: "/play" },
  { art: "modeQuick", title: "Quick match", text: "Get paired with the next player online, or invite a friend with a link.", status: "live", href: "/play" },
  { art: "modeRanked", title: "Ranked", text: "Climb a skill-based leaderboard with a fair, published rating system.", status: "soon" },
  { art: "modeTournament", title: "Tournaments", text: "Bracket events with check-in, byes and clear prize rules.", status: "soon" },
];

export default function Landing() {
  return (
    <div className="landing">
      <LandingNav />

      <section className="l-hero">
        <div className="l-hero-art">
          <Art k="hero" priority position="72% 60%" />
        </div>
        <div className="l-hero-overlay" />
        <div className="l-hero-content">
          <span className="eyebrow l-in" style={{ animationDelay: "60ms" }}>
            Live multiplayer backgammon
          </span>
          <h1 className="l-title display l-in" style={{ animationDelay: "140ms" }}>
            The oldest game of skill. <span className="gradient-text">Now in your pocket.</span>
          </h1>
          <p className="l-lead l-in" style={{ animationDelay: "240ms" }}>
            Roll fair server-side dice, outplay friends or the computer, and master the doubling cube — on any phone, in seconds.
          </p>
          <div className="l-ctas l-in" style={{ animationDelay: "340ms" }}>
            <OpenAppLink className="btn primary lg" label="Play free now" />
            <WalletButton className="btn lg l-ghost" label="Connect Wallet" />
          </div>
          <div className="l-in" style={{ animationDelay: "460ms" }}>
            <LiveStats />
          </div>
        </div>
        <a className="l-scroll" href="#about" aria-label="Scroll to learn more">
          <span />
        </a>
      </section>

      <div className="l-marquee" aria-hidden>
        <div className="l-marquee-track">
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i}>
              <i>◆</i> {m}
            </span>
          ))}
        </div>
      </div>

      <section id="about" className="l-section l-split">
        <Reveal className="l-copy">
          <span className="eyebrow">What is backgammon?</span>
          <h2 className="l-h2 display">Five thousand years old. Still undefeated.</h2>
          <p>
            Backgammon is one of the oldest board games in the world — its ancestors were played in Mesopotamia around 3000 BC. Two players
            race fifteen checkers around a board of 24 triangles, moving by the roll of two dice.
          </p>
          <p>
            The dice bring luck; everything else is skill. When to run, when to block, when to hit — and when to raise the stakes with the
            doubling cube. Easy to learn in five minutes, deep enough for a lifetime.
          </p>
          <div className="l-facts">
            <div>
              <strong className="display">5,000</strong>
              <span>years of play</span>
            </div>
            <div>
              <strong className="display">15</strong>
              <span>checkers each</span>
            </div>
            <div>
              <strong className="display">24</strong>
              <span>points to race</span>
            </div>
          </div>
        </Reveal>
        <Reveal className="l-media" delay={150}>
          <Art k="history" />
        </Reveal>
      </section>

      <section id="how" className="l-section">
        <Reveal className="l-head">
          <span className="eyebrow">How to play</span>
          <h2 className="l-h2 display">Learn it in four moves</h2>
        </Reveal>
        <div className="l-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.step} className="l-step" delay={i * 110} as="article">
              <StepDiagram step={s.step} />
              <div className="l-step-n">{i + 1}</div>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="l-cube" delay={120}>
          <div className="l-cube-face display" aria-hidden>
            2
          </div>
          <div>
            <h3>The doubling cube</h3>
            <p className="muted">
              Before you roll, offer to double the stakes. Your opponent either accepts — and takes control of the cube — or passes and
              concedes the game. Win a gammon for ×2, a backgammon for ×3.
            </p>
          </div>
        </Reveal>
      </section>

      <section id="boards" className="l-section">
        <Reveal className="l-head">
          <span className="eyebrow">Six handcrafted boards</span>
          <h2 className="l-h2 display">Pick the board that feels like yours</h2>
          <p className="muted">This is the real game board — the same one you play on. Switch themes any time, even mid-game.</p>
        </Reveal>
        <Reveal delay={100}>
          <BoardShowcase />
        </Reveal>
      </section>

      <section id="modes" className="l-section">
        <Reveal className="l-head">
          <span className="eyebrow">Ways to play</span>
          <h2 className="l-h2 display">From a quick game to the final table</h2>
        </Reveal>
        <div className="l-modes">
          {MODES.map((m, i) => (
            <Reveal key={m.title} className={`l-mode${m.status === "soon" ? " soon" : ""}`} delay={i * 100} as="article">
              <div className="l-mode-art">
                <Art k={m.art} />
              </div>
              <div className="l-mode-body">
                <div className="spread">
                  <h3>{m.title}</h3>
                  {m.status === "live" ? <span className="badge live">Live</span> : <span className="badge warn">Coming soon</span>}
                </div>
                <p className="muted">{m.text}</p>
                {m.href && (
                  <Link className="btn sm primary" href={m.href}>
                    Play now
                  </Link>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="l-section l-features">
        <Reveal className="l-feature" as="article">
          <div className="l-feature-art">
            <Art k="fairDice" />
          </div>
          <div className="l-feature-body">
            <span className="eyebrow">Fair by design</span>
            <h3 className="display">Dice you can trust</h3>
            <p className="muted">
              Every roll is generated on the server with a cryptographic random generator and saved before anyone sees it. Players only
              propose moves — the server checks every rule, so no one can fake a roll, a move or a result.
            </p>
          </div>
        </Reveal>
        <Reveal className="l-feature" as="article" delay={120}>
          <div className="l-feature-art">
            <Art k="wallet" />
          </div>
          <div className="l-feature-body">
            <span className="eyebrow">Wallet = account</span>
            <h3 className="display">No email. No password.</h3>
            <p className="muted">
              Connect MetaMask, Coinbase Wallet or any browser wallet and sign one free message — that creates your account. Your stats,
              avatar and tokens follow your address. Tokens (1 = $1) power stake games; purchases and payouts are simulated in this
              preview build.
            </p>
            <div className="row">
              <WalletButton className="btn gold" />
            </div>
          </div>
        </Reveal>
      </section>

      <section className="l-cta">
        <div className="l-cta-art">
          <Art k="cta" />
        </div>
        <div className="l-cta-overlay" />
        <Reveal className="l-cta-content">
          <h2 className="l-h2 display">Your board is set.</h2>
          <p>Free to play. No download. Your first game starts in one tap.</p>
          <div className="l-ctas" style={{ justifyContent: "center" }}>
            <OpenAppLink className="btn primary lg" label="Play now" />
            <WalletButton className="btn lg l-ghost" label="Connect Wallet" />
          </div>
        </Reveal>
      </section>

      <footer className="l-footer">
        <div className="l-footer-inner">
          <Link href="/" className="brand">
            <Brand />
          </Link>
          <nav className="row">
            <Link href="/home">Open app</Link>
            <Link href="/signup">Connect wallet</Link>
            <Link href="/wallet">Wallet</Link>
          </nav>
          <p className="muted small">
            © {new Date().getFullYear()} {BRAND.name}. Free play is available to everyone. Token play will open only where permitted and only
            for adults (18+). Please play responsibly.
          </p>
        </div>
      </footer>
    </div>
  );
}
