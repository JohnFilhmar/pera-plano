// lib/ingest/normalizer.ts — Stage 3, where money is assigned to an account.
//
// docs/03-ingest-pipeline.md §5. One `ParsedEvent` in, one `NormalizedEvent`
// out: the same transaction, plus the two things the parser could not know —
// which Wallet it belongs to, and which channel it arrived on.
//
// WHY THIS STAGE IS THE CAREFUL ONE. Every other stage fails visibly. A wrong
// amount looks wrong in the ledger; a wrong direction looks wrong in the
// totals. A wrong `walletId` looks completely normal: the transaction is there,
// the amount is right, and two balances are quietly off with nothing on screen
// to explain why. There is no symptom to notice and nothing to search for.
//
// So the rule this file is built around is: RESOLVE OR ASK, NEVER GUESS.
// `walletId: null` is a HARD ROUTE to the Review Queue (§9.2) — not a soft
// penalty, not a degraded score. It costs the user one tap, and their
// assignment there becomes a UserRule that fixes the case permanently (§5
// rule 4). Picking "the first plausible wallet" costs them a corrupted balance
// they cannot diagnose. Those are not comparable, and every ambiguous branch
// below resolves to `null` for that reason.
//
// Pure: no I/O, no clock, no database. The wallets and the matchers are handed
// in by the orchestrator, which owns the repositories.
import type { ParsedEvent } from "@/lib/ingest/parser";
import type { PipelineTunables, ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { Wallet, WalletMatcher } from "@/types/domain";

/**
 * The canonical event. Plan Task 5.
 *
 * `merchant` is inherited from `ParsedEvent` and restated deliberately: from
 * here on it is the CLEANED form (collapsed, de-referenced, title-cased), not
 * the raw capture group. The original survives on the `raw_notifications` row
 * for the 30-day retention window (§5 rule 3).
 *
 * `confidence` is inherited too, and is the one field whose VALUE can change
 * here — see `applyFallbackPenalty`.
 */
export type NormalizedEvent = ParsedEvent & {
  /** `null` = unresolvable → hard route to the Review Queue (§9.2). Never a guess. */
  walletId: string | null;
  merchant?: string;
  channel: "push" | "sms";
};

/**
 * Confidence arithmetic in ten-thousandths, for the reason `parser.ts` spells
 * out at its own `SCORE_SCALE`: `0.7 - 0.1` is `0.5999999999999999` in
 * IEEE-754, which is BELOW the 0.60 prefilled threshold. A partial-template
 * match resolved by fallback would route to "needs details" instead of
 * "prefilled" on rounding dust alone, and §9.2's table would read as though it
 * said something it does not.
 *
 * Redeclared rather than imported because it is an internal of that module;
 * the two must stay equal, and the scale is a property of the spec's two
 * decimal places, not of either file.
 */
const SCORE_SCALE = 10_000;

const toScaled = (value: number): number => Math.round(value * SCORE_SCALE);

/** How the wallet was arrived at. Only the fallback path is charged (§9.1). */
type WalletResolution = { walletId: string | null; usedFallback: boolean };

/**
 * A hint, folded for comparison, or `null` when it carries no information.
 *
 * A BLANK HINT IS TREATED AS AN ABSENT ONE. `wallet_matchers.hint` is nullable,
 * and a settings form writing `""` where it meant `NULL` is the likeliest way a
 * row ends up blank. Blank carries no discriminating information, which is
 * exactly what absent means — so a blank-hint row behaves as the provider-wide
 * row the user was trying to create. The alternative, failing closed, would
 * silently stop every notification from reaching that wallet.
 *
 * (`source_router.ts` fails CLOSED on a blank `senderId` instead, and the
 * asymmetry is deliberate: there a blank prefix matches EVERY message, so
 * accepting it widens a privacy gate. Here a blank hint narrows nothing.)
 */
function foldHint(hint: string | null | undefined): string | null {
  const folded = hint?.trim().toLowerCase();
  return folded === undefined || folded === "" ? null : folded;
}

/**
 * The matcher rows that CLAIM this event, by specificity. Spec §5 rule 4.
 *
 * Keyed on `package_name`, never on `providerKey` — `wallet_matchers` has no
 * `provider_key` column (contract's shipped-reality table, `001_core.sql:21`).
 * The provider's whole `packageNames` list is checked because one provider
 * legitimately ships more than one package.
 *
 * TWO TIERS, AND THE NARROWER ONE WINS OUTRIGHT:
 *
 *   1. Hint-qualified rows whose `hint` equals the event's `walletHint`. This
 *      is the "one provider, two Wallets" case §5 rule 4 names — GCash main vs
 *      GSave, Maya wallet vs Maya savings.
 *   2. Otherwise, the unqualified (provider-wide) rows.
 *
 * A hinted row whose hint does NOT fire claims nothing: it is a statement about
 * a different sub-account. And when tier 1 fires, tier 2 is discarded rather
 * than merged — merging them would make the ordinary "one provider-wide row
 * plus one GSave row" setup permanently ambiguous, which is the single most
 * likely way a real user configures this.
 *
 * HINTS ARE COMPARED FOR EQUALITY, folded for case and surrounding whitespace,
 * and not by substring. A substring rule lets two rows claim the same event
 * ("save" and "gsave" both match a "GSave" hint) and turns a deterministic
 * route into an accident of array order. If it ever needs loosening, the
 * ambiguity rule in `resolveWallet` is what keeps that safe.
 */
function claimingMatchers(
  event: ParsedEvent,
  provider: ProviderRuleset,
  matchers: WalletMatcher[],
): WalletMatcher[] {
  const applicable = matchers.filter((matcher) =>
    provider.packageNames.includes(matcher.packageName),
  );

  const eventHint = foldHint(event.walletHint);
  const qualified =
    eventHint === null
      ? []
      : applicable.filter((matcher) => foldHint(matcher.hint) === eventHint);

  if (qualified.length > 0) return qualified;

  return applicable.filter((matcher) => foldHint(matcher.hint) === null);
}

/**
 * The distinct wallets a set of matchers points at that can actually receive
 * money — present in `wallets` and not archived.
 *
 * DISTINCT, because two rows naming the same wallet are agreement, not
 * ambiguity: a user who added a matcher from onboarding and again from a Review
 * Queue correction has one destination, not two.
 */
function selectableTargets(matchers: WalletMatcher[], wallets: Wallet[]): string[] {
  const targets = new Set<string>();

  for (const matcher of matchers) {
    const wallet = wallets.find((candidate) => candidate.id === matcher.walletId);
    if (wallet === undefined || wallet.isArchived) continue;
    targets.add(wallet.id);
  }

  return [...targets];
}

/**
 * Spec §5 rule 4 and §9.1's fallback penalty, in three branches.
 *
 * (a) MATCHERS CLAIMED IT. Exactly one selectable target → that wallet, at no
 *     penalty: nothing was inferred, the user said so.
 *
 *     Anything else → `null`, INCLUDING the case where the matchers named only
 *     unusable wallets (archived, or absent from `wallets` because they were
 *     deleted or filtered out). This is the decision worth defending: a matcher
 *     is an explicit statement that this provider's money belongs in THAT
 *     wallet. When it cannot go there, the honest conclusion is "I know where
 *     this belongs and I cannot put it there" — not "let me pick a different
 *     account". Falling through to the fallback instead would let one stale row
 *     redirect a provider's whole stream into an unrelated wallet at
 *     `1.00 − 0.10 = 0.90`, which still auto-commits (§9.2), and a dangling id
 *     would fail `transactions.wallet_id`'s foreign key at the committer. The
 *     Review Queue is also the only path that repairs the stale row, since the
 *     user's assignment there becomes a UserRule.
 *
 * (b) NO MATCHER CLAIMED IT. Exactly one non-archived wallet on the device →
 *     that wallet, minus `penalties.walletFallback`. With one open account
 *     there is nowhere else the money could have gone, which is why §9.1
 *     calibrates the penalty to leave an exact match at 0.90 — still
 *     auto-committing.
 *
 *     ON THE PLAN'S "whose type matches the provider's type". There is no such
 *     data: `ProviderRuleset` carries `providerKey`, `packageNames`, `version`,
 *     `channel`, `senderIds` and `templates` (contract §5), and `channel` is a
 *     notification channel, not a Wallet type. Spec §9.1 phrases the same rule
 *     as the parenthetical "e.g., only one Wallet of that type", so the
 *     type filter is an illustration, not a required input. Implemented as
 *     "exactly one open wallet" — if a provider→Wallet-type mapping is ever
 *     added to the ruleset, narrowing the candidate set here is the whole change.
 *
 * (c) Otherwise `null`. Two open wallets and no matcher is the case this whole
 *     file exists for.
 */
function resolveWallet(
  event: ParsedEvent,
  provider: ProviderRuleset,
  wallets: Wallet[],
  matchers: WalletMatcher[],
): WalletResolution {
  const claiming = claimingMatchers(event, provider, matchers);

  if (claiming.length > 0) {
    const targets = selectableTargets(claiming, wallets);
    if (targets.length !== 1) return { walletId: null, usedFallback: false };
    return { walletId: targets[0], usedFallback: false };
  }

  const open = wallets.filter((wallet) => !wallet.isArchived);
  if (open.length !== 1) return { walletId: null, usedFallback: false };

  return { walletId: open[0].id, usedFallback: true };
}

/**
 * Reference labels that mark the start of a trailing reference fragment.
 *
 * Deliberately a closed list of REFERENCE WORDS, and every entry needs a code
 * after it to strip anything. Two things are deliberately NOT stripped:
 *
 *   - A bare trailing code ("SM Store 1234", "7-Eleven 09821"). It is
 *     indistinguishable from a branch number, and merging two branches into one
 *     merchant is a silent data loss the user cannot see.
 *   - A bare label with no code ("Jollibee Ref"). More likely part of a name
 *     than a truncated reference.
 *
 * Short, ambiguous labels are left out for the same reason — `conf` would eat
 * the tail of "PyCon Conf 2025".
 */
const REFERENCE_LABEL = "ref|refno|reference|txn|trxn|transaction|trace|confirmation";

const TRAILING_REFERENCE = new RegExp(
  String.raw`[\s.,;:|/\\–—-]*[([]?\s*\b(?:${REFERENCE_LABEL})\b\.?\s*` +
    String.raw`(?:n[o°]s?\.?|num(?:ber)?\.?|id|code)?\s*[:#-]?\s*` +
    String.raw`[A-Za-z0-9][A-Za-z0-9-]*\s*[)\]]?\s*$`,
  "iu",
);

/**
 * Title-cases one word, unless it was already cased on purpose.
 *
 * A word carrying BOTH an uppercase and a lowercase letter was written that way
 * deliberately — "GCash", "McDonald's", "iPhone", "eBay" — and flattening it to
 * "Gcash" renames a brand in every ledger row it appears in. Everything else
 * (the SHOUTED ALL-CAPS that provider notifications actually use, and bare
 * lowercase) gets the first letter of each hyphen-separated run.
 *
 * Nothing is capitalised after an apostrophe: that turns "JOHN'S" into
 * "John'S", which is worse than the "O'brien" it would have fixed.
 */
function titleCaseWord(word: string): string {
  if (/\p{Ll}/u.test(word) && /\p{Lu}/u.test(word)) return word;

  return word
    .toLowerCase()
    .replace(
      /(^\P{L}*|-)(\p{L})/gu,
      (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
    );
}

/**
 * Spec §5 rule 3 / plan Task 5 rule 2: trim, collapse internal whitespace,
 * strip a trailing reference fragment, title-case.
 *
 * Whitespace is collapsed FIRST so the reference pattern sees a predictable
 * single-spaced tail.
 *
 * AN EMPTY RESULT IS `undefined`, NEVER `""`. An empty string is a value: it
 * renders as a blank merchant in the ledger and reads as "we know the merchant
 * and it is nothing", which is a different claim from "we never learned it".
 * `ParsedEvent.merchant` is optional precisely so the second can be said.
 */
function cleanMerchant(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const collapsed = raw.replace(/\s+/gu, " ").trim();
  const withoutReference = collapsed.replace(TRAILING_REFERENCE, "").trim();
  if (withoutReference === "") return undefined;

  return withoutReference.split(" ").map(titleCaseWord).join(" ");
}

/**
 * Spec §9.1's −0.10, clamped to `[0, 1]`.
 *
 * Charged ONLY on the fallback path. An unresolved wallet is not charged: it is
 * already a hard route to the Review Queue regardless of score (§9.2), so the
 * penalty would buy nothing — while still deciding whether the user sees a
 * prefilled item or a bare "needs details" one. Degrading a perfectly good
 * prefill is a real cost with no benefit.
 */
function applyFallbackPenalty(confidence: number, tunables: PipelineTunables): number {
  const scaled = toScaled(confidence) - toScaled(tunables.penalties.walletFallback);
  return Math.min(SCORE_SCALE, Math.max(0, scaled)) / SCORE_SCALE;
}

/**
 * Normalizes one parsed event against the device's wallets. Spec §5.
 *
 * `matchers` is the `wallet_matchers` table, loaded by the orchestrator — this
 * stage performs no I/O. The plan's signature omitted it, which left rule 1's
 * explicit-matcher path with no data to work from; `normalizeEvent` is not
 * pinned by contract §5, so the parameter was added ahead of the trailing
 * `tunables`, matching the shape every other stage uses.
 *
 * NO CURRENCY CHECK HERE, despite plan rule 3. It is not implementable at this
 * stage and it is already done: a `ParsedEvent` carries no text, so by the time
 * this runs any currency marker is long gone. `parser.ts` owns it
 * (`hasForeignCurrencyMarker`) because it is the only stage that sees the
 * amount and the words around it at the same time.
 */
export function normalizeEvent(
  event: ParsedEvent,
  provider: ProviderRuleset,
  wallets: Wallet[],
  matchers: WalletMatcher[],
  tunables: PipelineTunables,
): NormalizedEvent {
  const resolution = resolveWallet(event, provider, wallets, matchers);
  const merchant = cleanMerchant(event.merchant);

  const normalized: NormalizedEvent = {
    ...event,
    walletId: resolution.walletId,
    channel: provider.channel,
    confidence: resolution.usedFallback
      ? applyFallbackPenalty(event.confidence, tunables)
      : event.confidence,
  };

  // Assigned only when present, so the object matches the contract shape exactly
  // rather than carrying a `merchant: undefined` key the committer would write.
  if (merchant === undefined) delete normalized.merchant;
  else normalized.merchant = merchant;

  return normalized;
}
