# Wallet-based accounts

In this app **the wallet is the account**. There is no email or password.

## How it works

1. **Connect.** **Connect Wallet** opens the app's own wallet window, laid out like Reown AppKit's
   (wagmi 3, browser wallets only). Wallets installed in the browser are listed by name (EIP-6963:
   MetaMask, Rabby, Brave, Coinbase, Trust, OKX, Phantom, and the wallet apps' own browsers), with the
   one used last marked *Recent*. On a phone without a wallet browser, the popular wallets open this
   site inside their app; on a computer without the extension they link to its download. There is no
   WalletConnect and no QR code. The signature below is asked for as soon as a wallet connects.
2. **Sign in with Ethereum (EIP-4361 / "SIWE").** The server issues a one-time nonce. The wallet signs a
   human-readable message containing this site's domain, the address, the chain and the nonce.
   Signing is free: no transaction, no gas, no funds move.
3. **Verify.** The server checks the domain, the nonce (single use, 10-minute expiry, bound to the browser
   session), the expiry time and the signature. Normal wallets are checked offline. Smart-contract wallets
   (e.g. Coinbase Smart Wallet, Safe) are checked on-chain via EIP-1271/6492.
4. **Account.**
   - First sign-in with an address → a new account is created. If the visitor was playing as a guest,
     that guest *becomes* the account, keeping its games, and receives the welcome practice credits.
     They then pick a name and photo on `/welcome`.
   - Later sign-ins with the same address, from any device → the same account.
5. **Session.** After verification the browser gets a fresh httpOnly session cookie (rotated on every
   sign-in). Switching accounts in the wallet signs the player out automatically.

Guests can play free games (online, computer, pass & play) without a wallet. A guest with no activity
for 30 minutes is removed with its computer and unfinished games; finished online matches against
others stay in those players' history. Guests have no balances. Payments will need a wallet account.

## Things to know (product decisions)

| Topic | Current behaviour | Decision needed |
| --- | --- | --- |
| Lost wallet | No recovery — losing the wallet's recovery phrase means losing the account | Add a recovery method later (e.g. link a second wallet, or email as a backup factor)? |
| One wallet per account | Yes. A second address is a second account | Allow linking several wallets to one account? |
| Supported networks | Base (default), Ethereum, Optimism, Arbitrum, Polygon, plus Base Sepolia/Sepolia for testing | Which chains for production, and which one for stablecoin deposits |
| QR / WalletConnect | Removed: browser wallets and wallet-app browsers only | Bring back WalletConnect if desktop users without an extension need their phone wallet |
| Paid play / KYC | A wallet proves control of an address, not identity or age | Eligibility, age and territory checks before token play (spec 05) |
| Deposits | Still simulated; connecting a wallet does not move funds | Choose the stablecoin + chain + contract and a provider (spec 06) |
| ENS names / avatars | Not shown | Optional: display ENS name and avatar on profiles |

## Where the code is

- `lib/client/wagmi.ts`: chains and the browser-wallet connector
- `public/wallets/`: icons for the wallets listed when they are not installed
- `components/WalletDialog.tsx`: the wallet window (choose, connect, sign the SIWE message, finish sign-in)
- `components/Web3Provider.tsx`: wagmi + React Query, the dialog, and sign-out when the wallet switches account
- `components/WalletButton.tsx`: the header button / account chip
- `lib/server/siwe.ts`: nonce, verification, account creation and session rotation
- `app/api/auth/nonce`, `app/api/auth/verify`, `app/api/auth/logout`: the endpoints
- `tests/accounts.test.ts`: forged signatures, replayed nonces, wrong domain and wrong chain are all rejected
- `e2e/wallet.spec.ts`: a stand-in browser wallet signs up, signs out, signs back in and unlocks the admin area
