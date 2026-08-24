// lib/wallets/summary.ts — how the Wallets tab orders, labels and totals a
// list of wallets (m1c plan Task 4 rule 1; docs/04-features/02-wallets.md).
//
// PURE, AND DELIBERATELY NOT INLINE IN THE SCREEN. The total at the top of the
// Wallets tab is the first figure the app states that the user did not type,
// and rule 23 excludes credit wallets from it because a credit balance is
// money OWED, not money held. An inline `wallets.reduce((n, w) => n + w.balance)`
// in JSX is one keystroke away from being right and impossible to test
// exhaustively; here it is a function with its own suite.
import type { Centavos, Wallet, WalletType } from "@/types/domain";

/**
 * Display order for the type groups (plan rule 1) — NOT the declaration order
 * of `WalletType`, and not alphabetical.
 *
 * It runs from the accounts a salary lands in down to the ones a user touches
 * by hand, with credit second-to-last: what you owe reads after what you have,
 * and cash — the only type the app cannot track automatically — reads last.
 */
export const WALLET_TYPE_ORDER: readonly WalletType[] = [
  "bank",
  "e-wallet",
  "savings",
  "credit",
  "cash",
];

/**
 * Section headings. The credit heading carries "amounts owed" because that is
 * where the distinction can be made once for a whole group instead of being
 * repeated (and possibly missed) on every row.
 */
export const WALLET_TYPE_LABELS: Record<WalletType, string> = {
  bank: "Bank",
  "e-wallet": "E-wallet",
  savings: "Savings",
  credit: "Credit — amounts owed",
  cash: "Cash",
};

export type WalletGroup = { type: WalletType; wallets: Wallet[] };

/**
 * Active wallets, grouped by type in `WALLET_TYPE_ORDER`, with empty groups
 * omitted and the caller's order preserved inside each group (the repository
 * already returns oldest-first).
 *
 * Archived wallets are LEFT OUT entirely: they belong to the collapsed
 * "Archived" section at the bottom of the list (docs/04 §UX states), not
 * mixed into the type groups where their balances would read as live money.
 */
export function groupWalletsByType(wallets: readonly Wallet[]): WalletGroup[] {
  const active = wallets.filter((wallet) => !wallet.isArchived);
  return WALLET_TYPE_ORDER.map((type) => ({
    type,
    wallets: active.filter((wallet) => wallet.type === type),
  })).filter((group) => group.wallets.length > 0);
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
 *   CREDIT (rule 23). A credit wallet's balance is the outstanding amount
 *   owed. Adding it inflates the headline number of a budgeting app by the
 *   size of the user's debt — the single most damaging number this app can
 *   get wrong, on the first screen it shows. Credit balances are displayed on
 *   their own rows, labelled as owed; they are never summed into this.
 *
 *   ARCHIVED (rule 17). An archived wallet's balance leaves the Wallets-tab
 *   total and all Safe-to-Spend maths. It stays out even while the "Show
 *   archived" toggle is putting those rows back on screen — the toggle changes
 *   what is VISIBLE, never what is counted.
 */
export function totalActiveBalance(wallets: readonly Wallet[]): Centavos {
  return wallets
    .filter((wallet) => !wallet.isArchived && wallet.type !== "credit")
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
 * inline with only the archived exclusion, so a non-archived credit wallet
 * was counted here while the same wallet's balance was excluded two lines
 * below. Sharing this one filter is what makes that drift impossible instead
 * of merely unlikely, the identical argument this file's header already
 * makes for keeping `totalActiveBalance` itself out of the screen.
 */
export function totalActiveWalletCount(wallets: readonly Wallet[]): number {
  return wallets.filter((wallet) => !wallet.isArchived && wallet.type !== "credit").length;
}
