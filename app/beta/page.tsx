import Link from "next/link";
import FeedbackButton from "@/components/FeedbackButton";

export const metadata = { title: "Beta tester guide" };

/** How to join the beta, what to try, and how to tell us what you find. */
export default function BetaGuide() {
  return (
    <main className="page">
      <span className="eyebrow">Beta</span>
      <h1 className="display">Tester guide</h1>
      <section className="card">
        <h2>1. Join</h2>
        <ol className="small fair-steps">
          <li>Open the invite link from your community (it remembers your invite code).</li>
          <li>Play straight away as a guest, or tap Connect Wallet to make an account that keeps your stats, level and rank.</li>
          <li>On a phone, open the site in your wallet app&apos;s browser, or use the MetaMask app option.</li>
        </ol>
      </section>
      <section className="card">
        <h2>2. Try</h2>
        <ul className="small fair-steps">
          <li>Play the computer, then an online match: create a table or pick one in Find a game.</li>
          <li>Watch the clock, try disconnecting on purpose (airplane mode) and coming back.</li>
          <li>Finish a match, check the dice with “Verify this game”, watch the replay, ask for a rematch, add your opponent as a friend.</li>
          <li>Complete a quest on Home, check your rank under Ranks, join a sit &amp; go tournament.</li>
          <li>Chat and send reactions while watching someone else&apos;s match.</li>
        </ul>
      </section>
      <section className="card">
        <h2>3. Tell us</h2>
        <p className="muted small">
          The Feedback button is in the header of every page and in the match menu. If something breaks, the error screen gives you a reference number to
          include.
        </p>
        <FeedbackButton className="btn primary" />
      </section>
      <Link className="btn" href="/play">
        Start playing →
      </Link>
    </main>
  );
}
