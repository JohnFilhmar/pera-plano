// lib/db/mappers.ts — row (snake_case) <-> domain (camelCase). The foundation
// covers the aggregates its repos use; feature plans extend THIS file for theirs.
import type {
  Category,
  Limit,
  LimitBasis,
  LimitScope,
  LimitThreshold,
  ReviewItemPayload,
  ReviewKind,
  ReviewQueueItem,
  Transaction,
  TxDirection,
  TxSource,
  Wallet,
} from "@/types/domain";

export type WalletRow = {
  id: string;
  name: string;
  balance: number;
  currency: string;
  is_archived: number;
  /** 003_drift_dismissal — appended by ALTER TABLE, hence after `is_archived`. */
  drift_dismissed_transaction_id: string | null;
  /** 013_wallet_traits — appended by ALTER TABLE, hence after 003's column. */
  owed_balance: number;
  owed_pinned: number;
  created_at: number;
  updated_at: number;
  /**
   * NOT A COLUMN. A `LEFT JOIN` count the wallets repo selects alongside the
   * row, so a list screen can tell which wallets nothing routes to without a
   * query per row. Optional because `walletToRow` produces a row shape for
   * writing, where a derived count has no place.
   */
  matcher_count?: number;
};

export function rowToWallet(row: WalletRow): Wallet {
  return {
    id: row.id,
    name: row.name,
    balance: row.balance,
    currency: "PHP",
    isArchived: row.is_archived === 1,
    // `?? null`, never a boolean cast: the badge compares this id against the
    // current reporting transaction's, so collapsing it to "something was
    // dismissed" would silence every later drift too. It also normalizes the
    // `undefined` a row selected before 003 existed would carry.
    driftDismissedTransactionId: row.drift_dismissed_transaction_id ?? null,
    owedBalance: row.owed_balance === 1,
    owedPinned: row.owed_pinned === 1,
    // `?? 0` covers a row selected without the join — writing paths, and any
    // `SELECT *` that predates 013. Zero reads as "nothing routes here", which
    // is the truthful answer for a row whose matchers were not asked about.
    matcherCount: row.matcher_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function walletToRow(wallet: Wallet): WalletRow {
  return {
    id: wallet.id,
    name: wallet.name,
    balance: wallet.balance,
    currency: wallet.currency,
    is_archived: wallet.isArchived ? 1 : 0,
    drift_dismissed_transaction_id: wallet.driftDismissedTransactionId,
    owed_balance: wallet.owedBalance ? 1 : 0,
    owed_pinned: wallet.owedPinned ? 1 : 0,
    created_at: wallet.createdAt,
    updated_at: wallet.updatedAt,
    // `matcher_count` is DELIBERATELY ABSENT. It is a derived count, not a
    // column, and this function's keys are asserted against the real table.
  };
}

export type TransactionRow = {
  id: string;
  wallet_id: string;
  category_id: string;
  amount: number;
  direction: string;
  occurred_at: number;
  merchant: string | null;
  counterparty: string | null;
  reference_no: string | null;
  source: string;
  confidence: number;
  raw_notification_id: string | null;
  transfer_link_id: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  /** 002_balance_after — appended by ALTER TABLE, hence last, not next to `amount`. */
  balance_after: number | null;
  computed_balance: number | null;
};

export function rowToTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    walletId: row.wallet_id,
    categoryId: row.category_id,
    amount: row.amount,
    direction: row.direction as TxDirection,
    occurredAt: row.occurred_at,
    merchant: row.merchant,
    counterparty: row.counterparty,
    referenceNo: row.reference_no,
    source: row.source as TxSource,
    confidence: row.confidence,
    rawNotificationId: row.raw_notification_id,
    transferLinkId: row.transfer_link_id,
    note: row.note,
    // `?? null`, never `|| null`: a reported balance of exactly 0 is a drained
    // wallet the provider told us about, not a missing report. It also
    // normalizes the `undefined` a row selected before 002 existed would carry.
    balanceAfter: row.balance_after ?? null,
    computedBalance: row.computed_balance ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transactionToRow(tx: Transaction): TransactionRow {
  return {
    id: tx.id,
    wallet_id: tx.walletId,
    category_id: tx.categoryId,
    amount: tx.amount,
    direction: tx.direction,
    occurred_at: tx.occurredAt,
    merchant: tx.merchant,
    counterparty: tx.counterparty,
    reference_no: tx.referenceNo,
    source: tx.source,
    confidence: tx.confidence,
    raw_notification_id: tx.rawNotificationId,
    transfer_link_id: tx.transferLinkId,
    note: tx.note,
    balance_after: tx.balanceAfter,
    computed_balance: tx.computedBalance,
    created_at: tx.createdAt,
    updated_at: tx.updatedAt,
  };
}

export type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string;
  is_system: number;
  is_hidden: number;
  created_at: number;
  updated_at: number;
};

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    icon: row.icon,
    isSystem: row.is_system === 1,
    isHidden: row.is_hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function categoryToRow(category: Category): CategoryRow {
  return {
    id: category.id,
    name: category.name,
    parent_id: category.parentId,
    icon: category.icon,
    is_system: category.isSystem ? 1 : 0,
    is_hidden: category.isHidden ? 1 : 0,
    created_at: category.createdAt,
    updated_at: category.updatedAt,
  };
}

export type ReviewQueueItemRow = {
  id: string;
  kind: string;
  payload_json: string;
  raw_notification_id: string | null;
  created_at: number;
  expires_at: number | null;
  resolved_at: number | null;
};

export function rowToReviewQueueItem(row: ReviewQueueItemRow): ReviewQueueItem {
  return {
    id: row.id,
    kind: row.kind as ReviewKind,
    payload: JSON.parse(row.payload_json) as ReviewItemPayload,
    rawNotificationId: row.raw_notification_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export function reviewQueueItemToRow(item: ReviewQueueItem): ReviewQueueItemRow {
  return {
    id: item.id,
    kind: item.kind,
    payload_json: JSON.stringify(item.payload),
    raw_notification_id: item.rawNotificationId,
    created_at: item.createdAt,
    expires_at: item.expiresAt,
    resolved_at: item.resolvedAt,
  };
}

export type LimitRow = {
  id: string;
  scope: string;
  basis: string;
  value: number;
  category_filter_json: string | null;
  wallet_filter_json: string | null;
  rollover: number;
  is_active: number;
  thresholds_fired_json: string;
  created_at: number;
  updated_at: number;
  /** 004_limit_alert_state — appended by ALTER TABLE, hence last. */
  limit_alert_state_json: string | null;
  /** 010_soft_delete_and_derived_limits — appended by ALTER TABLE, hence after
   * `limit_alert_state_json`, not next to the other timestamps. */
  archived_at: number | null;
  /** 010_soft_delete_and_derived_limits — see the note above. */
  derived_from: string | null;
};

/**
 * Note what is NOT here: `limit_alert_state_json`. A `Limit` is the user's
 * configuration; the engine's working memory is not part of it, and putting it
 * on the domain object would put five fields on every screen that renders a
 * limit for the benefit of one engine. `limits_repo`'s `getLimitAlertState`
 * reads that column directly.
 */
export function rowToLimit(row: LimitRow): Limit {
  return {
    id: row.id,
    scope: row.scope as LimitScope,
    basis: row.basis as LimitBasis,
    value: row.value,
    // A stored "[]" and a NULL both mean "no filter", but only NULL is ever
    // written (see limits_repo's `encodeFilter`). Parsing is guarded anyway
    // because a hand-edited or pre-repo row is not worth crashing a screen for.
    categoryFilter: parseFilter(row.category_filter_json),
    walletFilter: parseFilter(row.wallet_filter_json),
    rollover: row.rollover === 1,
    isActive: row.is_active === 1,
    // NOT NULL DEFAULT '[]' in 001_core.sql, so the `??` is for rows selected
    // by an older code path rather than for the schema.
    thresholdsFired: JSON.parse(row.thresholds_fired_json ?? "[]") as LimitThreshold[],
    // Both added by ALTER TABLE in migration 010, so every row written before
    // it reads NULL — which is the right answer for both: not archived, and
    // not derived from anything.
    archivedAt: row.archived_at ?? null,
    derivedFrom: row.derived_from ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `null` and an empty array both collapse to `null` — see `rowToLimit`. */
function parseFilter(json: string | null): string[] | null {
  if (json === null) return null;
  const parsed = JSON.parse(json) as string[];
  return parsed.length > 0 ? parsed : null;
}
