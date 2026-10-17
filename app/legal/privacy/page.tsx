import { BRAND } from "@/lib/brand";

export const metadata = { title: "Privacy Policy" };

const UPDATED = "18 October 2026";

export default function Privacy() {
  return (
    <article className="card legal-doc">
      <h1>Privacy Policy</h1>
      <p className="muted small">Last updated {UPDATED}</p>
      <p>
        This explains what {BRAND.name} collects, why, and your choices. The controller is <strong>[operator&apos;s legal name and address]</strong>.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account:</strong> your wallet address and the network you signed in with; the name, photo, bio and country you choose; your settings.
        </li>
        <li>
          <strong>Games:</strong> every match&apos;s moves, dice, results, clocks, ratings, XP, quests, leaderboard points, chat messages and reactions.
        </li>
        <li>
          <strong>Technical:</strong> when you were last active; a salted one-way hash of your network (IP) address, used only to detect multiple accounts and
          abuse (we do not store the address itself); your browser type when you send feedback; error reports with a reference number.
        </li>
        <li>
          <strong>What you send us:</strong> problem reports, feedback and the invite code you joined with.
        </li>
      </ul>
      <p>We do not collect your email, phone number or real name, and we never see your wallet&apos;s private keys.</p>
      <h2>Why</h2>
      <ul>
        <li>To run the games, accounts, leaderboards, tournaments and chat (performing our service to you).</li>
        <li>To keep play fair and safe: anti-cheat review, rate limits, moderation (our legitimate interest).</li>
        <li>To fix problems and improve the Service from errors and feedback (legitimate interest).</li>
      </ul>
      <h2>Who else processes it</h2>
      <ul>
        <li>Vercel (hosting) and Supabase (database), as our processors.</li>
        <li>Google serves the animated emoji images to your browser when chat reactions are shown.</li>
        <li>Your wallet provider (for example MetaMask or Coinbase Wallet) when you connect it, under its own policy.</li>
        <li>Optional team alerts (Discord) contain error messages and reference numbers only.</li>
      </ul>
      <p>We do not sell personal data or use advertising trackers.</p>
      <h2>How long</h2>
      <ul>
        <li>Guest profiles: deleted after 30 minutes without activity.</li>
        <li>Accounts and their match history: while the account exists.</li>
        <li>Error reports: 30 days. Encrypted backups: 30 days.</li>
        <li>Records we must keep (for example ledger entries and admin audit logs) are kept as long as the law requires, and are not deleted.</li>
      </ul>
      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example the EU/UK GDPR or Canada&apos;s PIPEDA) you can ask to access, correct, export or delete your data, or object
        to some uses. Use the Help &amp; report form in your profile or <strong>[privacy email]</strong>. You can also complain to your data-protection
        authority.
      </p>
      <h2>Children</h2>
      <p>The Service is not meant for children under 13. If you believe a child has an account, tell us and we will delete it.</p>
      <h2>Changes</h2>
      <p>We will update this page and the date above when our practices change, and announce important changes in the app.</p>
    </article>
  );
}
