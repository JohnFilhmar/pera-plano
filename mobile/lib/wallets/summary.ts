// lib/wallets/summary.ts — how the Wallets tab splits, labels and totals a list
// of wallets (m1c plan Task 4 rule 1; docs/04-features/02-wallets.md).
//
// PURE, AND DELIBERATELY NOT INLINE IN THE SCREEN. The total at the top of the
// Wallets tab is the first figure the app states that the user did not type,
// and rule 23 keeps owed balances out of it because an owed balance is money
// OWED, not money held. An inline `wallets.reduce((n, w) => n + w.balance)` in
// JSX is one keystroke away from being right and impossible to test
// exhaustively; here it is a function with its own suite.
//
// WHAT THE TYPE GROUPS BECAME. This file used to group wallets into bank /
// e-wallet / savings / credit / cash sections, ordered by a hand-written
// `WALLET_TYPE_ORDER`. That taxonomy is gone: onboarding no longer asks for it,
// and of the five values only "credit" ever changed a number. What is left is
// the distinction that actually matters to a total — held or owed — plus a
// derived "nothing routes here" that stands in for what cash meant.
import type { Centavos, Wallet } from "@/types/domain";

/** The Wallets tab's two lists. */
export type OwedSplit = { held: Wallet[]; owed: Wallet[] };

/**
 * Active wallets, split into what the user HAS and what they OWE, each in the
 * order given (the repository already returns oldest-first).
 *
 * ARCHIVED WALLETS ARE IN NEITHER. They belong to the collapsed "Archived"
 * section at the bottom of the list (docs/04 §UX states), not mixed into live
 * money where their balances would read as current.
 */
export function splitByOwed(wallets: readonly Wallet[]): OwedSplit {
  const active = wallets.filter((wallet) => !wallet.isArchived);
  return {
    held: active.filter((wallet) => !wallet.owedBalance),
    owed: active.filter((wallet) => wallet.owedBalance),
  };
}

/**
 * Nothing routes to this wallet, so nothing can track it automatically — which
 * is exactly what `type: "cash"` meant before the app stopped asking. It is
 * what makes the reconcile sheet available, what puts a wallet first in the
 * manual-entry picker, and what the "you'll need to add these yourself" copy
 * is about.
 *
 * DERIVED, NOT STORED, and the difference is load-bearing: a wallet whose last
 * matcher is removed becomes manual THE MOMENT IT DOES. A stored flag would
 * need something to notice and update it, and until that something ran the app
 * would be offering automatic tracking for a wallet no notification can reach.
 */
export function isManualOnly(wallet: Wallet): boolean {
  return wallet.matcherCount === 0;
}

/**
 * The three states a wallet can be in, once the type enum is gone.
 *
 * OWED OUTRANKS MANUAL, and the order matters for a hand-tracked credit card:
 * "you owe this" changes what the balance MEANS, while "nothing routes here"
 * only says how it gets updated. Where one word has to stand for the wallet —
 * an icon, a CSV column — it should be the one that changes the reading.
 */
export type WalletKind = "owed" | "manual" | "tracked";

export function walletKind(wallet: Wallet): WalletKind {
  if (wallet.owedBalance) return "owed";
  if (isManualOnly(wallet)) return "manual";
  return "tracked";
}

/** The archived tail, in the order given. Empty unless the caller asked the
 * repository for `includeArchived`. */
export function archivedWallets(wallets: readonly Wallet[]): Wallet[] {
  return wallets.filter((wallet) => wallet.isArchived);
}

/**
 * The figure at the top of the Wallets tab: what the user actually HAS.
 *
 * TWO EXCLUSIONS, BOTH FROM THE SPEC, AND BOTH ONE-WAY:
 *
 *   OWED (rule 23). An owed wallet's balance is the outstanding amount owed.
 *   Adding it inflates the headline number of a budgeting app by the size of
 *   the user's debt — the single most damaging number this app can get wrong,
 *   on the first screen it shows. Owed balances are displayed on their own
 *   rows, under their own heading; they are never summed into this.
 *
 *   ARCHIVED (rule 17). An archived wallet's balance leaves the Wallets-tab
 *   total and all Safe-to-Spend maths. It stays out even while the "Show
 *   archived" toggle is putting those rows back on screen — the toggle changes
 *   what is VISIBLE, never what is counted.
 */
export function totalActiveBalance(wallets: readonly Wallet[]): Centavos {
  return wallets
    .filter((wallet) => !wallet.isArchived && !wallet.owedBalance)
    .reduce((total, wallet) => total + wallet.balance, 0);
}

/**
 * How many wallets make up `totalActiveBalance` — the count behind the
 * Wallets tab's "Total across N wallets" label.
 *
 * SAME TWO EXCLUSIONS AS `totalActiveBalance`, ON PURPOSE, AND FOR THE SAME
 * REASON: this label sits directly above that peso figure, so a count built
 * from a different filter silently disagrees with the total it labels. That
 * is not hypothetical — `app/(tabs)/wallets.tsx` used to compute this count
 * inline with only the archived exclusion, so a wallet excluded from the total
 * was still counted here.
 */
export function totalActiveWalletCount(wallets: readonly Wallet[]): number {
  return wallets.filter((wallet) => !wallet.isArchived && !wallet.owedBalance).length;
}
