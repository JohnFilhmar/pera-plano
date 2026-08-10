// lib/ingest/categorizer.ts — Stage 6, where a transaction gets its meaning.
//
// docs/03-ingest-pipeline.md §8. One normalized event in, one `CategoryVerdict`
// out: a `categoryId` plus how confident the pipeline is in it.
//
// WHY THIS STAGE IS THE FORGIVING ONE. It is deliberately the least dangerous
// stage in the pipeline, and the code below is written to keep it that way.
// Getting a category wrong misstates a report and can mis-fire a category
// Limit; it never moves money, never loses a transaction, and is fixable in one
// tap from anywhere the Transaction appears. So the failure posture inverts
// what normalizer.ts does with wallets: THIS stage guesses, and where it cannot
// guess it says "Uncategorized" and lets the commit proceed. §8 rule 4 is
// explicit that uncategorized is a valid, committable state — "categorization
// uncertainty alone never blocks a commit".
//
// That is also why `default` carries a penalty of ZERO (§8 rule 5, plan rule 5).
// The confidence score exists to answer "did we parse this right?", and not
// recognising a merchant is no evidence at all that the amount or direction is
// wrong. Charging for it would push perfectly good parses below the 0.90
// auto-commit line (§9.2) and fill the Review Queue with transactions that have
// nothing wrong with them.
//
// RESOLUTION ORDER (§8 rules 1-4, plan rules 1-2):
//
//   1. UserRule (`set-category`) — the user's own correction. Beats everything.
//   2. Built-in merchant map     — the shipped guess.
//   3. Learned suggestion        — the user's own history, for merchants the
//                                  two steps above left unresolved. Carries a
//                                  0.05 penalty and `source: "learned"`.
//   4. Uncategorized             — no penalty.
//
// The spec words §8 as "later steps override earlier ones" with the merchant
// map first, which reads as though learning outranks the map. It does not:
// step 3 is scoped to "merchants still unresolved", and the map's OWN failure
// mode ("wrong category from the merchant map") is repaired by a UserRule, not
// by learning. So learning fills gaps and corrections override — which is the
// order above.
//
// Pure: no I/O, no clock, no database. The rules and the history are read by
// the orchestrator, which owns the repositories.
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { Transaction, UserRule, UserRuleMatcher } from "@/types/domain";

/**
 * The verdict. Plan Task 8 / consumed by `confidence_gate.ts` (Task 9), which
 * subtracts `penalty` from the running score.
 *
 * `source` is not decoration: the Transaction detail sheet shows *why* a
 * category was chosen ("Why was this recorded?", docs/04-features/11 §), and a
 * learned guess has to be visibly marked as suggested rather than presented
 * with the same authority as a rule the user wrote (§8 failure mode
 * "overeager learned suggestion").
 */
export type CategoryVerdict = {
  categoryId: string;
  source: "merchant_map" | "user_rule" | "learned" | "default";
  penalty: number;
};

/**
 * Confidence charged for a learned suggestion (plan rule 3). A learned category
 * is the app's inference, not the user's instruction, so it lands just below
 * auto-commit-with-no-other-doubts and is marked as suggested in the UI.
 *
 * NOT a member of `PipelineTunables.penalties` — §9.1's penalty table does not
 * list a learned-category charge, so unlike the other five this one cannot be
 * recalibrated from the ruleset service. Worth folding in when §9.1 is
 * calibrated against the corpus (§11.3); noted here so the omission is a
 * recorded gap rather than an oversight.
 */
const LEARNED_CATEGORY_PENALTY = 0.05;

/**
 * How many times the user must have filed a merchant the SAME way before the
 * pipeline will repeat it unprompted (§8 rule 3, plan rule 3).
 */
const LEARNED_THRESHOLD = 3;

/**
 * ILLUSTRATIVE, NOT VALIDATED — awaiting the corpus (docs/03-ingest-pipeline.md
 * §11.3), in the same spirit as `seed.json`'s `_note`.
 *
 * The merchant NAMES below are well known in PH; which of the 15 seeded default
 * categories each belongs in is a product judgment nobody has validated, and
 * several are genuinely arguable — a telco charge is "Load & Data" when it is
 * prepaid load and "Bills & Utilities" when it is a postpaid bill, and the
 * notification text often does not say which. Treat every row as a starting
 * guess that the corpus and real usage will correct. A wrong row here is cheap:
 * §8's remedy is one-tap recategorize, and that correction becomes a UserRule
 * which outranks this table permanently.
 *
 * SHAPE. Keys are FOLDED (lowercase, trimmed) fragments, matched with
 * `includes` against the folded merchant, because the strings real
 * notifications carry are "GRABPAY *TRIP" and "JOLLIBEE 12345", not the tidy
 * names — §8's "merchant string instability" failure mode. When several keys
 * match, the LONGEST one wins ("grabfood" beats "grab"), so adding a more
 * specific row never depends on where it sits in the object.
 *
 * Short tokens are deliberately absent (no bare "tnt", no bare "beep"): a
 * three- or four-letter key matched with `includes` will eventually land inside
 * an unrelated merchant string, and a miscategorization nobody can explain is
 * worse than a merchant the map simply does not know. Keys earn their place by
 * being long enough to be unambiguous, and every key must be pre-folded — a key
 * with stray case or padding is one `includes` can never match, so the test
 * file asserts that too.
 *
 * §8 rule 6 wants this map shipped inside the versioned ruleset data so it can
 * be updated without an app release. `RulesetBundle` (contract §5) has no field
 * for it today, so it lives here as a module constant; moving it into the
 * bundle is a ruleset-schema change, not a categorizer change, and this
 * function reads whatever it is handed either way.
 */
export const MERCHANT_CATEGORY_MAP: Readonly<Record<string, string>> = {
  // Transport
  grab: "cat_transport",
  angkas: "cat_transport",
  joyride: "cat_transport",
  "move it": "cat_transport",
  "beep card": "cat_transport",
  autosweep: "cat_transport",
  easytrip: "cat_transport",
  shell: "cat_transport",
  petron: "cat_transport",
  caltex: "cat_transport",

  // Food & Dining
  grabfood: "cat_food_dining",
  foodpanda: "cat_food_dining",
  jollibee: "cat_food_dining",
  mcdonald: "cat_food_dining",
  mcdo: "cat_food_dining",
  chowking: "cat_food_dining",
  greenwich: "cat_food_dining",
  "mang inasal": "cat_food_dining",
  "red ribbon": "cat_food_dining",
  starbucks: "cat_food_dining",
  "jco donuts": "cat_food_dining",

  // Groceries / Palengke
  puregold: "cat_groceries_palengke",
  landers: "cat_groceries_palengke",
  "s&r": "cat_groceries_palengke",
  "sm supermarket": "cat_groceries_palengke",
  "robinsons supermarket": "cat_groceries_palengke",
  "waltermart": "cat_groceries_palengke",
  "7-eleven": "cat_groceries_palengke",
  alfamart: "cat_groceries_palengke",

  // Load & Data (prepaid airtime and data; see the postpaid caveat above)
  smart: "cat_load_data",
  dito: "cat_load_data",
  gomo: "cat_load_data",

  // Bills & Utilities
  meralco: "cat_bills_utilities",
  maynilad: "cat_bills_utilities",
  "manila water": "cat_bills_utilities",
  pldt: "cat_bills_utilities",
  converge: "cat_bills_utilities",
  "globe telecom": "cat_bills_utilities",
  "sky cable": "cat_bills_utilities",
  cignal: "cat_bills_utilities",

  // Shopping
  shopee: "cat_shopping",
  lazada: "cat_shopping",
  zalora: "cat_shopping",
  uniqlo: "cat_shopping",

  // Health & Pharmacy
  "mercury drug": "cat_health_pharmacy",
  watsons: "cat_health_pharmacy",
  "southstar drug": "cat_health_pharmacy",
  "rose pharmacy": "cat_health_pharmacy",

  // Entertainment & Subscriptions
  netflix: "cat_entertainment_subscriptions",
  spotify: "cat_entertainment_subscriptions",
  "disney+": "cat_entertainment_subscriptions",
  "youtube premium": "cat_entertainment_subscriptions",
  viu: "cat_entertainment_subscriptions",
};

/** Map keys longest-first, so the most specific match is found first. */
const MERCHANT_MAP_KEYS: readonly string[] = Object.keys(MERCHANT_CATEGORY_MAP).sort(
  (a, b) => b.length - a.length || (a < b ? -1 : 1),
);

/**
 * A merchant string folded for comparison, or `null` when it carries no
 * information. Blank is treated as absent: `merchant: "   "` is a parse that
 * bound the group to whitespace, which says nothing about who was paid.
 */
function foldMerchant(merchant: string | null | undefined): string | null {
  const folded = merchant?.trim().toLowerCase();
  return folded === undefined || folded === "" ? null : folded;
}

/**
 * Does this rule's matcher describe this event?
 *
 * Every field the matcher SETS must match; fields it omits are not conditions.
 * An entirely empty matcher therefore matches everything, which is a legitimate
 * (if blunt) catch-all rule.
 *
 * `merchantPattern` is a case-insensitive SUBSTRING test, not a regex and not
 * equality. Not equality because §8's failure-mode table says so outright —
 * appended reference codes vary per transaction, so rules need "prefix/contains
 * matchers rather than exact-only". Not a regex because the pattern is text a
 * user typed into a form: a merchant containing `(` or `*` would throw at match
 * time (taking the stage down for an input the user cannot connect to the
 * error), and a pathological pattern would hang the pipeline on a notification.
 *
 * A BLANK `merchantPattern` FAILS CLOSED — it matches nothing, where `includes`
 * would have it match everything. A settings form writing `""` where it meant
 * "no merchant condition" is the likeliest way a pattern ends up blank, and the
 * two failure directions are not comparable: fail-closed loses one rule the
 * user can see is not working, fail-open silently recategorizes their entire
 * ledger. (normalizer.ts's `foldHint` resolves its blank the other way, and the
 * asymmetry is the same reasoning: there a blank hint NARROWS nothing, here a
 * blank pattern WIDENS to everything.)
 */
function matcherApplies(matcher: UserRuleMatcher, event: NormalizedEvent): boolean {
  if (
    matcher.providerKey !== undefined &&
    matcher.providerKey.trim().toLowerCase() !== event.providerKey.trim().toLowerCase()
  ) {
    return false;
  }

  if (matcher.merchantPattern !== undefined) {
    const pattern = matcher.merchantPattern.trim().toLowerCase();
    const merchant = foldMerchant(event.merchant);
    if (pattern === "" || merchant === null || !merchant.includes(pattern)) {
      return false;
    }
  }

  if (matcher.direction !== undefined && matcher.direction !== event.direction) {
    return false;
  }

  // Inclusive bounds, and compared against `undefined` rather than falsily —
  // `amountMin: 0` is a real floor.
  if (matcher.amountMin !== undefined && event.amount < matcher.amountMin) {
    return false;
  }
  if (matcher.amountMax !== undefined && event.amount > matcher.amountMax) {
    return false;
  }

  return true;
}

/**
 * Orders two competing rules. Lower result = evaluated first.
 *
 * 1. `priority` DESC — the field exists to order competing rules, and it is the
 *    only thing the user can actually set.
 * 2. `createdAt` DESC — docs/02-domain-model.md §3.11: "Later-created rules
 *    evaluate first." A newer correction is the user's more recent intent.
 * 3. `id` ASC — a bulk correction can write several rules inside one
 *    millisecond, and something has to make the order TOTAL. Any stable
 *    discriminator would do; `id` is the one that is always present and
 *    unique.
 *
 * The point of all three is that resolution never depends on the order the
 * caller passed the array in. `user_rules_repo.listUserRules` already sorts by
 * exactly this, but the array reaching `categorize` is the orchestrator's to
 * assemble and this stage re-establishes the order rather than trusting it —
 * two rules disagreeing about a merchant must resolve the same way every time,
 * on every device.
 */
function byEvaluationOrder(a: UserRule, b: UserRule): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The winning `set-category` rule for this event, or `null`. */
function resolveUserRule(rules: UserRule[], event: NormalizedEvent): string | null {
  const winner = rules
    // `isEnabled: false` means the rule does not apply, full stop — §3.11
    // archives a rule by disabling it. A user who switches a rule off and
    // watches it keep firing has no way to make it stop short of deleting it.
    .filter(
      (rule) =>
        rule.isEnabled && rule.action.kind === "set-category" && matcherApplies(rule.matcher, event),
    )
    // A copy: `sort` mutates, and this array belongs to the orchestrator.
    .slice()
    .sort(byEvaluationOrder)[0];

  return winner && winner.action.kind === "set-category" ? winner.action.categoryId : null;
}

/** The built-in map's category for this merchant, or `null`. */
function resolveMerchantMap(merchant: string | null): string | null {
  if (merchant === null) {
    return null;
  }
  for (const key of MERCHANT_MAP_KEYS) {
    if (merchant.includes(key)) {
      return MERCHANT_CATEGORY_MAP[key];
    }
  }
  return null;
}

/**
 * The category this user has filed this merchant under at least
 * `LEARNED_THRESHOLD` times, or `null`.
 *
 * "The same merchant categorized THE SAME WAY three or more times" (§8 rule 3),
 * which is a per-category count, not a per-merchant one. Three rows spread
 * across three categories describe a user who keeps changing their mind, and
 * that is precisely the merchant where a confident guess is most likely to be
 * the wrong one — so they produce nothing.
 *
 * The winner must also be a STRICT plurality. Three rows of Food and three of
 * Shopping both clear the threshold, and picking either is a coin flip dressed
 * up as a suggestion; Uncategorized is the honest answer and costs nothing
 * (rule 5).
 *
 * TWO KINDS OF ROW ARE NOT EVIDENCE, and excluding them matters:
 *   - `UNCATEGORIZED_ID` rows record that nothing classified the merchant, not
 *     that the user chose Uncategorized. Counting them would have every
 *     unrecognised merchant "learn" Uncategorized on its third sighting and
 *     start carrying a 0.05 penalty — turning rule 5's deliberately free
 *     fallback into a charged one and pushing good parses out of auto-commit.
 *   - Transfer-linked rows are not categorized at all (§8 rule 5), so their
 *     `categoryId` reflects no decision the user ever made.
 */
function resolveLearned(history: Transaction[], merchant: string | null): string | null {
  if (merchant === null) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const row of history) {
    if (
      row.transferLinkId !== null ||
      row.categoryId === UNCATEGORIZED_ID ||
      foldMerchant(row.merchant) !== merchant
    ) {
      continue;
    }
    counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [categoryId, count] of counts) {
    if (count > bestCount) {
      best = categoryId;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }

  return best !== null && bestCount >= LEARNED_THRESHOLD && !tied ? best : null;
}

/**
 * Stage 6. Pure, total, and never throws: every path returns a verdict, and an
 * event with no merchant at all lands on the default rather than matching an
 * empty pattern or dereferencing a null.
 */
export function categorize(
  event: NormalizedEvent,
  rules: UserRule[],
  history: Transaction[],
): CategoryVerdict {
  const fromRule = resolveUserRule(rules, event);
  if (fromRule !== null) {
    return { categoryId: fromRule, source: "user_rule", penalty: 0 };
  }

  const merchant = foldMerchant(event.merchant);

  const fromMap = resolveMerchantMap(merchant);
  if (fromMap !== null) {
    return { categoryId: fromMap, source: "merchant_map", penalty: 0 };
  }

  const learned = resolveLearned(history, merchant);
  if (learned !== null) {
    return { categoryId: learned, source: "learned", penalty: LEARNED_CATEGORY_PENALTY };
  }

  return { categoryId: UNCATEGORIZED_ID, source: "default", penalty: 0 };
}
