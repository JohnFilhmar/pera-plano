-- 013_wallet_traits.sql — the app stops asking what kind of wallet this is and
-- starts working it out.
--
-- WHAT IS BEING REPLACED. Onboarding used to demand a `WalletType` — one of
-- bank / e-wallet / cash / credit / savings — for every wallet it proposed,
-- before the user had entered a single transaction. That is a taxonomy they do
-- not think in, forced to ONE answer when a provider app commonly fronts a
-- current account, a savings account and a card, asked at the moment when both
-- they and the app know least. Every signal that would answer it arrives later.
--
-- ADDITIVE ON PURPOSE. `type` stays here with its CHECK constraint intact;
-- 014_drop_wallet_type.sql removes it, once every reader has moved to the
-- columns below. Splitting it that way is what lets the tree compile and the
-- suite pass at each step in between — one migration would leave the app broken
-- between the schema change and the last screen edit.
--
-- `owed_balance` IS THE SIGN OF THE HEADLINE NUMBER. A wallet carrying it is
-- excluded from the Wallets-tab total and from Safe-to-Spend, because its
-- balance is money OWED rather than money held. Getting it wrong inflates a
-- budgeting app's first figure by the size of the user's debt, which is why the
-- verdict has its own scorer (lib/wallets/classification.ts) with hysteresis
-- rather than a rule inline in the ingest pipeline.
--
-- `owed_pinned` MEANS THE USER SETTLED IT — by answering the review-queue
-- question or correcting it on the wallet screen. Inference reads a pinned
-- wallet and never writes it again.
--
-- WHAT IS NOT HERE. There is no `manual_only` column. A wallet nothing routes
-- to — no `wallet_matchers` row — is exactly what `type: 'cash'` meant, so it is
-- derived from a COUNT at read time. A stored flag would need a listener to
-- stay true when the last matcher is removed; a count cannot go stale.
--
-- Never edit 001-012 — add a new numbered migration instead.
ALTER TABLE wallets ADD COLUMN owed_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN owed_pinned INTEGER NOT NULL DEFAULT 0;

-- An explicit `credit` choice is the user's OWN ANSWER to this exact question,
-- in the only vocabulary the app offered at the time, so it migrates as pinned.
-- Every other type migrates as unanswered: assumed held, still learnable.
UPDATE wallets SET owed_balance = 1, owed_pinned = 1 WHERE type = 'credit';

-- The running scores behind that verdict. SEPARATE FROM `wallets` on purpose:
-- `wallets.owed_balance` is what every screen reads, this table is only WHY, and
-- keeping the two apart means a rewrite of the scoring rules never touches the
-- row the whole app joins against.
CREATE TABLE wallet_trait_evidence (
  wallet_id    TEXT PRIMARY KEY NOT NULL REFERENCES wallets(id),
  owed_score   INTEGER NOT NULL DEFAULT 0,
  held_score   INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- The Review Queue learns to ask the one question inference cannot settle:
-- "is this money you have, or money you owe?" Raised only when the evidence is
-- genuinely inconclusive AND the balance is large enough that guessing wrong
-- would visibly misstate the user's total.
--
-- WHY A REBUILD AND NOT AN `ALTER TABLE`. `kind` carries an inline
-- `CHECK (kind IN (...))` from 001_core.sql and SQLite has no
-- `ALTER TABLE ... DROP/ADD CONSTRAINT`. Same twelve-step dance as
-- 011_loan_match_review_kind.sql and 012_one_sided_transfer_review_kind.sql,
-- and the same two things that must survive it:
--
--   THE INDEX. `DROP TABLE` takes `idx_review_queue_open` with it silently, and
--   `countOpen` runs every 30 seconds behind the tab badge. Recreated below.
--
--   THE FOREIGN KEY. `raw_notification_id REFERENCES raw_notifications(id)` is
--   restated verbatim so the Privacy Centre's raw-capture lifecycle keeps the
--   guarantee it had before this file ran.
--
-- This rebuild needs no `disablesForeignKeys`: nothing references
-- `review_queue_items`. The `wallets` rebuild in 014 does, and says so.
CREATE TABLE review_queue_items_new (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('low-confidence', 'unknown-provider', 'ambiguous-transfer', 'possible-duplicate', 'loan-match', 'one-sided-transfer', 'wallet-kind-unclear')),
  payload_json TEXT NOT NULL,
  raw_notification_id TEXT REFERENCES raw_notifications(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  resolved_at INTEGER
);

INSERT INTO review_queue_items_new (
  id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
)
SELECT id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
  FROM review_queue_items;

DROP TABLE review_queue_items;

ALTER TABLE review_queue_items_new RENAME TO review_queue_items;

CREATE INDEX idx_review_queue_open ON review_queue_items(resolved_at);
