// app/(tabs)/wallets.tsx — the Wallets tab (m1c plan Task 4;
// docs/04-features/02-wallets.md; docs/06-information-architecture.md §3.3).
// Restyled by mobile-ui-revamp Part 2 Task 5
// (docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md §5.3): a
// `ShareBar` on the total card and a resolved provider per row.
//
// The first real screen in the app — everything before it was infrastructure —
// and the first place the app states a number the user did not type. That
// number is the total row, and rule 23 keeps credit wallets OUT of it: a credit
// balance is money owed, and adding it inflates the headline figure of a
// budgeting app by the size of the user's debt. The arithmetic lives in
// lib/wallets/summary.ts, tested on its own; this file only lays it out.
//
// Four reads, each thin (Global Constraints: components consume hooks, hooks
// call repositories, no SQL here):
//   useWallets({ includeArchived })  the list, keyed BY the toggle
//   useRuleset()                     the drift tolerance and provider catalogue
//   useBalanceDrifts(ids)            one reported-vs-computed pair per wallet
//   useAllWalletMatchers()           every matcher, to derive each row's provider
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { SectionHeader } from "@/components/ui/section_header";
import { ShareBar } from "@/components/ui/share_bar";
import { WalletCard } from "@/components/wallets/wallet_card";
import { palette } from "@/constants/colors";
import { providerBadge, providerKeyForPackage } from "@/constants/providers";
import { useTheme } from "@/contexts/theme_context";
import { useAllWalletMatchers } from "@/hooks/queries/use_all_wallet_matchers";
import { useBalanceDrifts } from "@/hooks/queries/use_balance_drift";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import { systemClock } from "@/lib/clock";
import {
  archivedWallets,
  groupWalletsByType,
  totalActiveBalance,
  WALLET_TYPE_LABELS,
} from "@/lib/wallets/summary";
import type { Wallet } from "@/types/domain";

export default function WalletsScreen() {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);

  const { data: wallets } = useWallets({ includeArchived: showArchived });
  const { data: ruleset } = useRuleset();
  // Read from the ruleset, never inlined: docs/04 §14 open question 1 lists the
  // threshold's value as unsettled, so it ships as remotely-retunable data.
  // `undefined` until it loads, which the badge renders as no verdict at all.
  const toleranceCentavos = ruleset?.tunables.balanceDriftToleranceCentavos;
  const drifts = useBalanceDrifts((wallets ?? []).map((wallet) => wallet.id));
  const { data: matchers } = useAllWalletMatchers();
  // A raw hex, not a className: `ShareBar` and `ProviderBadge` both take
  // colour as a VALUE (constants/providers.ts identity, never a status
  // token), so the one non-provider swatch this screen supplies — Cash's own
  // brand-green "identity" — has to resolve to a literal hex here too, the
  // same way components/reports/donut_chart.tsx already resolves its raw SVG
  // fill colours from `useTheme()` rather than a `dark:` className.
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  const nowMs = systemClock.now();

  /**
   * A wallet's provider, derived rather than stored (`Wallet` carries no
   * provider field — types/domain.ts). Takes the FIRST matcher row for this
   * wallet, per docs/superpowers/sdd's task-5 correction: a wallet can in
   * principle hold more than one matcher, but the row only has room for one
   * badge, and `created_at` ordering (`listMatchers`) makes "first" the
   * oldest — the pair the wallet was originally set up with.
   *
   * `null` for a wallet with no matcher at all (Cash, manual wallets) AND for
   * a wallet whose one matcher's package resolves to nothing recognisable —
   * both render `WalletTypeIcon` in `WalletCard` rather than a badge.
   */
  function providerKeyForWallet(walletId: string): string | null {
    const packageName = (matchers ?? []).find((matcher) => matcher.walletId === walletId)
      ?.packageName;
    if (packageName === undefined) return null;
    return providerKeyForPackage(ruleset?.providers ?? [], packageName);
  }

  // Render nothing until the list has actually loaded. An empty state that
  // flashes on every cold start reads as data loss on a screen whose whole job
  // is to be trusted about money.
  if (!wallets) {
    return (
      <View testID="wallets-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={6} />
      </View>
    );
  }

  if (wallets.length === 0) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        {/* Title is the SPEC's string (docs/04-features/02-wallets.md, UX-states
            table), not the plan's. Global Constraints: "Where this plan and a
            spec disagree, the spec wins" — and they disagree here. The plan's
            wording survives as the body, because it says the one useful thing
            the spec's does not: WHICH wallet to add first.
            The "Add wallet" action used to be commented out here because
            app/wallet/new.tsx did not exist yet (Task 5 hadn't landed) — a
            button here would have opened nothing. That route exists now, so
            the empty state gets the same action the populated view's flows
            already use (transaction/new.tsx, plan/goals/new.tsx): a plain
            `router.push("/wallet/new")`, labelled "Add wallet" to match
            app/wallet/new.tsx's own submit button (task-3-brief) rather than
            inventing new wording for the same destination. */}
        <EmptyState
          testID="wallets-empty"
          title="Add your first Wallet"
          body="Start with the bank or e-wallet you use most."
          action={{ label: "Add wallet", onPress: () => router.push("/wallet/new") }}
        />
      </View>
    );
  }

  const groups = groupWalletsByType(wallets);
  const archived = archivedWallets(wallets);
  // The toggle changes what is VISIBLE, never what is counted (rule 17, the
  // same principle `totalActiveBalance` already applies to the peso figure
  // above it) — so this counts non-archived wallets out of the CURRENT list
  // regardless of whether `showArchived` has widened it, rather than reading
  // `wallets.length` directly.
  const activeWalletCount = wallets.filter((wallet) => !wallet.isArchived).length;

  function openWallet(wallet: Wallet): void {
    router.push({ pathname: "/wallet/[id]", params: { id: wallet.id } });
  }

  function renderCard(wallet: Wallet) {
    return (
      <WalletCard
        key={wallet.id}
        wallet={wallet}
        drift={drifts[wallet.id]}
        toleranceCentavos={toleranceCentavos}
        providerKey={providerKeyForWallet(wallet.id)}
        nowMs={nowMs}
        onPress={() => openWallet(wallet)}
      />
    );
  }

  return (
    <ScrollView testID="wallets-screen" className="flex-1 bg-bg dark:bg-bg-dark">
      {/* Padding on an inner View rather than `contentContainerClassName` —
          the same shape components/onboarding/phrase_display.tsx uses. */}
      <View className="pb-8 pt-4">
        <View className="px-4 pb-2">
          <Card>
            <View testID="wallets-total" className="gap-1">
              <Text className="text-sm text-fg-2 dark:text-fg-2-dark">
                {`Total across ${activeWalletCount} wallets`}
              </Text>
              <AmountText
                testID="wallets-total-amount"
                amount={totalActiveBalance(wallets)}
                size="hero"
                showSign={false}
              />
              <ShareBar
                testID="wallets-share"
                shares={wallets
                  // Same two exclusions as the peso figure just above it
                  // (lib/wallets/summary.ts's `totalActiveBalance`): archived
                  // wallets are out of every total, and a credit wallet's
                  // balance is money OWED, not held. A share bar is a visual
                  // breakdown of THAT figure — including either one here would
                  // draw a bar whose segments do not sum to the number it sits
                  // under, which is a subtler version of the exact overstatement
                  // rule 23 exists to prevent. Zero-balance wallets are dropped
                  // too: a wallet contributing nothing to the total draws no
                  // segment either way, and `ShareBar` itself renders nothing at
                  // all once every remaining share is filtered out (`total <= 0`).
                  .filter(
                    (wallet) =>
                      !wallet.isArchived && wallet.type !== "credit" && wallet.balance > 0,
                  )
                  .map((wallet) => {
                    const providerKey = providerKeyForWallet(wallet.id);
                    return {
                      id: wallet.id,
                      label: wallet.name,
                      value: wallet.balance,
                      // A resolved provider's own colour, or — for a wallet
                      // with no provider at all (Cash, manual) — the app's own
                      // brand green rather than the grey "unidentified
                      // provider" fallback: `wallet_detail.tsx`'s no-provider
                      // fill uses the same `bg-brand` identity (task-5b brief,
                      // "A wallet with no provider (Cash) fills bg-brand
                      // instead"), and the design board's own Cash segment is
                      // literally `var(--gr)`, not the grey used for an
                      // unrecognised package.
                      color: providerKey
                        ? providerBadge(providerKey).color
                        : palette[dark ? "brand-dark" : "brand"],
                    };
                  })}
              />
              <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
                Credit balances are money you owe, so they are not counted here.
              </Text>
            </View>
          </Card>
        </View>

        {groups.map((group) => (
          <View key={group.type}>
            <SectionHeader
              testID={`wallet-group-${group.type}`}
              title={WALLET_TYPE_LABELS[group.type]}
            />
            {group.wallets.map(renderCard)}
          </View>
        ))}

        {/* Rule 5: archived wallets are hidden by default and collapse into
            their own group at the bottom — never mixed into the type sections,
            where their balances would read as live money. They stay out of the
            total either way (rule 17). */}
        {archived.length > 0 ? (
          <View testID="wallets-archived-section">
            <SectionHeader title="Archived" />
            {archived.map(renderCard)}
          </View>
        ) : null}

        <View className="items-center px-4 pt-2">
          <Button
            testID="wallets-archived-toggle"
            title={showArchived ? "Hide archived" : "Show archived"}
            variant="ghost"
            onPress={() => setShowArchived((shown) => !shown)}
          />
        </View>
      </View>
    </ScrollView>
  );
}
