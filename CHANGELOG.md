# Changelog

## 2026-10-17

**Game rules**
- One game at a time per player, enforced on the server across tabs and devices, with a window that
  offers to resume, close the table, end the computer game or forfeit.
- Left games end on their own: abandonment after 10 minutes away on your turn while the opponent
  waits; no result when both leave for 30 minutes; called off if the host doesn't return within 2
  minutes of someone joining; invites expire after 15 minutes; public tables after 15 minutes without
  the host or after 1 hour; computer and pass & play games after a day alone.
- Hosts whose phone is in the background stay listed as "host away" and are alerted when they return.
- "Your turn" dice show what the opponent just rolled.

**Spectators and chat**
- Players and spectators chat with preset phrases and their own words; emoji reactions float over
  the board. The host chooses whether spectators may watch, chat and react, and can remove a
  spectator. Messages can be reported; admins can remove them.
- Instant updates through Supabase Realtime (when configured), with polling as a backup.

**Phones**
- Edge-to-edge board, one-tap moves, large destination buttons, forgiving taps, landscape layout.
- Pass & play and computer games refresh only when needed.

**Accounts**
- Guests are removed after 30 minutes without activity; practice credits now come with a wallet account.
- Wallet connection rebuilt on wagmi 3 with an in-app dialog (RainbowKit removed). Production
  dependencies have no known vulnerabilities.
- Pre-launch test matches and guest accounts were cleared.

**Scale and reliability**
- Stats come from a per-match results table; history is paged; lists read summary columns only.
- Each move appends to an event log instead of rewriting the whole match.
- Site counters, cached public stats, "live" counts only recent matches.
- Request limits on every write; error screens with reference numbers; offline banner; errors stored
  and shown to admins, with Discord alerts; daily clean-up job; nightly encrypted backups.

**Admin**
- Audit log label shows what is listed (everyone, one person, or only your own actions); filter by person.
- Match view shows the chat; latest errors on the dashboard.

**Engineering**
- ESLint, Prettier, knip; dead code removed; GitHub Actions CI with unit tests on both stores and
  browser tests in Chromium, WebKit and a phone viewport; documentation refreshed.
