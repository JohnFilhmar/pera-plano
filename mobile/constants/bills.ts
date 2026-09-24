// constants/bills.ts — bill defaults shared by the form and the repository.
//
// HERE RATHER THAN IN `lib/db/repos/bills_repo.ts`, where these first lived. A
// component importing a repository module pulls `getDatabase` into the UI
// layer, and the MVP release gate greps `components/` for exactly that — the
// rule exists so a screen can never reach the database directly, and an import
// for one harmless constant is still the import that makes it possible.
//
// These are spec defaults, not storage details: docs/04-features/07-bills.md
// rule 10 and its acceptance criteria both require them "without user
// configuration", which is a product fact that outlives whatever writes it.

/** Spec rule 10's default: 3 days before, and on the due date. Negative = before. */
export const DEFAULT_REMINDER_OFFSETS = [-3, 0];

/** The create flow's default category (spec's create-bill flow, step 6). */
export const DEFAULT_BILL_CATEGORY_ID = "cat_bills_utilities";

// ---------------------------------------------------------------------------
// The auto-match rule's own numbers — spec rules 8 and 13-15
// ---------------------------------------------------------------------------
// MOVED OUT OF `lib/bills/bills_service.ts` (GAP-085), unchanged in name and
// value. The bill detail has to state the rule it is matching under — rule 13
// defines `autoMatchRule` as "merchant keyword set + amount tolerance + date
// window", and the detail screen's spec row is "auto-match rule summary" — and
// a summary that carried its own copy of these figures would drift away from
// the matcher on the first tuning pass and lie about what the app does.
//
// Here rather than exported from `bills_service.ts` for this file's own reason,
// above: that module imports the repositories, so a component reaching it for
// one number pulls `getDatabase` into the UI layer.

/**
 * Spec rule 15: the auto-match window opens 7 days before the due date.
 *
 * A CEILING, NOT THE ENFORCED FIGURE (GAP-112). The same rule ends "but never
 * wider than half the bill's period", so a weekly bill gets 3. `matchWindowFor`
 * in lib/bills/rule_summary.ts applies that clamp and is what both the matcher
 * and the bill detail read; these two are the widest it will ever return.
 */
export const WINDOW_OPENS_DAYS_BEFORE = 7;
/** ...and closes 15 days after it, subject to the same clamp. */
export const WINDOW_CLOSES_DAYS_AFTER = 15;
/**
 * Except for an overdue cycle, where rule 26 keeps it open for 30 days:
 * "late payment of an overdue bill is the expected resolution path", and a
 * window that shut first would leave the app unable to recognise the very
 * payment it has been nagging for.
 */
export const OVERDUE_WINDOW_DAYS = 30;

/** Spec rule 14's floor for a FIXED bill: ±₱30.00 or ±3%, whichever is greater. */
export const FIXED_TOLERANCE_CENTAVOS = 3000;
export const FIXED_TOLERANCE_PCT = 3;
/** ...and ±30% of the current estimate for an ESTIMATED one. */
export const ESTIMATED_TOLERANCE_PCT = 30;

/** Spec rule 13: confirmations needed before matching goes silent. */
export const LADDER_THRESHOLD = 3;
/** Spec rule 8: a jump this large always asks, ladder or no ladder. */
export const ALWAYS_CONFIRM_DEVIATION_PCT = 30;
