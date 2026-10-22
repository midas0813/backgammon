# Changelog

## 2026-10-22

- Connect Wallet is the app's own window, laid out like Reown AppKit (wallet list with Installed and
  Recent tags, a connecting screen with a running ring, a Sign In screen, "What is a wallet?" and
  "Get a wallet"), and a bottom sheet on phones. QR-code login is gone: Reown AppKit, WalletConnect
  and the MetaMask and Coinbase SDKs are removed. Browser wallets connect directly; on a phone the
  popular wallet apps open the site in their own browser.

## 2026-10-21 (evening)

- **Tournaments are organised by admins** (new admin section *Tournaments*, for owners and operators):
  series of four kinds for any game: weekly and monthly cups (day and time in UTC), one-off events,
  and sit & go tables. Each series sets its size, the minimum players, when registration opens, the
  match format, a description and **rewards per place** (XP, practice credits, a prize in words), with
  defaults per kind that can be changed. Admins can pause, edit or remove a series, and cancel or
  start a tournament early. Scheduled tournaments start on time with whoever registered (seeded by
  rating, byes for the top seeds) or are cancelled without enough players. A drawn chess game in a
  tournament goes to Black. Rewards are recorded on the tournament and shown to players.
- Tournaments page and the Home card cover every game, with a game filter, start times, countdowns
  and rewards. Chess has a Tournaments tile in its lobby.
- Coming-soon games on Play are the same tiles as live games, switched off, with "Coming soon"
  instead of Play and no level.
- One line-icon set for games and Arena features (six-sided dice for Backgammon) on Home and Play.
- Confetti now falls in place on the page and scrolls away with it instead of following the screen,
  and removes itself when done.
- New landing page for Liquen Arena: a Three.js 3D arena in the hero (chess pieces, six-sided dice,
  checkers, draughts, a cribbage board, poker chips and cards on a lit platform), the games (live
  and in development), the platform, the vision and a roadmap, with scroll and hover animations.
  three.js loads only on the landing page; reduced motion gets a still frame.

## 2026-10-21 (later)

- The platform is **Liquen Arena**. Play shows every game as a tile (Backgammon, Chess, and Poker,
  Cribbage and Checkers coming soon); each game has its own lobby (`/play/backgammon`, `/play/chess`).
- Home is the dashboard for the whole platform: Arena level (XP from every game), game cards, games to
  continue, today's matches per game, quick start for each game, live numbers across the Arena.
- Quests count matches in any game; game-specific quests are marked, and Chess has its own.
- Chess looks and feels new: a lit wooden board with sculpted pieces that glide between squares,
  capture bursts, a pulsing check, the king toppling at checkmate, a result banner, captured-piece
  trays, clocks that glow and drain, and your move shown instantly.

## 2026-10-21

**Chess, and a platform for several games**
- Chess: full rules, online play with Bullet, Blitz and Rapid clocks (base time plus increment), rated
  public tables (Elo, its own rating), draw offers, resignation, the computer in three levels, pass &
  play, spectators and chat, rematch with colours swapped.
- Games are chosen on Home (game cards with your level and rating in each, and how many are playing)
  or with the switcher at the top of the lobby; Play remembers the last game.
- XP, levels and ratings are kept per game. Backgammon numbers are unchanged.

## 2026-10-19

- The Connect Wallet window is Reown AppKit (browser wallets, QR codes, mobile wallet apps), switched on by
  the Reown project ID; until it is set the built-in dialog stays. Signing in is unchanged.
- Tournaments are easier to find: a picture tile second in the Lobby with how many have joined, and a card on
  Home. Tournament pages have the normal menus and a way back to the Lobby. Only wallet accounts can join
  tournaments; guests see "Connect a wallet to join".

## 2026-10-18

**Next phase (the plan shared with the client)**
- Match clocks: 12 free seconds per move (8 on Fast) and a time bank (1 min per point, at least 2); running out loses on time. A dropped player's bank stops and a 90-second reconnect window runs (3 minutes per match); clocks pause if both drop. Hosts choose Standard, Fast or No clock. The clock counts down from the moment a turn starts.
- Provably fair dice: a sealed server seed, a seed from each player's device, a "Fair dice" badge, "Verify this game" after the match and a public Fair Play page that checks any finished match in the browser.
- Quests: 3 daily and 3 weekly, XP and levels, practice-credit rewards for wallet accounts, avatar frames unlocked by level.
- Weekly and season leaderboard (win 2 × match length, loss 1, +1 per gammon; up to 3 matches a day against the same opponent count) and a free weekly prize pool (default 50 tokens, 50/30/20) paid after an admin's signed approval.
- Anti-cheat: flags for repeated pairings, thrown losses, shared networks, new-account streaks, robotic move timing and account farming; admins review replays and dismiss or void; flagged matches leave the prize count until decided.
- Ratings (FIBS formula) for ranked tables — public tables with a clock — with a ratings board and rating changes in match history.
- Friends with online status, direct invites, one-tap rematch, move-by-move replays.
- Free sit & go tournaments (4 and 8 players) with automatic brackets and called-to-the-board alerts.
- Spectators see ranked and tournament matches 20 s late (enforced by the server; adjustable).
- Beta tools: invite codes per community with an optional invite-only switch, a Feedback button on every screen, a tester guide.
- Terms, Privacy and Cookies pages.

**Fixes**
- Finishing or forfeiting a match failed on the production database (a driver difference); CI now runs the whole suite on a real Postgres too.
- Selecting a checker highlights its moves again (no instant move); animated Noto emojis with a full picker; "online now" counts players actually online; MetaMask's phone app connects without WalletConnect.

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
