-- 002_balance_after.sql — the provider's own statement of the balance.
--
-- docs/04-features/02-wallets.md §"Flow: balance handling" rule 1: "When a committed
-- Transaction carries a balance-after for its Wallet, the Wallet `balance` snaps to that
-- reported value. Reported wins because it is the provider's own statement of truth."
--
-- Until this migration there was nowhere to put that value. The parser extracted it, the
-- normalizer carried it, and the orchestrator dropped it — so every wallet balance was the
-- signed sum of whatever the app managed to parse, drifting further from the bank's real
-- figure with each missed notification, silently and permanently.
--
-- THIS BREAKS THE FOUNDATION'S "feature plans never run DDL" CONVENTION. Deliberately, and by
-- the project owner's explicit decision (m1c task-3b brief): the alternative is shipping
-- balances that quietly disagree with the user's bank, which is the failure this app exists
-- to prevent.
--
-- Both columns are NULLABLE and are written as a PAIR — set together on a reporting
-- transaction, NULL together on every other one. Most notifications carry no balance, manual
-- entries never do, and cash cannot. NULL means "no report", which is a different fact from
-- a reported ₱0.00 (a drained wallet) — hence nullable rather than DEFAULT 0.
--
-- ADD COLUMN, not a table rebuild: SQLite appends the column and rewrites nothing, so every
-- existing row keeps every value it had and contract §3's sixteen columns keep their exact
-- positions. A drop-and-recreate would destroy the ledger that explains every balance the app
-- has ever shown.

-- The balance the provider itself reported after this transaction, in centavos.
ALTER TABLE transactions ADD COLUMN balance_after INTEGER;

-- What the balance WOULD have been by the computed rule (spec rule 2) at the instant this row
-- committed: the wallet's balance immediately before it, plus this row's signed effect.
-- Recorded only on rows that also carry `balance_after`, because that is the moment the two
-- figures can be compared — and the snap overwrites the computed one a heartbeat later, so it
-- is unrecoverable afterwards. Rule 3's drift explainer has to show BOTH numbers; a boolean
-- "they disagree" leaves it with nothing to explain.
ALTER TABLE transactions ADD COLUMN computed_balance INTEGER;
