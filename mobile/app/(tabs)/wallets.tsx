// app/(tabs)/wallets.tsx — the Wallets tab (m1c plan Task 4;
// docs/04-features/02-wallets.md; docs/06-information-architecture.md §3.3).
// Restyled by mobile-ui-revamp Part 2 Task 5
// (docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md §5.3): a
// `ShareBar` on the total card and a resolved provider per row.
//
// The first real screen in the app — everything before it was infrastructure —
// and the first place the app states a number the user did not type. That
// number is the total row, and rule 23 keeps OWED wallets out of it: an owed
// balance is money the user does not have, and adding it inflates the headline
// figure of a budgeting app by the size of their debt. The arithmetic lives in
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
import { Fab } from "@/components/ui/fab";
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
  splitByOwed,
  totalActiveBalance,
  totalActiveWalletCount,
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
   * both render `WalletIcon` in `WalletCard` rather than a badge.
   */
  function providerKeyForWallet(walletId: string): string | null {
    const packageName = (matchers ?? []).find((matcher) => matcher.walletId === walletId)
      ?.packageName;
    if (packageName === undefined) return null;
    return providerKeyForPackage(ruleset?.providers ?? [], packageName);
  }

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

  /**
   * Everything on this screen that depends on the data — and only that. It is
   * split into its own function so the floating add button in the return
   * statement below can sit OUTSIDE all three of its outcomes (still loading,
   * no wallets, some wallets) instead of being repeated inside each one. That
   * independence is the entire point of the button; see the return statement.
   *
   * The background colour moved to that wrapper for the same reason, so the
   * three branches here no longer each carry their own `bg-bg dark:bg-bg-dark`.
   */
  function renderBody() {
    // Render nothing until the list has actually loaded. An empty state that
    // flashes on every cold start reads as data loss on a screen whose whole job
    // is to be trusted about money.
    if (!wallets) {
      return (
        <View testID="wallets-loading" className="flex-1">
          <LoadingSkeleton rows={6} />
        </View>
      );
    }

    if (wallets.length === 0) {
      return (
        <View className="flex-1 justify-center">
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
              inventing new wording for the same destination.
              It STAYS even though the floating button now covers this state
              too: the empty state's job is to say which wallet to add first,
              and an empty screen whose only affordance is a 56dp glyph in the
              corner makes the user hunt for it. Transactions' ledger keeps
              both for the same reason (its `onAddManual` alongside its Fab). */}
          <EmptyState
            testID="wallets-empty"
            title="Add your first Wallet"
            body="Start with the bank or e-wallet you use most."
            action={{ label: "Add wallet", onPress: () => router.push("/wallet/new") }}
          />
        </View>
      );
    }

    const { held, owed } = splitByOwed(wallets);
    const archived = archivedWallets(wallets);
    // The toggle changes what is VISIBLE, never what is counted (rule 17, the
    // same principle `totalActiveBalance` already applies to the peso figure
    // above it) — so this counts the CURRENT list regardless of whether
    // `showArchived` has widened it, rather than reading `wallets.length`
    // directly. `totalActiveWalletCount` shares `totalActiveBalance`'s exact
    // filter (non-archived, non-credit), so this label and the total it sits
    // above can no longer disagree about which wallets compose "the total".
    const activeWalletCount = totalActiveWalletCount(wallets);

    return (
      <ScrollView testID="wallets-screen" className="flex-1">
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
                      (wallet) => !wallet.isArchived && !wallet.owedBalance && wallet.balance > 0,
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
                  Balances you owe are not counted here.
                </Text>
              </View>
            </Card>
          </View>

          {/* ONE LIST, NOT FIVE SECTIONS. This used to render a heading per
              wallet type — Bank, E-wallet, Savings, Credit, Cash — off a
              taxonomy the user was made to choose during onboarding. Only one
              of those divisions ever changed a number, and it is the one kept
              below: what you have, and what you owe. */}
          {held.map(renderCard)}

          {/* Rule 23 on screen rather than only in the maths: these balances
              are money OWED, and they are excluded from the total above. The
              heading is what makes that exclusion legible instead of looking
              like an arithmetic error. */}
          {owed.length > 0 ? (
            <View testID="wallets-owed-section">
              <SectionHeader title="Money you owe" />
              {owed.map(renderCard)}
            </View>
          ) : null}

          {/* Rule 5: archived wallets are hidden by default and collapse into
              their own group at the bottom — never mixed into the live lists,
              where their balances would read as current money. They stay out of
              the total either way (rule 17). */}
          {archived.length > 0 ? (
            <View testID="wallets-archived-section">
              <SectionHeader title="Deleted" />
              {archived.map(renderCard)}
            </View>
          ) : null}

          <View className="items-center px-4 pt-2">
            <Button
              testID="wallets-archived-toggle"
              title={showArchived ? "Hide deleted" : "Show deleted"}
              variant="ghost"
              onPress={() => setShowArchived((shown) => !shown)}
            />
          </View>

          {/* Clears the floating add button on short devices — the same spacer
              app/(tabs)/transactions.tsx keeps under its ledger, so the last
              wallet card and the "Show deleted" toggle stay tappable rather
              than sitting under 56dp of button. */}
          <View className="h-16" />
        </View>
      </ScrollView>
    );
  }

  return (
    // WALLET CREATION'S ONE DURABLE ENTRY POINT (docs/04-features/02-wallets.md
    // §"Add a Wallet" step 1 — "From the Wallets tab, 'Add Wallet'" — and
    // docs/06-information-architecture.md §3.3's `W --> WADD` edge).
    //
    // It previously existed ONLY inside the empty state, so it vanished the
    // moment the first wallet appeared — and onboarding creates wallets, which
    // means most users never saw it at all. After that the only route to
    // app/wallet/new.tsx was the goal flow's incidental `onCreateWallet` hop
    // (app/(tabs)/plan/goals/new.tsx): wallet creation reachable only by
    // starting a savings goal. Identical defect, identical fix, to the one
    // transactions.tsx's floating button exists for — the affordance renders
    // whether the list is empty, full, or still loading, precisely because it
    // must not depend on the data it is there to create.
    //
    // THE FREE-TIER CAP IS NOT CHECKED HERE. app/wallet/new.tsx owns that
    // question (spec §Free vs Plus: "Entitlements is checked at this
    // call-site") and answers it with an upgrade sheet on submit. Hiding or
    // disabling this button at three wallets would state the limit by making
    // the app look broken instead of by explaining it.
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      {renderBody()}
      <View className="absolute bottom-6 right-6">
        <Fab
          testID="wallets-add"
          onPress={() => router.push("/wallet/new")}
          accessibilityLabel="Add a wallet"
        />
      </View>
    </View>
  );
}
