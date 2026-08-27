// lib/ingest/rule_matcher.ts — the one place a `UserRuleMatcher` is tested
// against a `NormalizedEvent`.
//
// Extracted out of categorizer.ts (plan Task 8) so the transfer detector's
// `mark-transfer` rule lookup and the categorizer's `set-category` rule lookup
// share this exact logic rather than each carrying its own copy that can
// silently drift from the other.
import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { UserRuleMatcher } from "@/types/domain";

/**
 * A merchant string folded for comparison, or `null` when it carries no
 * information. Blank is treated as absent: `merchant: "   "` is a parse that
 * bound the group to whitespace, which says nothing about who was paid.
 */
export function foldMerchant(merchant: string | null | undefined): string | null {
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
export function matcherApplies(matcher: UserRuleMatcher, event: NormalizedEvent): boolean {
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
