import Link from "next/link";
import { Brand } from "@/components/BrandMark";
import GameIcon, { type IconName } from "@/components/GameIcon";
import WalletButton from "@/components/WalletButton";
import Reveal from "@/components/Reveal";
import ArenaScene from "@/components/landing/ArenaScene";
import LandingNav from "@/components/landing/LandingNav";
import OpenAppLink from "@/components/landing/OpenAppLink";
import LiveStats from "@/components/landing/LiveStats";
import TiltCard from "@/components/landing/TiltCard";
import { BRAND } from "@/lib/brand";
import { UPCOMING_GAMES } from "@/lib/games";
import "./landing.css";

const MARQUEE = [
  "Backgammon & Chess live now",
  "Poker · Cribbage · Checkers in development",
  "Weekly & monthly tournaments",
  "One Arena level across every game",
  "Server-checked fair play",
  "Wallet sign-in — no passwords",
  "Built for the phone in your hand",
];

const LIVE: { id: IconName; name: string; href: string; pitch: string; points: string[] }[] = [
  {
    id: "backgammon",
    name: "Backgammon",
    href: "/play/backgammon",
    pitch: "Five thousand years old and still undefeated. Race fifteen checkers home, hit, block — and raise the stakes with the doubling cube.",
    points: ["Fair server-rolled dice", "Match play 1–7 points", "Six handcrafted boards"],
  },
  {
    id: "chess",
    name: "Chess",
    href: "/play/chess",
    pitch: "The board every strategist grew up on. Bullet, blitz or rapid against players worldwide, a friend, or a computer that thinks hard.",
    points: ["Bullet, blitz & rapid clocks", "Rated games with Elo", "Animated board, every rule checked"],
  },
];

const SOON_TEXT: Record<string, string> = {
  poker: "Cash-style tables and sit & go tournaments, with the same fair, server-checked play.",
  cribbage: "Pegging, the crib and the race to 121 — the pub classic, rebuilt for quick matches.",
  checkers: "Fast, tactical and timeless. Forced captures, crowned kings and rated games.",
};

const PLATFORM: { icon: string; title: string; text: string }[] = [
  {
    icon: "M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.6 6.5 19.5l1-6.3L3 8.9 9 8z",
    title: "One Arena level",
    text: "Every game you play earns XP toward one level that unlocks avatar frames — plus a level in each game.",
  },
  {
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    title: "Daily & weekly quests",
    text: "Short goals in any game, or in one game you love, with XP rewards to claim.",
  },
  {
    icon: "M7.5 4h9v5a4.5 4.5 0 0 1-9 0zM7.5 6h-3a3 3 0 0 0 3.2 4.3M16.5 6h3a3 3 0 0 1-3.2 4.3M12 13.5V17M8.5 20.5h7",
    title: "Tournaments",
    text: "Weekly and monthly cups, special events and sit & go tables, run by the team with rewards for the top finishers.",
  },
  { icon: "M4 20V10M10 20V4M16 20v-7M22 20H2", title: "Ranks & ratings", text: "A separate rating for every game and weekly leaderboards to climb." },
  {
    icon: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6zM9 12l2 2 4-4",
    title: "Fair by design",
    text: "The server checks every move and rolls every die with a cryptographic generator. Anti-cheat watches the rest.",
  },
  {
    icon: "M3 7h18v12H3zM16 13h2M3 7l3-4h12l3 4",
    title: "Wallet = account",
    text: "Connect a wallet and sign one free message. No email, no password — your stats follow your address.",
  },
  { icon: "M7 2h10v20H7zM11 18h2", title: "Play anywhere", text: "Made for one-handed phone play. No download, no install — a tap and you're at the table." },
  {
    icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    title: "Friends & spectators",
    text: "Invite a friend with a link, chat during the game, and watch the best tables live.",
  },
];

const ROADMAP = [
  { when: "Live now", title: "The Arena opens", text: "Backgammon and Chess, the Arena level, quests, tournaments, ranks and wallet accounts.", done: true },
  { when: "Next", title: "Three new tables", text: "Poker, Cribbage and Checkers join the Arena with their own lobbies, ratings and quests." },
  {
    when: "Then",
    title: "Seasons & prize events",
    text: "Seasonal ladders, bigger tournament series and prize events — token play only where it is permitted.",
  },
  { when: "Beyond", title: "A player-owned arena", text: "Clubs, community-run events and more classic games, shaped by the people who play them." },
];

export default function Landing() {
  return (
    <div className="landing">
      <LandingNav />

      <section className="l-hero">
        <div className="l-aurora" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <ArenaScene />
        <div className="l-hero-fade" aria-hidden />
        <div className="l-hero-content">
          <span className="l-kicker l-in" style={{ animationDelay: "60ms" }}>
            <span className="live-dot" aria-hidden /> {BRAND.name} · live multiplayer
          </span>
          <h1 className="l-title display l-in" style={{ animationDelay: "140ms" }}>
            Classic strategy games. <span className="l-shine">One living arena.</span>
          </h1>
          <p className="l-lead l-in" style={{ animationDelay: "240ms" }}>
            Backgammon and Chess today — Poker, Cribbage and Checkers on the way. One account, one level, real opponents, tournaments every week. Free to play
            on any phone.
          </p>
          <div className="l-ctas l-in" style={{ animationDelay: "340ms" }}>
            <OpenAppLink className="btn primary lg" label="Play free now" />
            <WalletButton className="btn lg l-ghost" label="Connect Wallet" />
          </div>
          <div className="l-game-pills l-in" style={{ animationDelay: "420ms" }}>
            {LIVE.map((g) => (
              <Link key={g.id} href={g.href} className="l-pill live">
                <GameIcon name={g.id} size={16} /> {g.name}
              </Link>
            ))}
            {UPCOMING_GAMES.map((g) => (
              <span key={g.id} className="l-pill">
                <GameIcon name={g.id} size={16} /> {g.name}
              </span>
            ))}
          </div>
          <div className="l-in" style={{ animationDelay: "500ms" }}>
            <LiveStats />
          </div>
        </div>
        <a className="l-scroll" href="#games" aria-label="Scroll to the games">
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

      <section id="games" className="l-section">
        <Reveal className="l-head">
          <span className="eyebrow">The games</span>
          <h2 className="l-h2 display">Every classic, one table away</h2>
          <p className="muted">
            Two games are live and three more are in development — each with its own lobby, rating and quests, all feeding one Arena level.
          </p>
        </Reveal>
        <div className="l-live-games">
          {LIVE.map((g, i) => (
            <Reveal key={g.id} delay={i * 120}>
              <TiltCard className={`l-game l-game-${g.id}`}>
                <div className="l-game-art" aria-hidden>
                  {g.id === "backgammon" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/images/hero.webp" alt="" loading="lazy" />
                  ) : (
                    <ChessMini />
                  )}
                </div>
                <div className="l-game-body">
                  <div className="spread">
                    <span className="l-game-icon">
                      <GameIcon name={g.id} size={26} />
                    </span>
                    <span className="badge live">Live</span>
                  </div>
                  <h3 className="display">{g.name}</h3>
                  <p className="muted">{g.pitch}</p>
                  <ul className="l-ticks">
                    {g.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <Link className="btn primary" href={g.href}>
                    Play {g.name}
                  </Link>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
        <div className="l-soon-games">
          {UPCOMING_GAMES.map((g, i) => (
            <Reveal key={g.id} delay={i * 110} as="article" className={`l-soon l-soon-${g.id}`}>
              <span className="l-soon-art" aria-hidden>
                <GameIcon name={g.id} size={64} />
              </span>
              <span className="badge warn">In development</span>
              <h3 className="display">{g.name}</h3>
              <p className="muted">{SOON_TEXT[g.id]}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="platform" className="l-section">
        <Reveal className="l-head">
          <span className="eyebrow">The platform</span>
          <h2 className="l-h2 display">More than a game room</h2>
          <p className="muted">Everything around the board is built once and shared by every game, so each new game arrives with the whole Arena behind it.</p>
        </Reveal>
        <div className="l-platform">
          {PLATFORM.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 90} as="article" className="l-feat">
              <span className="l-feat-icon" aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={f.icon} />
                </svg>
              </span>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="l-level" delay={100}>
          <div>
            <span className="eyebrow">Arena level</span>
            <h3 className="display">Every move counts, in every game</h3>
            <p className="muted">
              Win a chess blitz, finish a backgammon match, clear a quest — it all adds up to one level that shows on your profile and at every table.
            </p>
          </div>
          <div className="l-level-demo" aria-hidden>
            {[
              ["backgammon", "Backgammon", 72],
              ["chess", "Chess", 46],
              ["trophy", "Tournaments", 28],
            ].map(([icon, label, pct]) => (
              <div key={label} className="l-level-row">
                <GameIcon name={icon as string} size={18} />
                <span>{label}</span>
                <span className="l-level-bar">
                  <span style={{ ["--w" as string]: `${pct}%` }} />
                </span>
              </div>
            ))}
            <div className="l-level-total">
              <span className="l-level-badge display">12</span>
              <span>
                <strong>Arena Lv 12</strong>
                <span className="muted small">all games together</span>
              </span>
            </div>
          </div>
        </Reveal>
      </section>

      <section id="vision" className="l-section l-vision">
        <Reveal className="l-vision-inner">
          <span className="eyebrow">Our vision</span>
          <h2 className="l-h2 display">
            Where the world&apos;s classic games <span className="l-shine">meet, compete and live on.</span>
          </h2>
          <p>
            Backgammon, chess, poker, cribbage and checkers have been played across kitchen tables, cafés and clubs for centuries. They belong together.{" "}
            {BRAND.name} gives them one modern home: instant matches against real people, honest rules enforced by the server, and a reason to come back every
            day.
          </p>
          <div className="l-pillars">
            <div>
              <strong className="display">Skill first</strong>
              <span>Ratings, ranks and tournaments reward how well you play — not how much you spend.</span>
            </div>
            <div>
              <strong className="display">Fair by default</strong>
              <span>Every move and every roll is checked and recorded by the server. Nothing is left to trust.</span>
            </div>
            <div>
              <strong className="display">Built with players</strong>
              <span>Your wallet is your account, and the community helps decide what comes next.</span>
            </div>
          </div>
        </Reveal>
      </section>

      <section id="roadmap" className="l-section">
        <Reveal className="l-head">
          <span className="eyebrow">Roadmap</span>
          <h2 className="l-h2 display">Where the Arena is heading</h2>
        </Reveal>
        <ol className="l-road">
          {ROADMAP.map((r, i) => (
            <Reveal key={r.title} as="li" delay={i * 120} className={`l-stop${r.done ? " done" : ""}`}>
              <span className="l-stop-dot" aria-hidden />
              <span className="l-stop-when">{r.when}</span>
              <h3>{r.title}</h3>
              <p className="muted">{r.text}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      <section className="l-cta">
        <div className="l-aurora" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <Reveal className="l-cta-content">
          <h2 className="l-h2 display">Your seat in the Arena is waiting.</h2>
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
            <Link href="/play">Games</Link>
            <Link href="/tournaments">Tournaments</Link>
            <Link href="/signup">Connect wallet</Link>
            <Link href="/fair">Fair play</Link>
            <Link href="/beta">Beta testers</Link>
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/cookies">Cookies</Link>
          </nav>
          <p className="muted small">
            © {new Date().getFullYear()} {BRAND.name}. Free play is available to everyone. Token play will open only where permitted and only for adults (18+).
            Please play responsibly.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** A small board where a knight, a bishop and a queen take turns gliding (pure CSS). */
function ChessMini() {
  return (
    <div className="l-chess">
      <div className="l-chess-board" />
      <span className="l-cp white k1">♞&#xFE0E;</span>
      <span className="l-cp black k2">♝&#xFE0E;</span>
      <span className="l-cp white k3">♛&#xFE0E;</span>
      <span className="l-cp black k4">♚&#xFE0E;</span>
      <span className="l-cp white k5">♜&#xFE0E;</span>
    </div>
  );
}
