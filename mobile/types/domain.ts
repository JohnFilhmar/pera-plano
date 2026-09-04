// types/domain.ts — camelCase mirrors of the snake_case schema in 001_core.sql.
// Owned by the foundation plan (interface contract §3). Feature plans import from here.

/** Integer centavos — ₱1,234.56 is 123456. Never store or compute pesos as floats. */
export type Centavos = number;

/** Epoch milliseconds. */
export type EpochMs = number;

/** Calendar date as 'YYYY-MM-DD'. */
export type IsoDate = string;

// ---------- Wallet ----------
export type Wallet = {
  id: string;
  name: string;
  balance: Centavos;
  currency: "PHP";
  isArchived: boolean;
  /**
   * The balance is money OWED, not money held: excluded from the Wallets-tab
   * total and from Safe-to-Spend, and labelled "Owed" on its row.
   *
   * INFERRED (lib/wallets/classification.ts), not asked for — unless
   * `owedPinned` says the user answered it themselves.
   */
  owedBalance: boolean;
  /**
   * The user settled `owedBalance` — by answering the review-queue question or
   * correcting it on the wallet screen. Inference reads a pinned wallet and
   * never writes it again.
   */
  owedPinned: boolean;
  /**
   * How many `wallet_matchers` rows route to this wallet.
   *
   * ZERO IS THE INTERESTING VALUE: nothing can track this wallet
   * automatically, which is precisely what `type: "cash"` used to mean. Derived
   * from a count rather than stored as a flag, so removing a wallet's last
   * matcher makes it manual the moment it happens.
   */
  matcherCount: number;
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
  /**
   * `true` when this row exists to RECONCILE the wallet's balance rather than
   * to record money leaving or entering the user's control — a starting
   * balance, a manual correction, a cash count (017_transaction_adjustments).
   *
   * It is excluded from spend, income and every report figure, for the same
   * reason a transfer leg is (invariant I2): the money did not go anywhere. A
   * user who tells the app "this wallet actually holds ₱4,377" has not spent
   * the difference, and counting it blows their limits and their
   * Safe-to-Spend on a correction they made to get the numbers RIGHT.
   *
   * It still MOVES THE BALANCE — that is what the row is for. Excluded from
   * the reports, included in the wallet total, present in the ledger where
   * the user can see it.
   *
   * NOT USER-EDITABLE. Absent from `TransactionPatch` alongside
   * `transferLinkId`, and for the same reason: what counts as spending is a
   * fact about how the row was created, not a field a category picker should
   * be able to flip.
   */
  isAdjustment: boolean;
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
  /**
   * Set by the two reconciliation hooks and by nothing else. Absent and
   * `false` mean the same thing: an ordinary transaction.
   */
  isAdjustment?: boolean;
};

/** Contract §3 pinned filter for listTransactions. */
export type TxFilter = {
  walletId?: string;
  categoryId?: string;
  from?: EpochMs;
  to?: EpochMs;
  direction?: TxDirection;
  excludeTransferLinked?: boolean;
  /**
   * Drops balance-reconciliation rows. For callers reasoning about the user's
   * real activity — what they earn, what recurs — not for callers rendering
   * the ledger, where an adjustment is history the user should see.
   */
  excludeAdjustments?: boolean;
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
  /**
   * When the user retired this limit, or `null` while it is live (migration
   * 010). A limit is never hard-deleted: it is the thing breach history is
   * attributed to, and 004_limit_alert_state.sql records that `app_settings`
   * has no foreign key back here — so a real DELETE orphans that state rather
   * than cleaning it up.
   *
   * DISTINCT FROM `isActive`. Inactive means "not being enforced right now"
   * (the free tier's gated card, kept and dimmed). Archived means "the user is
   * done with this one" and it leaves the list entirely.
   */
  archivedAt: EpochMs | null;
  /**
   * The limit this one was worked out FROM, or `null` if the user created it
   * themselves (migration 010).
   *
   * Onboarding asks for one limit and creates the equivalent at every other
   * cadence, so Plan -> Limits is populated rather than showing the single row
   * that was typed. This field exists for the entitlement gate:
   * `lib/entitlements.ts` caps Free at one active limit, and limits the app
   * invented for you must not consume that allowance.
   *
   * IT DOES NOT MAKE THE ROW DEPENDENT. Derived limits are ordinary limits from
   * the moment they are written — editing one leaves the others alone.
   */
  derivedFrom: string | null;
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
  /**
   * When the user deleted this goal, or `null` while it is live (migration
   * 016) — the same column and the same meaning `Bill.archivedAt`,
   * `Loan.archivedAt` and `Limit.archivedAt` already have.
   *
   * THE UI CALLS THIS DELETING, and the schema calls it archiving, on purpose.
   * Every Plan entity is soft-deleted and restorable; "archive" is the word for
   * the mechanism and "delete" is the word a user reaches for, so the buttons
   * say Delete and the column keeps the name its three siblings already use.
   */
  archivedAt: EpochMs | null;
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
  /**
   * Day offsets relative to `nextDueDate`; negative = before, positive =
   * after (e.g. the spec default `[-3, 0, 3]`). An EMPTY array means
   * reminders are off for this loan (migration 008; loans rule 15 — "many 5-6
   * borrowers do not want a due-date reminder for a collector who simply
   * shows up"), the same convention `Bill.reminderOffsets` already uses.
   */
  reminderOffsets: number[];
  /**
   * When the user retired this loan, or `null` while it is live (migration
   * 010) — the same column and the same meaning `Bill.archivedAt` already has.
   *
   * NEVER A HARD DELETE. A loan is what recorded payments point at; removing
   * the row would strand its payment history in the ledger with nothing to
   * attribute it to.
   */
  archivedAt: EpochMs | null;
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
  /**
   * "Money matching this rule is a transfer to/from THIS wallet."
   *
   * The wallet is on the ACTION because `UserRuleMatcher` can only describe one
   * leg — a provider, a merchant pattern, a direction. The pair is expressed as
   * matcher-identifies-one-side, action-names-the-other. Without it the action
   * could never fire, which is exactly the state it shipped in.
   */
  | { kind: "mark-transfer"; counterpartWalletId: string }
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
/**
 * Every card the Review Queue can show. Each member is also a value the
 * `review_queue_items.kind` CHECK constraint accepts — 001_core.sql for the
 * first four, 011_loan_match_review_kind.sql for `loan-match` — so adding a
 * member here without a migration produces an item that cannot be INSERTed.
 *
 * `loan-match` IS THE ODD ONE OUT AND THAT IS THE POINT. The other four all
 * mean "this row is NOT in your ledger and will not be until you say so". A
 * `loan-match` item is raised AFTER a transaction is committed and correct
 * (docs/04-features/06-loans.md §"Flow: automatic payment matching from the
 * ledger" step 1: "After a Transaction commits to the ledger, the matcher
 * scores it against open loans"); the only open question is whether that
 * already-committed row also pays down a loan. Anything that treats the kinds
 * uniformly — a triage action that commits a payload, say — has to exclude
 * this one, or it writes the same money twice.
 */
export type ReviewKind =
  | "low-confidence"
  | "unknown-provider"
  | "ambiguous-transfer"
  | "possible-duplicate"
  | "loan-match"
  /**
   * One leg of an internal transfer arrived and the other never will, because
   * the account it came from or went to does not post notifications. The
   * counterpart transaction does not exist yet — confirming this item MINTS it.
   * Distinct from `ambiguous-transfer`, whose payload names a committed row.
   */
  | "one-sided-transfer"
  /**
   * Evidence cannot settle whether this wallet's balance is money the user HAS
   * or money they OWE, and the balance is large enough that guessing wrong
   * would visibly misstate their total. Payload:
   * `{ walletId, walletName, balance }`.
   *
   * THE ONLY KIND THAT IS NOT ABOUT A TRANSACTION. There is no capture behind
   * it and no row to commit — the pipeline raises it after watching a wallet
   * and failing to decide. Asked at most once per wallet, ever: dismissing it
   * is itself an answer.
   */
  | "wallet-kind-unclear";

/**
 * Parsed-candidate payload (amount, direction, merchant, wallet/category guesses…).
 * Stored opaquely by the foundation; the ingest plan (m1) owns and narrows the shape.
 *
 * STILL OPAQUE — the index signature is the type, and every reader keeps its own
 * defensive `readString`/`readAmount` because a card enqueued by an older build
 * carries whatever THAT build wrote. The five keys named below are the ones the
 * DedupeGate needs back out again, and they are declared only so a writer cannot
 * misspell `channel` or put a `"SMS"` where the gate compares `"sms"`.
 *
 * WHY THE GATE NEEDS THEM AT ALL. A capture that hard-routes sits in the queue
 * carrying no reference number, no channel and no provider, so its SMS twin
 * thirty seconds later has nothing to match against and raises a second card for
 * one movement — and the row a later confirm commits carries no reference
 * either, so §6 rule 1's strong key can never fire for it afterwards.
 */
export type ReviewItemPayload = Record<string, unknown> & {
  /** §6 rule 1's strong key. Absent means the notification carried none. */
  referenceNo?: string | null;
  /** The provider's own balance statement, when it made one. */
  balanceAfter?: Centavos | null;
  /** The normalized event's own timestamp — never when the card was raised. */
  occurredAt?: EpochMs;
  /** §6 rule 2 is only reachable when both channels are known and differ. */
  channel?: "push" | "sms";
  /** The ruleset's key, not the package name — what `describesSameMovement` compares. */
  providerKey?: string;
};

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
  /**
   * `StatusBarNotification.getKey()` — Android's own identity for the
   * notification SLOT this arrived in (`package|id|tag|user`), stable across
   * every edit the posting app makes to it.
   *
   * NOT `id`, WHICH IS THE OPPOSITE FACT. `id` is minted per DELIVERY, so an
   * app that edits its notification produces several ids for one key; that is
   * exactly the difference `findReplayCapture` needs to tell a redelivery
   * apart from a second, genuine transaction (see migration 018).
   *
   * OPTIONAL because two real populations carry none: rows stored before
   * migration 018, and records still sitting in the native capture buffer
   * written by a build that predates it. Absent means "cannot tell", which
   * suppresses nothing.
   */
  notificationKey?: string | null;
};
