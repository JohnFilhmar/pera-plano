// lib/wallets/matchers.ts — the pure half of matcher editing (m1c Task 5,
// rules 1 and 2). No I/O, no React, no SQL: the repository and the picker both
// import from here so the one rule they share has one definition.
//
// THE TRANSLATION THIS FILE IS. A user recognizes "GCash". A notification
// carries `com.globe.gcash.android`. `wallet_matchers` stores the package, the
// ruleset owns the mapping, and the picker has to show the name — so every
// screen that touches matchers needs the same three conversions, and inventing
// them per screen is how one form writes a row the pipeline cannot route.
//
// THE HINT RULE LIVES HERE TOO. `foldMatcherHint` is byte-for-byte the
// Normalizer's private `foldHint` (lib/ingest/normalizer.ts): trimmed,
// lower-cased, and blank read as absent. That is not a style choice. The
// pipeline decides which rows claim a capture by that folding, and the
// one-pair-one-wallet rule decides which rows may coexist by the same folding.
// If the two ever disagree, the app happily saves a pair it considers distinct
// and the pipeline considers ambiguous — and every capture from that provider
// routes to the Review Queue forever, with no error and no visible cause.
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { NewWalletMatcher, WalletMatcher } from "@/types/domain";

/**
 * A hint as it is COMPARED. Trimmed, case-folded, blank read as absent.
 *
 * See the file header: this must stay identical to `foldHint` in
 * lib/ingest/normalizer.ts. A blank hint narrows nothing, so it means the same
 * thing as no hint — the row claims the whole provider.
 */
export function foldMatcherHint(hint: string | null | undefined): string | null {
  const folded = hint?.trim().toLowerCase();
  return folded === undefined || folded === "" ? null : folded;
}

/**
 * A hint as it is STORED. Trimmed, blank collapsed to `null`, casing KEPT.
 *
 * The casing survives because the hint is shown back to the user on the
 * wallet's chips ("Catches: GCash · GSave"), and lower-casing their sub-account
 * name in the UI to satisfy a comparison rule would be the tail wagging the dog.
 * Comparison folds; storage does not.
 */
export function storedMatcherHint(hint: string | null | undefined): string | null {
  const trimmed = hint?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/**
 * The matcher rows that make a wallet catch one provider.
 *
 * ONE ROW PER PACKAGE, because `claimingMatchers` in the Normalizer filters on
 * `provider.packageNames.includes(matcher.packageName)` — a provider whose
 * second package has no row simply catches nothing from that app. The SMS relay
 * ships three (Google Messages, Samsung Messages, AOSP MMS) and a user who
 * switched SMS apps would otherwise silently stop being tracked.
 *
 * The hint is the same on all of them: it discriminates a SUB-ACCOUNT, and a
 * sub-account does not change depending on which app posted the notification.
 */
export function matchersForProvider(
  provider: ProviderRuleset,
  hint: string | null | undefined,
): NewWalletMatcher[] {
  const stored = storedMatcherHint(hint);
  return provider.packageNames.map((packageName) => ({ packageName, hint: stored }));
}

/**
 * Stored rows read back as a picker selection: `providerKey → hint` (`""` for a
 * provider-wide row, which is what an empty text field holds).
 *
 * A provider counts as selected when ANY of its packages has a row — the
 * inverse of `matchersForProvider`, and tolerant of a row the ruleset has since
 * dropped from a provider's package list.
 *
 * ONE HINT PER PROVIDER PER WALLET. The data model would permit a single wallet
 * to hold both a provider-wide GCash row and a GCash·GSave row, but nothing
 * sensible means that: the sub-account split exists so TWO wallets can share one
 * provider (spec §matcher management), and a wallet claiming both halves of its
 * own provider is just the provider-wide row with extra steps. The picker
 * therefore offers one hint field per provider, and this is where that shape is
 * imposed on whatever is already stored.
 *
 * A package no installed provider claims contributes nothing rather than
 * inventing an entry — the form must not offer a provider the app can no longer
 * route.
 */
export function selectedHintByProvider(
  providers: readonly ProviderRuleset[],
  matchers: readonly (NewWalletMatcher | WalletMatcher)[],
): Map<string, string> {
  const selection = new Map<string, string>();

  for (const matcher of matchers) {
    const provider = providers.find((candidate) =>
      candidate.packageNames.includes(matcher.packageName),
    );
    if (provider === undefined) continue;
    if (selection.has(provider.providerKey)) continue;
    selection.set(provider.providerKey, storedMatcherHint(matcher.hint) ?? "");
  }

  return selection;
}

/** One stored matcher plus the name of the wallet holding it — the picker's warning copy. */
export type MatcherOwner = {
  packageName: string;
  hint: string | null;
  walletId: string;
  walletName: string;
};

/**
 * Stored matcher rows joined to the wallets holding them — the picker's input
 * for its move warning.
 *
 * A row whose wallet is gone is DROPPED rather than shown with a blank name. It
 * can only be a leftover the schema's foreign key should have prevented, and a
 * warning reading "already catches this" with no wallet named would be worse
 * than no warning at all: the user cannot act on it and cannot tell whether it
 * is real.
 *
 * ARCHIVED WALLETS ARE KEPT. Their matchers are suspended, not deleted, and
 * `setMatchers` would move the pair off them exactly as it would off a live
 * wallet — so the user is owed the same warning. Unarchiving afterwards and
 * finding the provider silently reassigned is the failure this prevents.
 */
export function ownersFrom(
  matchers: readonly WalletMatcher[],
  wallets: readonly { id: string; name: string }[],
): MatcherOwner[] {
  const owners: MatcherOwner[] = [];

  for (const matcher of matchers) {
    const wallet = wallets.find((candidate) => candidate.id === matcher.walletId);
    if (wallet === undefined) continue;
    owners.push({
      packageName: matcher.packageName,
      hint: matcher.hint,
      walletId: matcher.walletId,
      walletName: wallet.name,
    });
  }

  return owners;
}

/**
 * The wallet already holding `(provider, hint)`, or `null`.
 *
 * This is the question the reassignment warning asks, and the reason it is an
 * EXACT-PAIR question rather than the Normalizer's precedence walk: a NEW hint
 * on an already-claimed provider is the GCash-main-vs-GSave arrangement the
 * spec wants, not a conflict. Warning there would talk the user out of the one
 * setup that keeps their savings out of their spending money.
 *
 * `exceptWalletId` is the wallet being edited. Without it, re-saving a form
 * without touching the matchers would warn that the wallet is about to steal its
 * own rows from itself.
 */
export function ownerOfPair(
  owners: readonly MatcherOwner[],
  provider: ProviderRuleset,
  hint: string | null | undefined,
  exceptWalletId?: string,
): MatcherOwner | null {
  const folded = foldMatcherHint(hint);

  return (
    owners.find(
      (owner) =>
        owner.walletId !== exceptWalletId &&
        provider.packageNames.includes(owner.packageName) &&
        foldMatcherHint(owner.hint) === folded,
    ) ?? null
  );
}
