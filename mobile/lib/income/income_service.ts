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
//    payload is also the better one: it carries `transactionIds`, which are
//    exactly what rule 4's deduplication needs and the plan's shape lacks.
//    `cadence` is dropped because no subscriber uses it (goals allocate against
//    the pay that actually arrived, rule 12) and the bus's stated rule is that
//    payloads are identifiers, not copies of state.
//
// 3. NOTHING HERE EVER PRODUCES A ZERO INCOME. `null` travels end to end, so an
//    unknown income reaches `baseFor` as `null` and a percent-of-income Limit
//    reads as **Paused — income unknown** (limits rule 12). A zero would read
//    instead as "you have spent infinity percent of your limit".
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
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
import type { Centavos, EpochMs, IncomeCadence } from "@/types/domain";

import {
  CONFIRMED_CONFIDENCE,
  detectCadence,
  missedWindowsSince,
  PROVISIONAL_CONFIDENCE,
} from "./cadence_detector";
import { primaryStream, selectCandidates, type CandidateEvent } from "./candidates";
import { averageAmountFor, monthlyEquivalent } from "./income_math";
import { collapsePaydays } from "./paydays";

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
  /**
   * What accepting that suggestion would set the profile to, when the user has
   * DECLARED their income and detection has since diverged from it (rule 14).
   *
   * The declared-income card shows the user's own figures, so without this the
   * suggestion would be asking them to accept a number that is nowhere on
   * screen. `null`/absent for the detection-only case, where the card's main
   * sentence already IS what is being proposed.
   */
  suggestedChange?: { cadence: IncomeCadence; averageAmount: Centavos } | null;
  /**
   * Whether the user still has to be told that split paydays moved their income
   * figure, and with it the headroom of every percent-of-income Limit
   * (GAP-117). At most once, ever, and only for a device the change actually
   * moved — `settleSplitPaydayNotice` owns that judgement.
   *
   * A FIELD ON THE SUMMARY rather than its own hook, so it arrives beside the
   * figure it is about: the Income card already renders rule 3's dismissed
   * suggestion and rule 13's lapse prompt off this same object, and a second
   * query would let the notice and the number it explains render a frame apart.
   */
  hasSplitPaydayNotice: boolean;
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
 * Rule 14: under a manual override, detection may only interrupt when the
 * detected `averageAmount` "diverges from the declared amount by more than
 * 20%".
 *
 * MORE THAN, so exactly 20.0% raises nothing — the rule names the far side of
 * the boundary, not the boundary. And the DECLARED amount is the denominator,
 * for the same reason: "diverges FROM the declared amount by more than 20%"
 * measures the gap against the figure it diverged from. That is also the only
 * stable choice — the declared amount holds still while a median-based
 * detection moves, so a ratio taken against detection would slide the
 * threshold every payday.
 */
const OVERRIDE_DIVERGENCE_THRESHOLD = 0.2;

/**
 * How far back "the CURRENT expected window" reaches (rule 11).
 *
 * A window is the anchor ±3 days, so seven days wide. Without this bound,
 * `maybeEmitPayday` finds the OLDEST matched event in the stream — every past
 * payday satisfies "right wallet, right amount, matched a window" — and
 * announces a payday from three months ago the first time it runs.
 */
const CURRENT_WINDOW_MS = 7 * DAY_MS;

/**
 * How many emitted payday ids to remember. See `emittedPaydayTransactionIds`.
 *
 * IDS, NOT PAYDAYS: a payday split into two deposits spends two slots, because
 * both have to be remembered or the sibling credit announces the payday again.
 * Fifty still covers well over a year of kinsenas paid in halves, and a payday
 * old enough to age out of this list has aged out of the detection window too.
 */
const EMITTED_HISTORY = 50;

type Detection = {
  cadence: IncomeCadence;
  confidence: number;
  averageAmount: Centavos | null;
  expectedNextAt: number | null;
  matchedEventIds: string[];
  stream: CandidateEvent[];
  /** The stream credits `matchedEventIds` selected — the evidence `averageAmount` is built from. */
  matched: CandidateEvent[];
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
  //
  // `now` IS PASSED THROUGH so the tier's history floor is measured against the
  // instant this detection pass is running at, not against whatever the wall
  // clock says inside the repository. Everything in this file is clock-injected
  // for the reason lib/clock.ts gives; a repository reaching for `Date.now()`
  // behind it would put one un-pinnable instant in the middle of a pinned
  // calculation.
  const transactions = await listTransactions({ from, to: now + 1, now });
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
    matched,
  };
}

/**
 * The pay that ACTUALLY ARRIVED between two instants, newest last.
 *
 * Same evidence `detect` runs on — `primaryStream(selectCandidates(...))` — so
 * a row counts as pay here exactly when income detection would count it, and
 * the two can never disagree about what a payday is.
 *
 * IT EXISTS FOR SAFE-TO-SPEND'S CONTRIBUTIONS TERM. That term used to be a
 * forecast off the cadence: project the kinsenas anchors, reserve a goal
 * contribution on each. A projected date is a guess, and a wrong guess is not
 * harmless — the owner's 2026-09-01 report was a ₱2,500 allocation reserved
 * for a payday that had passed WITHOUT the pay arriving, which held
 * Safe-to-Spend at ₱0.00 for a week. Salaries are late, early, split, or
 * skipped; a date on a calendar is not evidence that money moved.
 *
 * `from` IS WIDENED BY THE REFUND WINDOW before querying, because rule 2's
 * refund test compares a credit against outflows in the SEVEN DAYS BEFORE it
 * (lib/income/candidates.ts). Querying exactly `[from, to)` would hide those
 * outflows and let a refund at the start of the range pass as pay.
 */
export async function listPayEventsBetween(
  from: EpochMs,
  to: EpochMs,
): Promise<CandidateEvent[]> {
  const REFUND_LOOKBACK_MS = 7 * DAY_MS;
  const transactions = await listTransactions({ from: from - REFUND_LOOKBACK_MS, to });
  const loanPaymentIds = new Set(await listLoanPaymentTransactionIds());

  return primaryStream(selectCandidates(transactions, loanPaymentIds))
    .filter((event) => event.occurredAt >= from && event.occurredAt < to)
    .sort((a, b) => a.occurredAt - b.occurredAt);
}

/** The one place the signature's shape is written down. */
function signatureOf(cadence: IncomeCadence | null, averageAmount: Centavos | null): string {
  return `${cadence}:${averageAmount ?? "none"}`;
}

/**
 * What the user would be asked to accept, as a stable string. A SIGNATURE
 * rather than a boolean, per rule 3: a genuinely different suggestion — a
 * raise, a new employer — was never dismissed and should still be allowed to
 * ask.
 */
function suggestionSignature(detection: Detection): string {
  return signatureOf(detection.cadence, detection.averageAmount);
}

/**
 * What detection would ask a user who has DECLARED their income to accept, or
 * `null` when it has nothing worth interrupting them for (rule 14: "raises a
 * suggestion card only when the detected `averageAmount` diverges from the
 * declared amount by more than 20%, or a different cadence reaches confirmed
 * status").
 *
 * CONFIRMED ONLY, FOR BOTH CLAUSES. The cadence clause says so outright, and
 * reading the amount clause as accepting weaker evidence would mean a
 * provisional guess may tell a user their salary changed while the same
 * provisional guess may not tell them their pay schedule did. A `lapsed`
 * detection is excluded for a different reason: rule 13 keeps its last known
 * figures precisely BECAUSE the ledger stopped supporting them, so they are the
 * one thing that must never be offered as news.
 *
 * The comparison is a multiplication rather than a ratio so a declared zero —
 * which `NewIncomeProfile.averageAmount` permits — cannot divide.
 */
function divergentDetection(
  profile: { cadence: IncomeCadence; averageAmount: Centavos | null },
  state: IncomeDetectionState,
): { cadence: IncomeCadence; averageAmount: Centavos } | null {
  if (state.status !== "confirmed") return null;
  if (state.cadence === null || state.averageAmount === null) return null;

  const suggestion = { cadence: state.cadence, averageAmount: state.averageAmount };
  if (state.cadence !== profile.cadence) return suggestion;

  if (profile.averageAmount === null) return null;
  const gap = Math.abs(state.averageAmount - profile.averageAmount);
  return gap > profile.averageAmount * OVERRIDE_DIVERGENCE_THRESHOLD ? suggestion : null;
}

/**
 * Consecutive expected windows since the last credit in the stream.
 *
 * Derived rather than stored: `IncomeDetectionState` has nowhere to keep the
 * previous `expectedNextAt`, and deriving it means a lapse cannot drift out of
 * step with the ledger it is supposed to describe.
 *
 * THE COUNTING ITSELF IS `cadence_detector`'s, because rule 6 is. This function
 * owns only the two edges rule 13 leaves to the service: an EMPTY stream lapses
 * outright — there is no last credit to count from, and a confirmed profile
 * whose evidence has entirely fallen out of the trailing window has certainly
 * missed two windows — and everything else is a question about expected windows,
 * which the detector answers.
 */
function missedWindowsFor(detection: Detection, previousCadence: IncomeCadence, now: number): number {
  const last = detection.stream[detection.stream.length - 1];
  if (last === undefined) return LAPSE_AFTER_MISSED_WINDOWS;
  return missedWindowsSince(previousCadence, last.occurredAt, now);
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

/**
 * The profile a confirmed detection auto-applies (income flow 3).
 *
 * WRITES THE PROFILE AND NOTHING ELSE. Limits rule 11 applies automatic income
 * drift "from the next period start" only, and `refreshLimitBase`'s own
 * contract repeats it: re-snapshotting a base here would move the figure the
 * user is being measured against halfway through the period they are being
 * measured in, so a limit they were inside yesterday reads as over today with
 * nothing on screen to explain it. `resolveState` already takes a fresh
 * `baseFor(limit, M)` on every pass and adopts it at the period boundary, which
 * is where drift belongs. The three USER-ACTION paths — `setManualIncome`,
 * `clearManualIncome` and `confirmDetectedIncome` — call
 * `recomputePercentLimits` themselves, which is rule 11's manual-edit
 * exception.
 *
 * `keepManualOverride` is flow "manual override and back" step 3: accepting the
 * rule-14 suggestion "updates the values but keeps `isManualOverride` true (the
 * user made the change)". Defaulting it to false is what keeps the automatic
 * path and "switch to automatic" automatic.
 */
async function applyDetectionToProfile(
  detection: Detection,
  keepManualOverride = false,
): Promise<void> {
  if (detection.averageAmount === null) return;
  await saveIncomeProfile({
    cadence: detection.cadence,
    averageAmount: detection.averageAmount,
    sourceWalletIds: [...new Set(detection.stream.map((event) => event.walletId))],
    isManualOverride: keepManualOverride,
  });
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
    await applyDetectionToProfile(detection);
  }

  await settleSplitPaydayNotice({
    previousAverage: previous.averageAmount,
    nextAverage: keepPrevious ? null : next.averageAmount,
    matched: detection.matched,
    isManualOverride: profile?.isManualOverride === true,
  });

  return getIncomeSummary(now);
}

/**
 * Decides, ONCE per device, whether the user is owed GAP-117's notice — that
 * their income figure and any percent-of-income Limit headroom changed because
 * the app now counts a payday split across two deposits as one payday.
 *
 * THERE IS NO MIGRATION AND NOTHING TO RECOMPUTE, which is worth stating
 * plainly because the owner's decision asked for "a one-time recompute on
 * upgrade" and this is what that turns out to be. `detect` reads the ledger and
 * recomputes the whole belief on every pass, persisting only what it derived;
 * `refreshIncomeDetection` runs at bootstrap and on every ledger commit
 * (lib/income/income_ledger_subscriber.ts), and it overwrites the profile
 * itself whenever detection is confirmed and unoverridden. The new figure
 * therefore lands on the first pass after the upgrade with no migration step,
 * and percent-of-income Limits adopt it at their next period boundary, which is
 * limits rule 11's own timing for automatic income drift. The only thing that
 * genuinely needs persisting is the fact that the user has yet to be TOLD.
 *
 * ONLY FOR A USER WHOSE FIGURE ACTUALLY MOVED, which needs all four tests:
 *
 *   1. a figure existed before this pass — `previousAverage` is what the OLD
 *      build last wrote. A device with none is a fresh install (or a user
 *      detection never got a figure for), and nothing can have moved for them.
 *      This is also what stops a NEW user's ordinary median drift from reading
 *      as this upgrade's doing: their very first pass settles the question to
 *      `done` before they have a second figure to compare.
 *   2. this pass produced a fresh figure. A `lapsed` pass deliberately keeps the
 *      old values (rule 13), so it is evidence of nothing and the decision waits
 *      for a pass that recomputes.
 *   3. the figure moved.
 *   4. a matched payday arrived in more than one credit — the only input this
 *      change treats differently. Without it, a figure that moved did so because
 *      the user's pay changed, and telling them otherwise would be a lie.
 *
 * A DECLARED INCOME IS EXEMPT (rule 14). Detection may not touch the profile
 * there, so neither the figure on screen nor any limit built on it moves, and a
 * notice announcing a change that did not happen is worse than silence. Rule
 * 14's own suggestion card is the surface for what detection now believes.
 */
async function settleSplitPaydayNotice(input: {
  previousAverage: Centavos | null;
  nextAverage: Centavos | null;
  matched: CandidateEvent[];
  isManualOverride: boolean;
}): Promise<void> {
  if ((await getSetting("income_split_payday_notice")) !== "undecided") return;

  if (input.previousAverage === null) {
    await setSetting("income_split_payday_notice", "done");
    return;
  }
  // Nothing recomputed this pass, so nothing is settled by it either.
  if (input.nextAverage === null) return;

  const moved = input.nextAverage !== input.previousAverage;
  const splitPayday = collapsePaydays(input.matched).some(
    (payday) => payday.credits.length > 1,
  );
  const due = moved && splitPayday && !input.isManualOverride;
  await setSetting("income_split_payday_notice", due ? "due" : "done");
}

/**
 * The user has read GAP-117's notice. It never comes back — the figure it
 * explains only moved once.
 */
export async function dismissSplitPaydayNotice(): Promise<void> {
  await setSetting("income_split_payday_notice", "done");
}

/**
 * What every consumer sees. Manual values win outright when the user has set
 * them (rule 14); otherwise this is detection's current belief.
 */
export async function getIncomeSummary(now: number): Promise<IncomeSummary> {
  void now;
  const [profile, state, splitPaydayNotice] = await Promise.all([
    getIncomeProfile(),
    getIncomeDetectionState(),
    getSetting("income_split_payday_notice"),
  ]);
  const hasSplitPaydayNotice = splitPaydayNotice === "due";

  if (profile?.isManualOverride === true) {
    // Rule 14's suggestion under an override. The DECLARED figures are still
    // what this summary reports — nothing below rewrites them, and nothing
    // will until the user accepts. Detection's own belief only rides along in
    // `suggestedChange`, so the card has a number to show.
    const suggested = divergentDetection(profile, state);
    const alreadyDismissed =
      state.suggestionDismissedSignature === signatureOf(state.cadence, state.averageAmount);

    return {
      cadence: profile.cadence,
      averageAmount: profile.averageAmount,
      monthlyEquivalent: monthlyEquivalent(profile.cadence, profile.averageAmount),
      status: state.status,
      isManualOverride: true,
      expectedNextAt: null,
      sourceWalletIds: profile.sourceWalletIds,
      hasPendingSuggestion: suggested !== null && !alreadyDismissed,
      suggestedChange: alreadyDismissed ? null : suggested,
      // NEVER over a declared income, for the same reason
      // `settleSplitPaydayNotice` exempts one: the figure on this card is the
      // user's own and did not move. `settle` already refuses to raise the
      // notice under an override, but an override set AFTER it was raised and
      // before the user read it would otherwise leave the notice describing a
      // number they typed themselves.
      hasSplitPaydayNotice: false,
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
      state.suggestionDismissedSignature !== signatureOf(state.cadence, state.averageAmount),
    // Nothing to carry: on this path the card's own figures ARE detection's.
    suggestedChange: null,
    hasSplitPaydayNotice,
  };
}

/**
 * The user accepted the detected income (income flow 2, "Confirm") — or, when
 * they had declared it themselves, accepted rule 14's "your pay changed"
 * suggestion, which is the same act on the same card.
 */
export async function confirmDetectedIncome(now: number): Promise<IncomeSummary> {
  const detection = await detect(now);
  const state = await getIncomeDetectionState();
  const profile = await getIncomeProfile();
  await setIncomeDetectionState({ ...state, status: "confirmed", missedWindows: 0 });
  // `isManualOverride` stays FALSE (income flow 2): accepting what detection
  // found is not the same as typing a figure, and automatic updates continue.
  //
  // EXCEPT over a declared income, where it stays TRUE (override flow step 3).
  // Clearing it there would turn "yes, my pay changed" into a silent surrender
  // of the user's control over the figure — from then on detection would
  // rewrite it unasked, which is the one thing rule 14 exists to prevent.
  await applyDetectionToProfile(detection, profile?.isManualOverride === true);
  // A confirmation is a user action, so rule 11's immediate exception applies
  // here where it does not on the automatic path.
  await recomputePercentLimits(now, monthlyEquivalent(detection.cadence, detection.averageAmount));
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
    await applyDetectionToProfile(detection);
    // Switching to automatic is a user action, same as `confirmDetectedIncome`.
    await recomputePercentLimits(now, monthlyEquivalent(detection.cadence, detection.averageAmount));
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
 * Emits `income:payday` for the pay that landed on one local date (rule 11), at
 * most once per payday (plan rule 4). Returns whether it emitted.
 *
 * ONE PROMPT PER PAYDAY, NOT PER CREDIT. The thing being announced is "your pay
 * arrived", which is a fact about a payday; the credits are only how it
 * travelled. An employer splitting one packet into two deposits is ordinary
 * here, and screened per credit that payday either fires twice or — when each
 * half falls outside the ±30% band — never fires at all. The collapse is
 * `collapsePaydays`, the same one Safe-to-Spend's contributions forecast runs
 * on, so the money that term reserves and the transfer this prompt asks for can
 * never describe different paydays.
 *
 * THE EMITTED AMOUNT IS THE DAY'S COMBINED PAY, because goals rule 13 computes
 * a percent contribution "from the sum of income Transactions detected on that
 * payday date". Leading with one credit would have `proposePaydayAllocations`
 * take its percentage of half a payday, and cap every allocation at half the
 * budget the user actually received.
 *
 * DEDUPLICATED BY TRANSACTION ID, PERSISTED. The subscriber moves real money
 * into a Goal (rule 12), so a retry, a re-render, or a second drained capture
 * batch must not fire twice. In-memory deduplication would not survive the app
 * being killed between the credit landing and the user opening the app. EVERY
 * id the payday covers is recorded, not just the one the payload leads with:
 * remembering half of a split payday leaves the other half unseen, and the next
 * pass announces the same payday again.
 */
export async function maybeEmitPayday(now: number): Promise<boolean> {
  const summary = await getIncomeSummary(now);
  const { cadence, averageAmount } = summary;
  if (cadence === null || averageAmount === null) return false;

  const state = await getIncomeDetectionState();
  const detection = await detect(now);
  const alreadyEmitted = new Set(state.emittedPaydayTransactionIds);

  /** Rule 11's ±30% band, asked of one figure. */
  const withinBand = (amount: Centavos): boolean =>
    Math.abs(amount - averageAmount) <= averageAmount * PAYDAY_AMOUNT_TOLERANCE;

  const inScope = detection.stream.filter((event) => {
    if (!summary.sourceWalletIds.includes(event.walletId)) return false;
    // Rule 11: the timestamp must fall in the CURRENT expected window, not in
    // any window this stream ever matched.
    const age = now - event.occurredAt;
    return age >= 0 && age <= CURRENT_WINDOW_MS;
  });

  // NEWEST FIRST. Several paydays can qualify at once on a first run after a
  // quiet spell, and the one worth announcing is the one that just landed.
  const payday = [...collapsePaydays(inScope)].reverse().find((candidate) => {
    // ANY covered id, not all of them. A payday announced when its first half
    // landed must stay announced once its second half arrives, or the sibling
    // credit fires the same payday a second time.
    if (candidate.credits.some((credit) => alreadyEmitted.has(credit.transactionId))) return false;

    if (cadence === "irregular") {
      // Rule 11: "For cadence: irregular there are no windows: any
      // primary-stream candidate ≥ ₱1,000.00 counts as a payday."
      //
      // THE FLOOR STAYS PER CREDIT while the collapse applies. The floor is the
      // only thing separating pay from noise on this path — there is no average
      // to compare against — so summing sub-floor credits until they clear it
      // would manufacture paydays out of exactly the small credits it exists to
      // exclude. What the collapse buys here is the other half: one prompt for
      // the day, carrying the day's total, instead of one per gig payment.
      return candidate.credits.some((credit) => credit.amount >= IRREGULAR_PAYDAY_FLOOR);
    }

    // THE DAY'S COMBINED PAY, AND ONLY THAT. Rule 11's band is a test of "is
    // this your pay", and the pay is what arrived on the day.
    //
    // GAP-110 also accepted a day where any SINGLE credit fell in the band, and
    // that clause is gone (GAP-117). It existed for one reason, stated in its
    // own comment: `averageAmount` was itself half a payday, because
    // `detectCadence` recorded one matched credit per expected window and
    // `averageAmountFor` took the median of those credits. Both of those are
    // fixed — the average is now the median of matched PAYDAYS — so the clause
    // no longer rescues anything, and it had turned into the mirror of the bug
    // it was written for: a day carrying two in-band credits (a duplicated
    // deposit, a base payment and an allowance of similar size) has a combined
    // total nowhere near the band, and this clause announced it anyway, at
    // twice the pay. `proposePaydayAllocations` takes its percentage of the
    // emitted amount, so that is a real transfer of double the money.
    const looksLikePay = withinBand(candidate.amount);

    // A credit on this day matched a real expected window during detection;
    // that is what `matchedEventIds` means. Re-deriving the window here would
    // be a second implementation of rule 6 that could disagree with the first.
    //
    // STILL `some`, and now it means what it says. GAP-110 loosened this to
    // "any credit" to work around kinsenas recording one hit per window;
    // `tryKinsenas` now records every credit of the matched PAYDAY, so a day is
    // either matched entirely or not at all and `some` and `every` agree. It
    // stays `some` because the question is about the day, not about each credit
    // — `inScope` can legitimately hold a subset of a day's stream credits.
    return (
      looksLikePay &&
      candidate.credits.some((credit) => detection.matchedEventIds.includes(credit.transactionId))
    );
  });

  if (payday === undefined) return false;

  await setIncomeDetectionState({
    ...state,
    emittedPaydayTransactionIds: [
      ...state.emittedPaydayTransactionIds,
      ...payday.credits.map((credit) => credit.transactionId),
    ].slice(-EMITTED_HISTORY),
  });

  // The wallet holding the BIGGEST share of the day's pay, not the last one to
  // receive some of it. Its one consumer is `proposePaydayAllocations`, which
  // makes it the wallet a transfer would leave from — so a payday split across
  // two accounts has to name the one the money is actually in. Ties go to the
  // later credit, which is the same wallet in the ordinary undivided case.
  const into = payday.credits.reduce((biggest, credit) =>
    credit.amount >= biggest.amount ? credit : biggest,
  );

  await emitAppEvent(PAYDAY_EVENT, {
    transactionIds: payday.credits.map((credit) => credit.transactionId),
    walletId: into.walletId,
    amount: payday.amount,
    // The instant the pay finished arriving. An allocation belongs to the
    // payday, and the payday is complete at its last credit.
    occurredAt: payday.credits[payday.credits.length - 1].occurredAt,
  });
  return true;
}

/** Exported for tests and bootstrap: the shape a fresh device starts from. */
export const UNKNOWN_INCOME = UNKNOWN_INCOME_DETECTION;
