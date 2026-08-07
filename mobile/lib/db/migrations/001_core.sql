-- 001_core.sql — PeraPlano core schema (interface contract §3; docs/02-domain-model.md).
-- Conventions: money INTEGER centavos · *_at INTEGER epoch ms · *_date TEXT 'YYYY-MM-DD'
--              booleans INTEGER 0/1 · fractions REAL 0..1 · *_json TEXT (JSON-encoded).
--
-- Every `id` column below carries an explicit NOT NULL in addition to PRIMARY KEY: SQLite's
-- PRIMARY KEY constraint does NOT imply NOT NULL for non-INTEGER primary keys (a documented
-- SQLite quirk), so without this, multiple rows with id = NULL could coexist despite the PK.
-- This does not rename or reshape any contract identifier — it only closes that loophole.

CREATE TABLE wallets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bank', 'e-wallet', 'cash', 'credit', 'savings')),
  balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PHP',
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE wallet_matchers (
  id TEXT PRIMARY KEY NOT NULL,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  package_name TEXT NOT NULL,
  hint TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_wallet_matchers_wallet ON wallet_matchers(wallet_id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  icon TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE raw_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  package_name TEXT NOT NULL,
  title TEXT,
  text TEXT,
  sub_text TEXT,
  big_text TEXT,
  posted_at INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  occurred_at INTEGER NOT NULL,
  merchant TEXT,
  counterparty TEXT,
  reference_no TEXT,
  source TEXT NOT NULL CHECK (source IN ('notification', 'manual', 'recurring-rule', 'import')),
  confidence REAL NOT NULL DEFAULT 1.0,
  raw_notification_id TEXT REFERENCES raw_notifications(id),
  transfer_link_id TEXT REFERENCES transfer_links(id),
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_occurred ON transactions(occurred_at);

CREATE TABLE transfer_links (
  id TEXT PRIMARY KEY NOT NULL,
  out_transaction_id TEXT NOT NULL REFERENCES transactions(id),
  in_transaction_id TEXT NOT NULL REFERENCES transactions(id),
  fee_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dissolved')),
  detected_by TEXT NOT NULL DEFAULT 'manual' CHECK (detected_by IN ('auto', 'manual')),
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE limits (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('daily', 'weekly', 'monthly', 'annual')),
  basis TEXT NOT NULL CHECK (basis IN ('fixed', 'percent-of-income')),
  value INTEGER NOT NULL CHECK (value > 0),
  category_filter_json TEXT,
  wallet_filter_json TEXT,
  rollover INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  thresholds_fired_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE income_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('kinsenas', 'weekly', 'monthly', 'irregular')),
  average_amount INTEGER,
  is_manual_override INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE income_profile_sources (
  id TEXT PRIMARY KEY NOT NULL,
  income_profile_id TEXT NOT NULL REFERENCES income_profiles(id),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (income_profile_id, wallet_id)
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  target_date TEXT,
  linked_wallet_id TEXT NOT NULL UNIQUE REFERENCES wallets(id),
  contribution_rule_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE loans (
  id TEXT PRIMARY KEY NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('i-owe', 'owed-to-me')),
  counterparty TEXT NOT NULL,
  principal INTEGER NOT NULL CHECK (principal > 0),
  interest_rate REAL,
  schedule_json TEXT,
  linked_wallet_id TEXT REFERENCES wallets(id),
  next_due_date TEXT,
  next_due_amount INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE loan_payments (
  id TEXT PRIMARY KEY NOT NULL,
  loan_id TEXT NOT NULL REFERENCES loans(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  amount_mode TEXT NOT NULL CHECK (amount_mode IN ('fixed', 'estimated')),
  due_rule_json TEXT NOT NULL,
  reminder_offsets_json TEXT NOT NULL DEFAULT '[]',
  auto_match_rule_json TEXT,
  category_id TEXT NOT NULL REFERENCES categories(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE bill_payments (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  cycle_due_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (bill_id, cycle_due_date)
);

CREATE TABLE recurring_patterns (
  id TEXT PRIMARY KEY NOT NULL,
  merchant TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'annual')),
  confidence REAL NOT NULL DEFAULT 0,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_rules (
  id TEXT PRIMARY KEY NOT NULL,
  matcher_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  priority INTEGER NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_from TEXT,
  applied_count INTEGER NOT NULL DEFAULT 0,
  last_applied_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE review_queue_items (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('low-confidence', 'unknown-provider', 'ambiguous-transfer', 'possible-duplicate')),
  payload_json TEXT NOT NULL,
  raw_notification_id TEXT REFERENCES raw_notifications(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  resolved_at INTEGER
);
CREATE INDEX idx_review_queue_open ON review_queue_items(resolved_at);

CREATE TABLE parser_rulesets (
  id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  installed_at INTEGER NOT NULL
);

CREATE TABLE app_settings (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
