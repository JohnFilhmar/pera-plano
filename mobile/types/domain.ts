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

export type DueRule =
  | { kind: "day-of-month"; day: number } // months lacking the day use the last day
  | { kind: "semi-monthly" } // 15th and 30th (kinsenas/katapusan)
  | { kind: "every-n-weeks"; n: number; weekday: number } // weekday 0 = Sunday
  | { kind: "last-day-of-month" };

export type BillAutoMatchRule = {
  merchantPattern: string;
  amountTolerancePct?: number;
  amountToleranceCentavos?: Centavos;
  dateWindowDays: number;
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
  confidence: number;
  acknowledged: boolean;
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
