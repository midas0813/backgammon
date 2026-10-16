-- One-time clean-up before launch: remove all test matches and all guest accounts (no wallet) with
-- what they own. Wallet accounts, balances, admin roles and the audit log stay. The ledger journal is
-- append-only, so the old practice-credit grants of removed guests remain there as inert history;
-- from now on guests get no credits, so nothing new accumulates.

-- All matches so far were tests.
delete from match_events;
delete from match_actions;
delete from match_results;
delete from match_presence;
delete from match_spectators;
delete from matches;
update app_counters set value = 0 where key = 'games';

-- Test reports.
delete from dispute_notes;
delete from disputes;

-- Guest accounts and what belongs to them (sessions and avatars go with the account).
delete from admin_adjustments where user_id in (select id from app_users where wallet_address is null);
delete from deposit_intents where user_id in (select id from app_users where wallet_address is null);
delete from withdrawals where user_id in (select id from app_users where wallet_address is null);
delete from app_users where wallet_address is null;
