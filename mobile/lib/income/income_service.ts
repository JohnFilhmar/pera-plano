// lib/income/income_service.ts — the income half of M2, assembled
// (m2-part2 Task 12; docs/04-features/04-income.md).
//
// `candidates.ts` decides what counts as income, `cadence_detector.ts` decides
// how often it arrives, `income_math.ts` decides how much — this file owns the
// order those run in, what gets persisted, and who is told.
//
// CLOCK-INJECTED THROUGHOUT. Every exported function takes `now`, which is what
// lets a test drive a profile from provisional to confirmed to lapsed in three
// calls. The real clock enters at the composition edge (a hook, or bootstrap).
//
// ---------------------------------------------------------------------------
// Three decisions worth knowing before changing anything here
// ---------------------------------------------------------------------------
// 1. MANUAL OVERRIDE ALWAYS WINS (rule 14). Detection keeps running and keeps
//    recording its own notes while an override is set — that is what rule 10
//    means by "recomputation happens silently for suggestion purposes only" —
//    but `getIncomeSummary` reports the user's figures, and the profile row is
//    never rewritten by detection.
//
// 2. THE PAYDAY EVENT IS `income:payday`, NOT A NEW KEY. The m2-part2 plan
//    specifies `PAYDAY_EVENT = "payday:detected"` with a `{ at, amount,
//    walletId, cadence }` payload. m2 Task 1 had already shipped `income:payday`
//    in lib/events/app_events.ts, and the interface contract pins it. Two keys
//    would leave the goals plan subscribing to one while this service publishes
//    the other — with nothing failing anywhere, in either build. The shipped
//    payload is also the better one: it carries `transactionId`, which is
//    exactly what rule 4's deduplication needs and the plan's shape lacks.
//    `cadence` is dropped because no subscriber uses it (goals allocate against
//    the actual credit amount, rule 12) and the bus's stated rule is that
//    payloads are identifiers, not copies of state.
//
// 3. NOTHING HERE EVER PRODUCES A ZERO INCOME. `null` travels end to end, so an
//    unknown income reaches `baseFor` as `null` and a percent-of-income Limit
//    reads as **Paused — income unknown** (limits rule 12). A zero would read
//    instead as "you have spent infinity percent of your limit".
import { listLimits } from "@/lib/db/repos/limits_repo";
import {
  getIncomeDetectionState,
  getIncomeProfile,
  listLoanPaymentTransactionIds,
  saveIncomeProfile,
  setIncomeDetectionState,
  clearIncomeProfile,
} from "@/lib/db/repos/income_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { emitAppEvent } from "@/lib/events/app_events";
import { refreshLimitBase } from "@/lib/limits/limit_service";
import { UNKNOWN_INCOME_DETECTION, type IncomeDetectionState } from "@/types/control";
import type { Centavos, IncomeCadence } from "@/types/domain";

import { CONFIRMED_CONFIDENCE, detectCadence, PROVISIONAL_CONFIDENCE } from "./cadence_detector";
import { primaryStream, selectCandidates, type CandidateEvent } from "./candidates";
import { averageAmountFor, monthlyEquivalent } from "./income_math";

/**
 * The bus key a payday is announced on. An alias for the event m2 Task 1
 * shipped — see decision 2 in this file's header.
 */
export const PAYDAY_EVENT = "income:payday" as const;

export type IncomeSummary = {
  cadence: IncomeCadence | null;
  averageAmount: Centavos | null;
  /** Monthly-equivalent M (rule 16) — what percent-of-income Limits consume. */
  monthlyEquivalent: Centavos | null;
  status: IncomeDetectionState["status"];
  isManualOverride: boolean;
  expectedNextAt: number | null;
  sourceWalletIds: string[];
  /**
   * Whether the Income screen should offer "is this your income?" right now
   * (income flow 2). NOT in the m2-part2 plan's `IncomeSummary`, and rule 3 is
   * unimplementable without it: something has to be observably different after
   * `dismissDetectedIncome`, or "a dismissed suggestion stays dismissed" has no
   * surface to be true on.
   */
  hasPendingSuggestion: boolean;
};

/** Detection reads a trailing 120 days; refunds look back 7 before a credit. */
const LEDGER_WINDOW_DAYS = 130;
const DAY_MS = 86_400_000;

/** Rule 13: "two consecutive expected windows pass with no matched pay event". */
const LAPSE_AFTER_MISSED_WINDOWS = 2;

/** Rule 11: a payday's amount must be within ±30% of `averageAmount`. */
const PAYDAY_AMOUNT_TOLERANCE = 0.3;

/** Rule 11's irregular clause: "any primary-stream candidate ≥ ₱1,000.00". */
const IRREGULAR_PAYDAY_FLOOR: Centavos = 100_000;

/**
 * How far back "the CURRENT expected window" reaches (rule 11).
 *
 * A window is the anchor ±3 days, so seven days wide. Without this bound,
 * `maybeEmitPayday` finds the OLDEST matched event in the stream — every past
 * payday satisfies "right wallet, right amount, matched a window" — and
 * announces a payday from three months ago the first time it runs.
 */
const CURRENT_WINDOW_MS = 7 * DAY_MS;

/** How many emitted payday ids to remember. See `emittedPaydayTransactionIds`. */
const EMITTED_HISTORY = 50;

/** Nominal length of one expected window, for the lapse count. */
const WINDOW_DAYS: Record<IncomeCadence, number> = {
  kinsenas: 15,
  weekly: 7,
  monthly: 30,
  // Irregular has no windows (rule 11), so it can never lapse. A large number
  // rather than a special case: `missedWindows` stays 0 for any real gap.
  irregular: Number.MAX_SAFE_INTEGER,
};

type Detection = {
  cadence: IncomeCadence;
  confidence: number;
  averageAmount: Centavos | null;
  expectedNextAt: number | null;
  matchedEventIds: string[];
  stream: CandidateEvent[];
};

/** Everything detection currently believes, computed fresh. Persists nothing. */
async function detect(now: number): Promise<Detection> {
  const from = now - LEDGER_WINDOW_DAYS * DAY_MS;
  // Both directions: rule 2's refund test needs the outflows to compare
  // against, so filtering to credits here would silently disable it.
  //
  // `to: now + 1`, NOT `to: now`. Date ranges are half-open `[from, to)`
  // everywhere in this codebase (interface contract §3), so a transaction
  // stamped at exactly `now` falls outside `to: now` — and the credit that just
  // landed is precisely the one `maybeEmitPayday` is being asked about. The
  // symptom is a payday that only announces itself a day late.
  const transactions = await listTransactions({ from, to: now + 1 });
  const loanPaymentIds = new Set(await listLoanPaymentTransactionIds());

  const stream = primaryStream(selectCandidates(transactions, loanPaymentIds));
  const evidence = detectCadence(stream, now);
  const matched = stream.filter((event) => evidence.matchedEventIds.includes(event.transactionId));

  return {
    cadence: evidence.cadence,
    confidence: evidence.confidence,
    averageAmount: averageAmountFor(matched, evidence.cadence, now),
    expectedNextAt: evidence.expectedNextAt,
    matchedEventIds: evidence.matchedEventIds,
    stream,
  };
}

/**
 * What the user would be asked to accept, as a stable string. A SIGNATURE
 * rather than a boolean, per rule 3: a genuinely different suggestion — a
 * raise, a new employer — was never dismissed and should still be allowed to
 * ask.
 */
function suggestionSignature(detection: Detection): string {
  return `${detection.cadence}:${detection.averageAmount ?? "none"}`;
}

/**
 * Consecutive expected windows since the last credit in the stream.
 *
 * Derived rather than stored: `IncomeDetectionState` has nowhere to keep the
 * previous `expectedNextAt`, and deriving it means a lapse cannot drift out of
 * step with the ledger it is supposed to describe.
 */
function missedWindowsFor(detection: Detection, previousCadence: IncomeCadence, now: number): number {
  const windowDays = WINDOW_DAYS[previousCadence];
  const last = detection.stream[detection.stream.length - 1];
  if (last === undefined) return LAPSE_AFTER_MISSED_WINDOWS;
  const elapsedDays = (now - last.occurredAt) / DAY_MS;
  return Math.floor(elapsedDays / windowDays);
}

function statusFor(
  previous: IncomeDetectionState,
  detection: Detection,
  missedWindows: number,
): IncomeDetectionState["status"] {
  if (detection.confidence === CONFIRMED_CONFIDENCE) return "confirmed";

  // Rule 13: a confirmed profile does not fall straight back to provisional the
  // first quiet fortnight. It lapses, and keeps its figures.
  const wasEstablished = previous.status === "confirmed" || previous.status === "lapsed";
  if (wasEstablished) {
    return missedWindows >= LAPSE_AFTER_MISSED_WINDOWS ? "lapsed" : "confirmed";
  }

  if (detection.confidence === PROVISIONAL_CONFIDENCE) return "provisional";
  return "unknown";
}

/** The profile a confirmed detection auto-applies (income flow 3). */
async function applyDetectionToProfile(detection: Detection, now: number): Promise<void> {
  if (detection.averageAmount === null) return;
  await saveIncomeProfile({
    cadence: detection.cadence,
    averageAmount: detection.averageAmount,
    sourceWalletIds: [...new Set(detection.stream.map((event) => event.walletId))],
    isManualOverride: false,
  });
  await recomputePercentLimits(now, monthlyEquivalent(detection.cadence, detection.averageAmount));
}

/**
 * Limits rule 11's immediate-recompute exception: "a manual edit to the
 * IncomeProfile or to the Limit recomputes the base immediately".
 *
 * Only percent-of-income limits — a fixed limit has nothing to recompute, and
 * touching it would rewrite an alert state for no reason.
 */
async function recomputePercentLimits(now: number, income: Centavos | null): Promise<void> {
  for (const limit of await listLimits()) {
    if (limit.basis !== "percent-of-income") continue;
    await refreshLimitBase(limit.id, now, income);
  }
}

/**
 * Runs detection, records its notes, and auto-applies a confirmed result when
 * no manual override exists. Returns the summary as it now stands.
 */
export async function refreshIncomeDetection(now: number): Promise<IncomeSummary> {
  const previous = await getIncomeDetectionState();
  const detection = await detect(now);
  const missedWindows = missedWindowsFor(detection, previous.cadence ?? detection.cadence, now);
  const status = statusFor(previous, detection, missedWindows);

  // A lapsed profile keeps the values it last knew (rule 13) — the ledger no
  // longer supports them, which is exactly why they must not be recomputed.
  const keepPrevious = status === "lapsed";

  const next: IncomeDetectionState = {
    status,
    cadence: keepPrevious ? previous.cadence : detection.cadence,
    averageAmount: keepPrevious ? previous.averageAmount : detection.averageAmount,
    sourceWalletIds: keepPrevious
      ? previous.sourceWalletIds
      : [...new Set(detection.stream.map((event) => event.walletId))],
    matchedTransactionIds: detection.matchedEventIds,
    suggestionDismissedSignature: previous.suggestionDismissedSignature,
    missedWindows: status === "confirmed" ? 0 : missedWindows,
    emittedPaydayTransactionIds: previous.emittedPaydayTransactionIds,
  };
  await setIncomeDetectionState(next);

  const profile = await getIncomeProfile();
  if (status === "confirmed" && profile?.isManualOverride !== true && !keepPrevious) {
    await applyDetectionToProfile(detection, now);
  }

  return getIncomeSummary(now);
}

/**
 * What every consumer sees. Manual values win outright when the user has set
 * them (rule 14); otherwise this is detection's current belief.
 */
export async function getIncomeSummary(now: number): Promise<IncomeSummary> {
  void now;
  const [profile, state] = await Promise.all([getIncomeProfile(), getIncomeDetectionState()]);

  if (profile?.isManualOverride === true) {
    return {
      cadence: profile.cadence,
      averageAmount: profile.averageAmount,
      monthlyEquivalent: monthlyEquivalent(profile.cadence, profile.averageAmount),
      status: state.status,
      isManualOverride: true,
      expectedNextAt: null,
      sourceWalletIds: profile.sourceWalletIds,
      // Rule 14 still allows a suggestion under an override, but only on a
      // material divergence — which is m2-part2 Task 13's surface, not this one.
      hasPendingSuggestion: false,
    };
  }

  const known = state.status !== "unknown" && state.cadence !== null;
  return {
    cadence: known ? state.cadence : null,
    averageAmount: known ? state.averageAmount : null,
    monthlyEquivalent:
      known && state.cadence !== null ? monthlyEquivalent(state.cadence, state.averageAmount) : null,
    status: state.status,
    isManualOverride: false,
    expectedNextAt: null,
    sourceWalletIds: state.sourceWalletIds,
    hasPendingSuggestion:
      state.status === "provisional" &&
      state.suggestionDismissedSignature !== `${state.cadence}:${state.averageAmount ?? "none"}`,
  };
}

/** The user accepted the detected income (income flow 2, "Confirm"). */
export async function confirmDetectedIncome(now: number): Promise<IncomeSummary> {
  const detection = await detect(now);
  const state = await getIncomeDetectionState();
  await setIncomeDetectionState({ ...state, status: "confirmed", missedWindows: 0 });
  // `isManualOverride` stays FALSE (income flow 2): accepting what detection
  // found is not the same as typing a figure, and automatic updates continue.
  await applyDetectionToProfile(detection, now);
  return getIncomeSummary(now);
}

/** The user said "not right" (income flow 2, "Dismiss"). */
export async function dismissDetectedIncome(now: number): Promise<void> {
  const detection = await detect(now);
  const state = await getIncomeDetectionState();
  await setIncomeDetectionState({
    ...state,
    suggestionDismissedSignature: suggestionSignature(detection),
  });
}

/**
 * The user typed their income. Rule 14: "Any user-entered cadence, amount, or
 * source-Wallet selection sets `isManualOverride` to true; detection then never
 * modifies the profile."
 */
export async function setManualIncome(
  input: { cadence: IncomeCadence; averageAmount: Centavos; sourceWalletIds: string[] },
  now: number,
): Promise<IncomeSummary> {
  await saveIncomeProfile({ ...input, isManualOverride: true });
  await recomputePercentLimits(now, monthlyEquivalent(input.cadence, input.averageAmount));
  return getIncomeSummary(now);
}

/**
 * "Switch to automatic" (rule 15). Clears the override and adopts the current
 * confirmed detection; with none, the profile returns to Unknown and
 * percent-of-income Limits pause.
 */
export async function clearManualIncome(now: number): Promise<IncomeSummary> {
  await clearIncomeProfile();
  const detection = await detect(now);

  if (detection.confidence === CONFIRMED_CONFIDENCE && detection.averageAmount !== null) {
    await applyDetectionToProfile(detection, now);
    const state = await getIncomeDetectionState();
    await setIncomeDetectionState({ ...state, status: "confirmed", missedWindows: 0 });
    return getIncomeSummary(now);
  }

  const state = await getIncomeDetectionState();
  await setIncomeDetectionState({
    ...state,
    status: "unknown",
    cadence: null,
    averageAmount: null,
  });
  await recomputePercentLimits(now, null);
  return getIncomeSummary(now);
}

/**
 * Monthly-equivalent income **M**, or `null` when it is not known — the single
 * figure `baseFor` consumes for a percent-of-income Limit (limits rule 10).
 *
 * This replaces the placeholder m2 Task 8 created at this path so the limits
 * hooks had something real to import.
 */
export async function getMonthlyEquivalentIncome(now: number): Promise<Centavos | null> {
  return (await getIncomeSummary(now)).monthlyEquivalent;
}

/**
 * Emits `income:payday` for a credit that matches the profile (rule 11), at
 * most once per transaction (plan rule 4). Returns whether it emitted.
 *
 * DEDUPLICATED BY TRANSACTION ID, PERSISTED. The subscriber moves real money
 * into a Goal (rule 12), so a retry, a re-render, or a second drained capture
 * batch must not fire twice. In-memory deduplication would not survive the app
 * being killed between the credit landing and the user opening the app.
 */
export async function maybeEmitPayday(now: number): Promise<boolean> {
  const summary = await getIncomeSummary(now);
  if (summary.cadence === null || summary.averageAmount === null) return false;

  const state = await getIncomeDetectionState();
  const detection = await detect(now);
  const alreadyEmitted = new Set(state.emittedPaydayTransactionIds);

  // NEWEST FIRST. Several credits can qualify at once on a first run after a
  // quiet spell, and the one worth announcing is the one that just landed.
  const payday = [...detection.stream].reverse().find((event) => {
    if (alreadyEmitted.has(event.transactionId)) return false;
    if (!summary.sourceWalletIds.includes(event.walletId)) return false;

    // Rule 11: the timestamp must fall in the CURRENT expected window, not in
    // any window this stream ever matched.
    const age = now - event.occurredAt;
    if (age < 0 || age > CURRENT_WINDOW_MS) return false;

    if (summary.cadence === "irregular") {
      // Rule 11: "For cadence: irregular there are no windows: any
      // primary-stream candidate ≥ ₱1,000.00 counts as a payday."
      return event.amount >= IRREGULAR_PAYDAY_FLOOR;
    }

    const withinAmount =
      Math.abs(event.amount - summary.averageAmount!) <=
      summary.averageAmount! * PAYDAY_AMOUNT_TOLERANCE;
    // The event matched a real expected window during detection; that is what
    // `matchedEventIds` means. Re-deriving the window here would be a second
    // implementation of rule 6 that could disagree with the first.
    return withinAmount && detection.matchedEventIds.includes(event.transactionId);
  });

  if (payday === undefined) return false;

  await setIncomeDetectionState({
    ...state,
    emittedPaydayTransactionIds: [...state.emittedPaydayTransactionIds, payday.transactionId].slice(
      -EMITTED_HISTORY,
    ),
  });

  await emitAppEvent(PAYDAY_EVENT, {
    transactionId: payday.transactionId,
    walletId: payday.walletId,
    amount: payday.amount,
    occurredAt: payday.occurredAt,
  });
  return true;
}

/** Exported for tests and bootstrap: the shape a fresh device starts from. */
export const UNKNOWN_INCOME = UNKNOWN_INCOME_DETECTION;
