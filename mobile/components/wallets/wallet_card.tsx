// components/wallets/wallet_card.tsx — m1c plan Task 4, restyled by
// mobile-ui-revamp Part 2 Task 5 (docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md
// §5.3): a leading `ProviderBadge`, a listening/manual status line, a
// right-aligned last-seen caption, and the drift badge inline in the card.
//
// PRESENTATIONAL — it takes its drift and its tolerance as props rather than
// reading them itself. The screen owns the queries (one drift per wallet, one
// ruleset + matcher read for the whole list), which keeps this component
// testable with no database and no QueryClient, and keeps the tolerance read
// in one place instead of once per row.
//
// `providerKey` IS A PROP, NOT SOMETHING THIS FILE RESOLVES. `Wallet` carries
// no provider field — a wallet's provider is derived through its
// `WalletMatcher` rows (see types/domain.ts and constants/providers.ts's
// `providerKeyForPackage`), and that resolution needs `useAllWalletMatchers()`
// and the installed ruleset, both of which belong to the screen's query layer
// for the same reason `drift` and `toleranceCentavos` already do.
//
// A CREDIT WALLET'S BALANCE IS LABELLED "Owed". Rule 23: it is the outstanding
// amount, not spendable money. The label is the row's half of that rule;
// `lib/wallets/summary.ts` keeping it out of the total is the other half, and
// both are needed — a labelled row inside an inflated total still lies.
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { formatCentavos } from "@/components/ui/amount_text";
import { ProviderBadge } from "@/components/ui/provider_badge";
import type { BalanceDrift } from "@/hooks/queries/use_balance_drift";
import { addDaysIso, toDateIso } from "@/lib/dates";
import { MONTHS } from "@/lib/datetime";
import type { Centavos, EpochMs, Wallet } from "@/types/domain";

import { BalanceMismatchBadge } from "./balance_mismatch_badge";
import { WalletIcon } from "./wallet_icon";

export type WalletCardProps = {
  wallet: Wallet;
  /** `null` = this wallet has never reported a balance. See the badge. */
  drift: BalanceDrift | null | undefined;
  /** The ruleset's `balanceDriftToleranceCentavos`; `undefined` until loaded. */
  toleranceCentavos: Centavos | undefined;
  /**
   * The provider this wallet's matchers resolve to, or `null`/`undefined` for
   * a wallet with no matcher at all (Cash, or any manual wallet) — see the
   * file header. `null` and `undefined` are treated identically: both render
   * `WalletTypeIcon` rather than a badge, because a grey fallback badge on a
   * cash wallet implies a provider that does not exist.
   */
  providerKey?: string | null;
  /**
   * The instant "last seen" is measured against. A PROP, not read internally
   * via `Date.now()`, for the same reason `toleranceCentavos` is one — it lets
   * a test pin an exact "2 min ago" instead of racing the real clock. Defaults
   * to the real time because every production render wants exactly that.
   */
  nowMs?: EpochMs;
  onPress?: () => void;
  testID?: string;
};

/**
 * The second line, or nothing.
 *
 * Archived wins over "Owed" when both apply: an archived wallet is out of every
 * total and every picker, which is the more important thing to know about the
 * row in front of you. Both win over the new listening/manual status line
 * below — an archived or credit wallet states ITS OWN fact here, which matters
 * more than whether it happens to have a provider.
 */
function subtitleFor(wallet: Wallet): string | undefined {
  if (wallet.isArchived) return "Archived";
  if (wallet.owedBalance) return "Owed";
  return undefined;
}

/**
 * "2 min ago" / "yesterday" / "Aug 1" — the right column's recency caption for
 * a provider-tracked wallet.
 *
 * SOURCED FROM `wallet.updatedAt`, NOT A NEW QUERY. Every write that snaps a
 * wallet's balance — `insertTransaction`, `updateTransaction`,
 * `deleteTransaction`, transfer reassignment (lib/db/repos/transactions_repo.ts)
 * — already bumps `updated_at` in the same statement, so the field already IS
 * "the last time this wallet had a balance-affecting commit" with no new
 * repository surface needed.
 *
 * CALENDAR-DAY COMPARISON, NOT A RAW MILLISECOND DELTA, for "today" and
 * "yesterday" — built from `toDateIso`/`addDaysIso` (lib/dates.ts, already
 * tested on their own) rather than `< 86_400_000`, so "yesterday" means the
 * previous CALENDAR day even for an update at 11:58pm, not "within the last
 * 24 hours".
 */
function formatLastActivity(updatedAtMs: EpochMs, nowMs: EpochMs): string {
  const todayIso = toDateIso(new Date(nowMs));
  const updatedIso = toDateIso(new Date(updatedAtMs));

  if (updatedIso === todayIso) {
    const diffMs = Math.max(0, nowMs - updatedAtMs);
    if (diffMs < 60_000) return "just now";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} min ago`;
    return `${Math.floor(diffMs / 3_600_000)} hr ago`;
  }
  if (addDaysIso(updatedIso, 1) === todayIso) return "yesterday";

  const updated = new Date(updatedAtMs);
  return `${MONTHS[updated.getMonth()]} ${updated.getDate()}`;
}

/**
 * The status line's leading dot + text for an active, non-credit wallet — the
 * one branch `subtitleFor` leaves undefined.
 *
 * NO TRANSACTION COUNT. The design board's illustrative copy reads "Listening
 * · 12 txns this period" on one row and "Listening · 4 txns" (no period at
 * all) on the very next — an inconsistency that marks it as placeholder
 * flavour text, not a specified figure. The SPEC text this task actually
 * answers to (§5.3: "Rows gain ProviderBadge, listening state and last-seen")
 * asks for a STATE, not a count. A per-wallet, period-scoped transaction count
 * would need a new query (this screen currently reads wallets, matchers, the
 * ruleset and one drift per wallet — nothing period-scoped), a decision about
 * what "this period" even means for a Wallet (Limits define a period; Wallets
 * do not), and a new local-day boundary computation in the one area of this
 * revamp that has already produced a silent-wrong-value bug once (Part 2 Task
 * 1's `date(occurred_at, 'localtime')`, see progress.md). "Listening" alone is
 * a true, verifiable claim; a fabricated or mis-scoped count would not be.
 */
function ListeningLine(): ReactNode {
  return (
    <View className="mt-0.5 flex-row items-center gap-1.5">
      <View className="h-1.5 w-1.5 rounded-full bg-brand dark:bg-brand-dark" />
      <Text numberOfLines={1} className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
        Listening
      </Text>
    </View>
  );
}

export function WalletCard({
  wallet,
  drift,
  toleranceCentavos,
  providerKey,
  nowMs = Date.now(),
  onPress,
  testID,
}: WalletCardProps) {
  const rowTestID = testID ?? `wallet-card-${wallet.id}`;
  const hasProvider = providerKey !== null && providerKey !== undefined && providerKey !== "";

  const subtitle = subtitleFor(wallet);
  // The accessibility label is computed from `subtitle` ALONE, unchanged from
  // before this task — it is what `wallets_screen.test.tsx`'s
  // "labels the row itself" assertion pins, and the new listening/manual line
  // is supplementary visual detail, not a replacement for that contract.
  const rowLabel = subtitle ? `${wallet.name}, ${subtitle}` : wallet.name;

  let statusLine: ReactNode;
  if (subtitle) {
    statusLine = (
      <Text numberOfLines={1} className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
        {subtitle}
      </Text>
    );
  } else if (hasProvider) {
    statusLine = <ListeningLine />;
  } else {
    statusLine = (
      <Text numberOfLines={1} className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
        Manual · reconcile weekly
      </Text>
    );
  }

  // Suppressed once archived: a retired wallet has no upcoming reconcile and
  // its last commit is already spoken for by the "Archived" status line, so a
  // recency caption or a "Reconcile" prompt beside it would imply an action
  // this row does not offer.
  let captionLine: ReactNode = null;
  if (!wallet.isArchived) {
    captionLine = hasProvider ? (
      <Text numberOfLines={1} className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
        {formatLastActivity(wallet.updatedAt, nowMs)}
      </Text>
    ) : (
      <Text numberOfLines={1} className="text-micro font-semibold text-brand dark:text-brand-dark">
        Reconcile
      </Text>
    );
  }

  const rowBody = (
    <View className="min-h-[44px] flex-row items-center gap-3 px-4 py-3">
      {hasProvider ? (
        <ProviderBadge testID={`wallet-badge-${providerKey}`} providerKey={providerKey as string} size={32} />
      ) : (
        // No matcher, no provider: the wallet glyph, never a grey provider
        // fallback badge — a coloured initial square here would claim a
        // company identity this wallet does not have (any manual wallet).
        <View
          className="items-center justify-center rounded-xl bg-brand-soft dark:bg-brand-soft-dark"
          style={{ width: 32, height: 32 }}
        >
          <WalletIcon
            wallet={wallet}
            testID={`${rowTestID}-icon`}
            size={18}
            className="text-brand dark:text-brand-dark"
          />
        </View>
      )}

      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-row font-semibold text-fg dark:text-fg-dark">
          {wallet.name}
        </Text>
        {statusLine}
      </View>

      <View className="items-end">
        {/* `formatCentavos` rendered directly rather than nested inside
            `AmountText` — AmountText sets its own colour and size
            unconditionally with no override prop, so nesting it here would
            silently discard `text-row font-bold` (see mobile-ui-revamp's
            hero/StatTile finding: the parent's styling never reaches the
            glyphs, and the test still passes because it reads the right
            text). */}
        <Text
          testID={`${rowTestID}-balance`}
          numberOfLines={1}
          style={{ fontVariant: ["tabular-nums"] }}
          className="text-row font-bold text-fg dark:text-fg-dark"
        >
          {formatCentavos(wallet.balance)}
        </Text>
        {captionLine}
      </View>
    </View>
  );

  return (
    <View className="px-4 pb-3">
      <Card>
        {onPress ? (
          <Pressable
            testID={rowTestID}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={rowLabel}
          >
            {rowBody}
          </Pressable>
        ) : (
          <View testID={rowTestID}>{rowBody}</View>
        )}
        {/* Inline within the same card as the row, not a separately-fenced
            section (spec §5.3: "the mismatch badge moves inline"). Edit and
            archive actions are m1c Task 5's — each needs a flow this task
            does not build, and a button that opens nothing is worse than no
            button. */}
        <BalanceMismatchBadge
          testID={`${rowTestID}-drift`}
          drift={drift}
          toleranceCentavos={toleranceCentavos}
        />
      </Card>
    </View>
  );
}
