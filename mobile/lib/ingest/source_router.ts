// lib/ingest/source_router.ts — Stage 1, and the pipeline's privacy gate.
//
// docs/03-ingest-pipeline.md §3. Every status-bar notification on the device
// arrives here, including all the ones that have nothing to do with money, and
// this stage decides which of three very different things happens to each:
//
//   known         → tagged with a provider identity and handed to the Parser.
//   unknown       → retained in the unknown-bin, where §3 rule 4 SHOWS THE RAW
//                   TEXT to the user in the Review Queue so they can flag it.
//   not_financial → dropped on the spot. Never stored, never displayed, never
//                   counted (§1 principle 2, §3 rule 3 "data minimization").
//
// The two error directions are not symmetric, and the whole design below falls
// out of that:
//
//   - Routing something `not_financial` that was money loses a transaction
//     SILENTLY. Totals drift and nothing on screen ever says why.
//   - Routing something `unknown` that was private takes a friend's text
//     message and PRINTS IT INSIDE A FINANCE APP. The user can dismiss it, but
//     they cannot un-see it, and the app has no business having shown it.
//
// Spec §1 principle 1 ("when the pipeline is unsure, it asks") points at the
// first; §1 principle 2 and §3 rule 3 point at the second. They are reconciled
// by making the QUESTION strict rather than the answer: the money-signal
// predicate demands an actual currency token, and everything that fails it is
// gone. What survives that filter is genuinely money-like, so admitting it to
// the Review Queue is cheap. See `hasMoneySignal` and `routeCapture` below.
//
// Pure: no I/O, no clock, no database. Everything it needs is in its two
// arguments, so the pipeline's most privacy-sensitive decision is a function
// call that can be exhaustively tested on a laptop.
import type { ProviderRuleset, RulesetBundle } from "@/lib/ingest/ruleset_types";
import type { RawCapture } from "@/types/domain";

/**
 * The three routes, as a discriminated union so no caller can read `provider`
 * off a capture that never got one. Plan Task 3 / contract §5 — do not reshape.
 *
 * Every variant carries the capture itself, by reference: the orchestrator
 * persists the raw text (pipeline rule 2) and keys replay-detection on
 * `capture.id` (pipeline rule 11), and both need the original bytes, not a
 * cleaned-up copy.
 */
export type RoutedCapture =
  | { kind: "known"; capture: RawCapture; provider: ProviderRuleset }
  | { kind: "unknown"; capture: RawCapture }
  | { kind: "not_financial"; capture: RawCapture };

/**
 * A currency token immediately followed by a number.
 *
 * The three markers are exactly the ones spec §3 rule 3 names — `₱`, `"PHP"`,
 * `"Php"` — matched CASE-SENSITIVELY and in that spelling only. Lowercase
 * `php` is deliberately absent: it is a programming language and a file
 * extension long before it is a peso, and `/php\s*\d/i` would route a build
 * notification reading "php 8.2" into the Review Queue.
 *
 * DIGITS ARE REQUIRED AFTER THE TOKEN, and a bare number is never enough on
 * its own. Both halves matter:
 *
 *   - Without the digit requirement, "I'll pay you in PHP" is money-like.
 *   - Without the token requirement, every unread-message count, game-currency
 *     balance, order number and battery percentage on the phone is money-like
 *     — which is most of the notification traffic on a phone, including the
 *     group chats. That is the failure this predicate exists to prevent.
 *
 * ON THE SPEC'S "or an amount-shaped pattern" CLAUSE. §3 rule 3 reads "a
 * currency marker (₱, "PHP", "Php") or an amount-shaped pattern", which would
 * admit bare numbers. That clause is not implemented, because the spec
 * contradicts it four paragraphs later: §3's own failure-mode table lists
 * "Money notification without a currency marker → Dropped by pre-filter →
 * Accepted residual risk; tracked as an open question (§14)". The spec
 * therefore already reasons as though the currency marker is REQUIRED, and
 * names the resulting miss as a known, accepted, tracked cost. Implementing
 * the looser clause instead would trade that accepted, bounded loss for an
 * unbounded privacy leak. If §14 is ever resolved the other way, the amount
 * shape to add is a grouped decimal (`1,234.56`) — never a bare integer.
 *
 * No `g` flag: this constant is reused across every call, and a global regex
 * carries `lastIndex` between `test()` calls, so the same notification would
 * match or not depending on what was routed before it.
 */
const MONEY_SIGNAL = /(?:₱|PHP|Php)\s*\d/u;

/**
 * The text fields to inspect for a money signal, richest first.
 *
 * `bigText` → `text` → `title` is the order Task 4's parser reads (plan Task 4
 * rule 2, spec §5 "expanded text is the most complete"), and the two stages
 * have to agree: a capture the router keeps on the strength of a field the
 * parser never reads would arrive as an unparseable Review Queue item forever.
 *
 * `subText` is excluded for that same consistency. It carries an app-supplied
 * label (account nickname, folder, sender line), not the notification body,
 * and the parser does not read it.
 */
function searchableFields(capture: RawCapture): string[] {
  return [capture.bigText, capture.text, capture.title].filter(
    (field): field is string => field !== null,
  );
}

/** Spec §3 rule 3's money-like test. See MONEY_SIGNAL for what "money-like" means and why. */
function hasMoneySignal(capture: RawCapture): boolean {
  return searchableFields(capture).some((field) => MONEY_SIGNAL.test(field));
}

/**
 * Spec §3 rule 2's sender-ID gate: does this notification look like it came
 * from a bank's SMS sender rather than from a person?
 *
 * A PREFIX, NOT A SUBSTRING. "begins with", per the spec's wording — a friend
 * complaining about the queue at the BPI branch is not a bank notification,
 * and `.includes()` here would pull their whole conversation into the pipeline.
 *
 * TITLE OR TEXT ONLY. The Messages app puts the sender ID in the title and the
 * body in `text`; both are checked because a bank that does not repeat its own
 * name in the body would otherwise be missed. `bigText` adds nothing — it is
 * the same body expanded, so it begins with the same characters `text` does.
 *
 * CASE-SENSITIVE. Bank sender IDs are registered alphanumeric addresses and
 * arrive verbatim, in the upper case the ruleset lists them in. Matching
 * case-insensitively would widen the gate to any personal message beginning
 * with "mb" or "bpi", and — because those messages need no money content to
 * pass this gate — would admit them on their first two letters alone. The
 * price of strictness here is small precisely because of the unlisted-sender
 * fallback in `routeCapture`: a real bank SMS that fails this check still
 * carries an amount, so it lands in the Review Queue rather than being lost.
 *
 * FAILS CLOSED on missing, empty, or blank `senderIds`. An `sms` provider with
 * nothing to match against matches nothing at all — the alternative is that a
 * half-written ruleset row silently turns the entire Messages app into a money
 * source, which is exactly the outcome rule 2 exists to prevent. A blank string
 * is screened out for the same reason: `"".startsWith` is true of everything.
 */
function matchesSenderId(capture: RawCapture, senderIds: string[] | undefined): boolean {
  if (senderIds === undefined) return false;

  const prefixes = senderIds.map((id) => id.trim()).filter((id) => id !== "");
  if (prefixes.length === 0) return false;

  return [capture.title, capture.text]
    .filter((field): field is string => field !== null)
    .some((field) => {
      const start = field.trimStart();
      return prefixes.some((prefix) => start.startsWith(prefix));
    });
}

/**
 * Spec §3 rules 1 and 2 together: the package must be in this provider's list,
 * and an `sms` provider must additionally clear the sender-ID gate.
 *
 * A `push` provider matches on the package alone, with no money signal
 * required — §3 rule 5 makes rejecting a wallet app's marketing volume the
 * PARSER's job (§4 rule 3), and pre-filtering here would drop real provider
 * notifications whose wording we simply have not learned yet.
 */
function providerMatches(provider: ProviderRuleset, capture: RawCapture): boolean {
  if (!provider.packageNames.includes(capture.packageName)) return false;
  if (provider.channel !== "sms") return true;
  return matchesSenderId(capture, provider.senderIds);
}

/**
 * Routes one capture. Spec §3.
 *
 * The first provider in BUNDLE ARRAY ORDER that matches wins. Array order, not
 * a lookup object keyed by package name: two providers can legitimately list
 * the same package (a super-app, or several SMS entries over the one Messages
 * app), and object key ordering would make the winner an accident of how the
 * JSON happened to be written. A provider that fails its own sender-ID gate
 * has not matched, so it does not consume the capture — a later entry on the
 * same package still gets its turn.
 *
 * Anything no provider claims falls to the §3 rule 3 pre-filter: money-like
 * survives as `unknown`, everything else is `not_financial` and gone.
 *
 * ---------------------------------------------------------------------------
 * THE CASE THE PLAN LEAVES OPEN, AND WHY IT ROUTES `unknown`.
 *
 * There is a gap between rule 2 and rule 3 that neither covers: the SMS app's
 * package IS listed, the sender ID does NOT match, but the text carries a
 * money signal. A real bank SMS from a sender prefix nobody added to the
 * ruleset looks exactly like this.
 *
 * It routes `unknown` — into the Review Queue — and NOT `not_financial`:
 *
 *   1. Spec §1 principle 1: "Conservative by default. When the pipeline is
 *      unsure, it asks (Review Queue) rather than guesses." An unrecognized
 *      sender carrying a peso amount is the definition of unsure.
 *   2. Spec §9's cost asymmetry, stated in principle 1's own words: a Review
 *      Queue item "costs one tap"; a wrongly dropped transaction "corrupts
 *      totals and destroys trust", and does it invisibly.
 *   3. Our `senderIds` list is a GUESS. Only BPI, BDO, MB and LBP come from
 *      the spec (§3 rule 2); the rest were invented alongside the equally
 *      unverified package names. Strictness here would silently discard real
 *      bank SMS from every prefix we failed to guess — the same silent-failure
 *      class as a wrong package name, but without the unknown-bin safety net
 *      that §3's failure-mode table relies on to catch that one.
 *
 * THE COST, STATED HONESTLY: a friend texting "can you send me PHP 500" will
 * appear in the Review Queue. That is a real privacy cost. It is accepted
 * because the alternative loses money data with no trace, because the money
 * signal keeps the leak narrow (their other messages are still dropped
 * outright), and because the user sees it and can dismiss it.
 *
 * DO NOT "TIDY" THIS INTO `not_financial`. It looks like a stricter, safer
 * default and it is not: it makes every unlisted-prefix bank SMS disappear
 * silently, and the resulting missing transactions are undiagnosable from the
 * app. If it must change, change the sender-ID list first.
 * ---------------------------------------------------------------------------
 */
export function routeCapture(capture: RawCapture, bundle: RulesetBundle): RoutedCapture {
  for (const provider of bundle.providers) {
    if (providerMatches(provider, capture)) {
      return { kind: "known", capture, provider };
    }
  }

  return hasMoneySignal(capture) ? { kind: "unknown", capture } : { kind: "not_financial", capture };
}
