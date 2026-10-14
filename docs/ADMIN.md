# Admin area

`/admin` is for operators. It is hidden from everyone else: without an admin session every
`/api/admin/*` call answers `404 Not found`, and the page only shows a neutral sign-in card.

## Getting in

1. Sign in to the app with your wallet as usual.
2. Open `/admin` and press **Unlock admin area**. Your wallet signs a short message. Signing is free
   and sends no transaction.
3. The server checks the signature, checks your role, and opens a separate admin session.
   It is stored in an `httpOnly`, `SameSite=Strict` cookie, ends after 30 idle minutes or 8 hours,
   and only works together with the same wallet's game session.

**The first Owner** comes from the `ADMIN_BOOTSTRAP_WALLETS` environment variable, a comma-separated
list of wallet addresses. It applies only to a wallet that never held a role, so removing someone's
role is never undone by the variable. After that, Owners add other admins on the **Admins** page.
The person must have signed in once with that wallet first.

## Roles

| Permission | Owner | Operator | Finance | Viewer |
| --- | :-: | :-: | :-: | :-: |
| Dashboard, players, matches, reports (read) | ✓ | ✓ | ✓ | ✓ |
| Suspend / lift, force logout, reset profile | ✓ | ✓ | | |
| Close tables, void matches | ✓ | ✓ | | |
| Handle reports (assign, notes, resolve) | ✓ | ✓ | | |
| Finance: ledger, deposits, withdrawals | ✓ | | ✓ | |
| Request / approve balance adjustments | ✓ | | ✓ | |
| Settings, announcements | ✓ | | | |
| Manage admins | ✓ | | | |
| Audit log | all | own | own | own |

There is always at least one Owner, and nobody can act on their own account.

## Signed actions

These actions ask the wallet to sign a message that names the action, its target and the reason:
suspend, lift a suspension, void a match, request, approve or reject an adjustment, grant or remove
a role, and change settings. The server accepts the signature only for exactly that action. Each
signature works once and expires after 5 minutes. It is stored with the audit record.

Balance adjustments need **two people**: one admin requests it, and a different Finance admin or
Owner approves it. Approval posts a balanced ledger transaction, using `system:ADJUSTMENTS` for
tokens or `system:FREE_ISSUANCE` for practice credits.

## Audit log

Every admin action is written to `admin_audit`: who, which role, action, target, reason,
before/after, IP address, browser and signature. A database trigger rejects any update or delete
of these rows. Denied unlock attempts are recorded too.

## What players see

* **Suspended** players are signed out everywhere. They cannot sign in with that wallet or start
  or join matches until the suspension ends.
* **Voided** matches stay on record with the reason and drop out of both players' stats.
  Free matches hold no tokens, so nothing needs to be reversed.
* **Maintenance mode** blocks new matches and tables. Games in progress continue, and the
  message shows on Home and in the Lobby.
* **Announcements** appear at the top of Home and the Lobby until they are ended or expire.
