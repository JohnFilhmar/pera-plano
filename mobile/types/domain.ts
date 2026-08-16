// types/domain.ts — camelCase mirrors of the snake_case schema in 001_core.sql.
// Owned by the foundation plan (interface contract §3). Feature plans import from here.

/** Integer centavos — ₱1,234.56 is 123456. Never store or compute pesos as floats. */
export type Centavos = number;

/** Epoch milliseconds. */
export type EpochMs = number;

/** Calendar date as 'YYYY-MM-DD'. */
export type IsoDate = string;

// ---------- Wallet ----------
export type WalletType = "bank" | "e-wallet" | "cash" | "credit" | "savings";

export type Wallet = {
  id: string;
  name: string;
  type: WalletType;
  balance: Centavos;
  currency: "PHP";
  isArchived: boolean;
  /**
   * The reporting Transaction whose balance drift the user has already seen and
   * accepted (migration 003), or `null` when nothing is acknowledged.
   *
   * AN ID, NOT A FLAG, and the difference is the whole feature: the drift on
   * screen is always the newest transaction carrying a `balanceAfter`, so
   * storing that row's id says which disagreement was dismissed. A newer report
   * is a different row, so its drift shows again on its own. A boolean would
   * silence that one too — see lib/db/migrations/003_drift_dismissal.sql.
   *
   * Not patchable through `updateWallet`; `dismissBalanceDrift` owns it.
   */
  driftDismissedTransactionId: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

export type NewWallet = {
  name: string;
  type: WalletType;
  /** Opening balance anchor (docs/02-domain-model.md §3.1); defaults to 0. */
  openingBalance?: Centavos;
};

/** One notification-source route into a Wallet (wallet_matchers table). */
export type WalletMatcher = {
  id: string;
  walletId: string;
  packageName: string;
  hint: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

/**
 * A matcher as the matcher picker offers it, before it belongs to a Wallet
 * (m1c Task 5). `walletId` is the argument to `setMatchers`, not a field here —
 * the whole point of that call is to decide which Wallet the pair lands on.
 *
 * `hint` is the CONTENT DISCRIMINATOR that lets one provider feed two Wallets
 * (docs/04-features/02-wallets.md §matcher management — GCash main vs GSave).
 * Absent, `null`, and blank all mean the same thing and are stored as `null`:
 * `normalizeEvent`'s `foldHint` reads a blank hint as "this row claims the whole
 * provider", so a form writing `""` where it meant nothing must not produce a
 * row the pipeline and the conflict check disagree about.
 */
export type NewWalletMatcher = {
  packageName: string;
  hint?: string | null;
};

// ---------- Transaction ----------
export type TxDirection = "in" | "out";
export type TxSource = "notification" | "manual" | "recurring-rule" | "import";

export type Transaction = {
  id: string;
  walletId: string;
  categoryId: string;
  amount: Centavos;
  direction: TxDirection;
  occurredAt: EpochMs;
  merchant: string | null;
  counterparty: string | null;
  referenceNo: string | null;
  source: TxSource;
  /** Parse confidence 0..1 at commit time; manual entries are 1.0. */
  confidence: number;
  rawNotificationId: string | null;
  transferLinkId: string | null;
  note: string | null;
  /**
   * The balance the PROVIDER reported after this transaction, or `null` when it
   * reported none (most notifications, every manual entry, all cash).
   *
   * Committing a Transaction that carries one snaps its Wallet's `balance` to it
   * — reported wins, because it is the provider's own statement of truth
   * (docs/04-features/02-wallets.md §balance handling rule 1). Nullable, and
   * `null` is NOT `0`: a reported ₱0.00 is a drained wallet, a real fact.
   */
  balanceAfter: Centavos | null;
  /**
   * What the balance would have been WITHOUT the snap — the wallet's balance
   * immediately before this row, plus its signed effect (spec rule 2's computed
   * expectation). Written by `insertTransaction` only on rows that carry a
   * `balanceAfter`, `null` on every other row.
   *
   * It exists because the snap destroys it: a heartbeat after the wallet is set
   * to the reported figure, the number it disagreed with is gone, and rule 3's
   * drift explainer has to show both. Frozen at commit time — see
   * `updateTransaction`'s note on anchors.
   */
  computedBalance: Centavos | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

export type NewTransaction = {
  walletId: string;
  categoryId: string;
  amount: Centavos;
  direction: TxDirection;
  occurredAt: EpochMs;
  merchant?: string | null;
  counterparty?: string | null;
  referenceNo?: string | null;
  source: TxSource;
  confidence: number;
  rawNotificationId?: string | null;
  transferLinkId?: string | null;
  note?: string | null;
  /**
   * The provider's reported balance-after, when the notification carried one.
   * Absent and `null` mean the same thing: no report, so the ordinary computed
   * path applies. Present means the Wallet's balance is SET to this value.
   *
   * `computedBalance` is deliberately NOT accepted here — the repository derives
   * it from the wallet's own state at commit time, and a caller-supplied value
   * would let the drift explainer be handed a number nothing verified.
   */
  balanceAfter?: Centavos | null;
};

/** Contract §3 pinned filter for listTransactions. */
export type TxFilter = {
  walletId?: string;
  categoryId?: string;
  from?: EpochMs;
  to?: EpochMs;
  direction?: TxDirection;
  excludeTransferLinked?: boolean;
};

// ---------- TransferLink ----------
export type TransferLinkStatus = "active" | "dissolved";

export type TransferLink = {
  id: string;
  outTransactionId: string;
  inTransactionId: string;
  /** outLeg.amount − inLeg.amount; negative = credited bonus (domain §3.3). */
  feeAmount: Centavos;
  status: TransferLinkStatus;
  detectedBy: "auto" | "manual";
  confidence: number;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- Category ----------
export type Category = {
  id: string;
  name: string;
  parentId: string | null;
  /** Lucide icon name (the app's brand icon family). */
  icon: string;
  isSystem: boolean;
  isHidden: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

export type NewCategory = {
  name: string;
  icon: string;
  /** Absent/undefined and `null` both mean top-level (docs/02-domain-model.md §3.4). */
  parentId?: string | null;
};

// ---------- Limit ----------
export type LimitScope = "daily" | "weekly" | "monthly" | "annual";
export type LimitBasis = "fixed" | "percent-of-income";
export type LimitThreshold = 50 | 80 | 100;

export type Limit = {
  id: string;
  scope: LimitScope;
  basis: LimitBasis;
  /**
   * basis 'fixed': centavos. basis 'percent-of-income': percent × 100 as an
   * integer (12.5% -> 1250). Kept integer so nothing money-adjacent is a float.
   */
  value: number;
  categoryFilter: string[] | null;
  walletFilter: string[] | null;
  rollover: boolean;
  isActive: boolean;
  thresholdsFired: LimitThreshold[];
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- IncomeProfile ----------
export type IncomeCadence = "kinsenas" | "weekly" | "monthly" | "irregular";

export type IncomeProfile = {
  id: string;
  cadence: IncomeCadence;
  averageAmount: Centavos | null;
  /** Normalized into the income_profile_sources table. */
  sourceWalletIds: string[];
  isManualOverride: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- Goal ----------
export type ContributionRule =
  | { kind: "fixed"; amount: Centavos }
  | { kind: "percent"; percent: number };

export type Goal = {
  id: string;
  name: string;
  targetAmount: Centavos;
  targetDate: IsoDate | null;
  /** Must reference a Wallet of type 'savings' (invariant I10). */
  linkedWalletId: string;
  contributionRule: ContributionRule | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- Loan ----------
export type LoanDirection = "i-owe" | "owed-to-me";

export type Installment = {
  dueDate: IsoDate;
  amountDue: Centavos;
  principalPortion?: Centavos;
  interestPortion?: Centavos;
};

export type Loan = {
  id: string;
  direction: LoanDirection;
  counterparty: string;
  principal: Centavos;
  /** Percent 0..100, informational only (domain §3.8). */
  interestRate: number | null;
  schedule: Installment[] | null;
  linkedWalletId: string | null;
  nextDueDate: IsoDate | null;
  nextDueAmount: Centavos | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

/** One matched payment (loan_payments table; a Transaction appears in at most one — I12). */
export type LoanPayment = {
  id: string;
  loanId: string;
  transactionId: string;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- Bill ----------
export type BillAmountMode = "fixed" | "estimated";

/**
 * A Saturday/Sunday due date moves to the preceding Friday (`earlier`) or the
 * following Monday (`later`). Per bill, applies to month-based rules only
 * (bills spec, "Weekday adjustment"). Reminders and the auto-match window are
 * computed from the ADJUSTED date; rule 3 keeps the unadjusted one visible in
 * the bill detail, recomputed from the rule rather than stored.
 */
export type WeekdayAdjust = "none" | "earlier" | "later";

export type DueRule = {
  weekdayAdjust?: WeekdayAdjust; // defaults to "none"
} & (
  | { kind: "day-of-month"; day: number } // months lacking the day use the last day
  | { kind: "semi-monthly" } // the 15th and katapusan — the last day, not the 30th
  /**
   * `weekday` 0 = Sunday. `anchorDate` fixes WHICH week: "every 2 weeks on
   * Friday" names two different schedules depending on the Friday it starts
   * from, and the pinned variant had nowhere to say. Required rather than
   * optional so the create form cannot forget to ask.
   */
  | { kind: "every-n-weeks"; n: number; weekday: number; anchorDate: IsoDate }
  | { kind: "last-day-of-month" }
  /**
   * Quarterly (n=3), semi-annual (n=6), annual (n=12) — insurance premiums and
   * tuition. `anchorMonth` is 1-12 and fixes WHICH quarter: every 3 months on
   * the 10th is a different bill starting in January than starting in February.
   */
  | { kind: "every-n-months"; n: number; day: number; anchorMonth: number }
);

export type BillAutoMatchRule = {
  merchantPattern: string;
  amountTolerancePct?: number;
  amountToleranceCentavos?: Centavos;
  dateWindowDays: number;
  /**
   * How many matches in a row the user has confirmed without rejecting one.
   *
   * Bills rule 13's confirmation ladder: matches 1 and 2 ask, from 3 onward
   * matching is silent with undo, and ANY rejection resets to zero. Stored here
   * rather than anywhere else because rule 20 says exactly that — "confirming
   * or rejecting a match edits only the bill's own autoMatchRule".
   */
  confirmedStreak?: number;
  /**
   * Keywords the user rejected. The auto-match flow's "No" branch: "rejects;
   * the offending keyword is excluded from the rule". A transaction whose
   * merchant contains one of these is never offered for this bill again.
   */
  excludedKeywords?: string[];
};

export type Bill = {
  id: string;
  name: string;
  amount: Centavos;
  amountMode: BillAmountMode;
  dueRule: DueRule;
  /** Day offsets relative to the due date; negative = before (e.g., [-3, 0]). */
  reminderOffsets: number[];
  autoMatchRule: BillAutoMatchRule | null;
  categoryId: string;
  /**
   * Set when the bill stops producing cycles (rule 27). A timestamp, not a
   * flag: occurrence generation needs to know WHEN to stop, or an archived
   * bill keeps conjuring due dates after the date it was archived.
   */
  archivedAt: EpochMs | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

/**
 * `"open"` is an unresolved cycle that needed a row anyway — only rule 22's
 * overdue-notice count creates one. Every other unresolved cycle has NO ROW.
 */
export type BillCycleState = "open" | "paid" | "skipped" | "resolved_external";

/**
 * One occurrence of a Bill that the user has resolved (bill_cycles, migration
 * 006). Distinct from `BillPayment`: a cycle can be skipped (rule 21) or paid
 * outside every tracked wallet, neither of which has a ledger transaction.
 */
export type BillCycle = {
  id: string;
  billId: string;
  /** The ADJUSTED due date — every downstream date is computed from it. */
  dueDate: IsoDate;
  state: BillCycleState;
  /** Non-null exactly when `state` is `"paid"`. */
  billPaymentId: string | null;
  /** Rule 22 caps overdue notifications at three per cycle. */
  overdueNoticesSent: number;
  resolvedAt: EpochMs | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

/** One matched Bill cycle (bill_payments table; a Transaction matches at most one cycle — I12). */
export type BillPayment = {
  id: string;
  billId: string;
  transactionId: string;
  cycleDueDate: IsoDate;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- RecurringPattern ----------
export type RecurringPeriod = "weekly" | "monthly" | "annual";

export type RecurringPattern = {
  id: string;
  merchant: string;
  amount: Centavos;
  period: RecurringPeriod;
  /**
   * The exact cadence in days (migration 007) — `period`'s three-bucket enum
   * cannot express a 14-day fortnightly charge and carries no date at all.
   * `null` only on a row written before migration 007 shipped; every new
   * write fills it in. `promotePatternToBill` (lib/recurring/recurring_service.ts)
   * needs this to derive a Bill's DueRule.
   */
  periodDays: number | null;
  confidence: number;
  acknowledged: boolean;
  /**
   * The Bill this pattern was promoted into, or that was created manually over
   * the same merchant (bills rules 28-29). `acknowledged` alone cannot say
   * WHICH bill already counts this money, and a linked pattern is excluded from
   * "locked in" totals so one obligation is not double-counted in two surfaces.
   */
  billId: string | null;
  /** When this cadence's earliest occurrence in the current evidence was posted. */
  firstSeenAt: EpochMs | null;
  /** ...and the most recent — `nextExpectedAt` below is projected from this. */
  lastSeenAt: EpochMs | null;
  /**
   * Recurring plan rule 3: a dismissed pattern stays dismissed and is not
   * re-proposed unless its amount or cadence changes materially. `null` until
   * dismissed; `refreshPatterns` clears it when a re-detected candidate has
   * drifted enough to be a different question.
   */
  dismissedAt: EpochMs | null;
  /**
   * `lastSeenAt + periodDays` — DERIVED, never a stored column, so it can
   * never drift out of sync with the two fields it is computed from. `null`
   * whenever either input is `null`.
   */
  nextExpectedAt: EpochMs | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- UserRule ----------
export type UserRuleMatcher = {
  providerKey?: string;
  merchantPattern?: string;
  direction?: TxDirection;
  amountMin?: Centavos;
  amountMax?: Centavos;
};

export type UserRuleAction =
  | { kind: "set-category"; categoryId: string }
  | { kind: "set-wallet"; walletId: string }
  | { kind: "set-merchant"; merchant: string }
  | { kind: "mark-transfer" }
  | { kind: "suppress-recurring"; merchant: string }
  | { kind: "ignore" };

export type UserRule = {
  id: string;
  matcher: UserRuleMatcher;
  action: UserRuleAction;
  priority: number;
  isEnabled: boolean;
  /** The originating correction (Review Queue item or Transaction id) — invariant I15. */
  createdFrom: string | null;
  appliedCount: number;
  lastAppliedAt: EpochMs | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
};

// ---------- Review Queue ----------
export type ReviewKind =
  | "low-confidence"
  | "unknown-provider"
  | "ambiguous-transfer"
  | "possible-duplicate";

/**
 * Parsed-candidate payload (amount, direction, merchant, wallet/category guesses…).
 * Stored opaquely by the foundation; the ingest plan (m1) owns and narrows the shape.
 */
export type ReviewItemPayload = Record<string, unknown>;

export type ReviewQueueItem = {
  id: string;
  kind: ReviewKind;
  payload: ReviewItemPayload;
  rawNotificationId: string | null;
  createdAt: EpochMs;
  expiresAt: EpochMs | null;
  resolvedAt: EpochMs | null;
};

export type NewReviewItem = {
  kind: ReviewKind;
  payload: ReviewItemPayload;
  rawNotificationId?: string | null;
  expiresAt?: EpochMs | null;
};

/**
 * How a review item was closed. On 'confirmed' the CALLER (m1) creates the
 * Transaction; the repo only marks the item resolved (queue items are never
 * Transactions themselves — invariant I13).
 */
export type ReviewResolution = "confirmed" | "dismissed";

// ---------- RawCapture (contract §4 shape; DB row adds expires_at) ----------
export type RawCapture = {
  id: string;
  packageName: string;
  title: string | null;
  text: string | null;
  subText: string | null;
  bigText: string | null;
  postedAt: EpochMs;
  capturedAt: EpochMs;
};
