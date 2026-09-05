// app/wallet/[id].tsx — one wallet's detail (m1c plan Task 4, rule 4).
//
// Balance header, the drift badge, the wallet's matcher chips, and its
// transactions.
//
// THE LEDGER LIST ARRIVED WITH m1c TASK 6. Rule 4 says the detail shows the
// wallet's transactions "reusing the ledger list from Task 6" — day grouping,
// category chips, transfer-leg muting, the lot — and until that task existed
// this screen carried a deliberately plain list instead, with a comment saying
// why. That placeholder is gone: there is now exactly ONE ledger implementation
// in the app, which is the point. Two of them was never a styling problem, it is
// how a transfer leg ends up muted on one screen and counted as spending on the
// other, with neither screen admitting they disagree.
//
// The screen keeps its OWN empty state (`LedgerList`'s `empty` slot): "Nothing
// tracked in this wallet yet" is a narrower and more useful statement than the
// tab-wide one, and it is true even when the rest of the ledger is full.
//
// THE ACTIONS ARRIVED WITH m1c TASK 5 (rule 4: edit, reconcile, archive), each
// behind the thing that makes it safe, and DISMISS joined them with migration
// 003. DEVICE-TESTING FIX (2026-08-18, Task 4) then split RECONCILE's non-cash
// half into its own ADJUST BALANCE action instead of widening RECONCILE, and
// gave wallets whose balance is OWED neither:
//
//   EDIT opens app/wallet/[id]/edit.tsx.
//   RECONCILE is offered ONLY for a wallet NOTHING ROUTES TO (Task 5 rule 6,
//     restated against the trait that replaced `type: "cash"`). A wallet with
//     a provider re-anchors itself from the reported balance-after; a typed
//     adjustment there would fight the next snap and lose, leaving a
//     transaction explaining a balance change that never happened. That
//     reasoning is still exactly why RECONCILE stays manual-only — it is what
//     makes ADJUST BALANCE below a separate action instead of RECONCILE
//     simply covering more wallet types.
//   ADJUST BALANCE is offered for bank, savings, and e-wallet types — never
//     cash (RECONCILE already owns that). It opens BalanceCorrectionSheet: a
//     manual starting-balance correction that writes an ordinary ledger
//     entry, deliberately NOT a reconciliation, and the sheet says so on
//     screen — including that a later provider notification carrying a
//     reported balance will re-anchor the wallet and replace this
//     correction, though the correction's own ledger row stays and keeps
//     counting toward totals. That disclosure is what makes it safe to offer
//     on a wallet a provider also writes to.
//   CREDIT WALLETS get neither RECONCILE nor ADJUST BALANCE, with an
//     on-screen note (below) explaining why instead of a silently missing
//     button. A credit balance is the amount OWED (rule 23), not held; "you
//     have more than recorded" on a credit wallet would write a
//     `direction: "in"` row — recording taking on debt as money received.
//     Excluded rather than answered wrong; getting the wording and sign
//     right for credit needs its own design pass.
//   DISMISS is the other half of balance-handling rule 3 ("record the gap as an
//     adjustment, or dismiss") and appears ONLY while the drift badge is
//     actually showing — decided by the badge's own `isDriftWorthShowing`, so a
//     button can never appear beside a badge that is not there. It names the
//     reporting transaction the user is looking at, which is what lets a NEWER
//     report raise the badge again instead of being silenced by an old tap.
//   ARCHIVE opens the sheet that asks what happens to this wallet's
//     transactions — never a bare confirm, because archiving without that
//     question is how history gets orphaned or silently relocated.
//
// THERE IS NO DELETE, and there is no route to one. Invariant 4 forbids orphan
// Transactions, the schema's NO ACTION foreign key blocks the DELETE outright,
// and `wallets_repo` exports no `deleteWallet` to call.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LedgerList } from "@/components/transactions/ledger_list";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, CHIP_HIT_SLOP } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { ProviderBadge } from "@/components/ui/provider_badge";
import { SectionHeader } from "@/components/ui/section_header";
import { ArchiveWalletSheet } from "@/components/wallets/archive_wallet_sheet";
import { BalanceCorrectionSheet } from "@/components/wallets/balance_correction_sheet";
import {
  BalanceMismatchBadge,
  isDriftWorthShowing,
} from "@/components/wallets/balance_mismatch_badge";
import { CashReconcileSheet } from "@/components/wallets/cash_reconcile_sheet";
import { MatcherChipList } from "@/components/wallets/matcher_chip_list";
import { WalletIcon } from "@/components/wallets/wallet_icon";
import { isManualOnly } from "@/lib/wallets/summary";
import { palette } from "@/constants/colors";
import { providerBadge, providerKeyForPackage } from "@/constants/providers";
import { useArchiveWallet } from "@/hooks/mutations/use_archive_wallet";
import { useUnarchiveWallet } from "@/hooks/mutations/use_unarchive_wallet";
import { useDismissDrift } from "@/hooks/mutations/use_dismiss_drift";
import { useBalanceDrift } from "@/hooks/queries/use_balance_drift";
import { useCategories } from "@/hooks/queries/use_categories";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallet } from "@/hooks/queries/use_wallet";
import { useWalletMatchers } from "@/hooks/queries/use_wallet_matchers";
import { useWallets } from "@/hooks/queries/use_wallets";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";
import { periodForScope } from "@/lib/period";
import { summarizePeriod } from "@/lib/reports/aggregate";
import { contrastRatio } from "@/lib/ui/contrast";

// ---------------------------------------------------------------------------
// The balance header's provider fill (mobile-ui-revamp Part 2 Task 5b).
// ---------------------------------------------------------------------------
//
// `PROVIDER_BADGE` colours (constants/providers.ts) were measured for a
// SINGLE WHITE LETTER at 14dp behind them — that file's own header records
// six of the thirteen already needed DARK ink at that size (gotyme 2.56,
// maya 2.62, grabpay 2.84, unionbank 3.27, seabank 3.48, shopeepay 3.66,
// white #FFFFFF measured with `contrastRatio`). A full card of white BODY
// TEXT is a stricter requirement than one small glyph, so this screen
// measures again rather than reusing that badge-ink verdict.
//
// MEASURED 2026-08-23 (task-5b), white (#FFFFFF) against every
// `PROVIDER_BADGE` colour via `contrastRatio`. The SAME six fail again — the
// underlying pair of colours has not changed, and this task's own floor is
// 4.5:1 regardless of text size (a card of body copy, not a headline, so the
// large-text 3:1 allowance does not apply):
//   gcash       9.85  PASS
//   maya        2.62  FALLBACK -> bg-brand
//   bpi         6.70  PASS
//   bdo        13.64  PASS
//   unionbank   3.27  FALLBACK -> bg-brand
//   metrobank  10.05  PASS
//   seabank     3.48  FALLBACK -> bg-brand
//   gotyme      2.56  FALLBACK -> bg-brand
//   cimb        7.50  PASS
//   landbank    6.13  PASS
//   shopeepay   3.66  FALLBACK -> bg-brand
//   grabpay     2.84  FALLBACK -> bg-brand
//   sms_relay   5.44  PASS
//
// NOT A HARDCODED LOOKUP TABLE. `fillForProvider` below recomputes this at
// render time from the live `PROVIDER_BADGE` entry, so a future rebrand of
// any provider's colour re-measures itself instead of silently drifting from
// this comment — the exact failure lib/ui/contrast.ts's own header exists to
// prevent ("prose cannot fail CI").
const FILL_CONTRAST_FLOOR = 4.5;

/**
 * The white this card's ink is measured against and painted with, as a FIXED
 * value rather than the `on-brand`/`on-brand-dark` FLIPPING PAIR used on the
 * `bg-brand` fallback below.
 *
 * `on-brand-dark` is near-black (constants/colors.ts), chosen for a BRIGHT
 * green fill in dark mode — right for `bg-brand`, which itself flips between
 * a dark and a bright green, but wrong here: a provider's colour is
 * THEME-INDEPENDENT (one hex, not a light/dark pair), so the ink paired with
 * it has to stay fixed too, in both themes, matching the SAME white this
 * file's contrast measurement checks against.
 *
 * `palette["on-brand"]`, NOT a literal — Global Constraints names exactly two
 * authorised hex-literal locations, constants/colors.ts and
 * constants/providers.ts, and this file is neither. `on-brand` (light theme's
 * half of the pair above) already equals this exact value
 * (constants/colors.ts: `"on-brand": "#FFFFFF"`), so referencing it costs
 * nothing and removes a third place `"#FFFFFF"` could drift from the other
 * two — the same reused-token pattern `app/(tabs)/wallets.tsx` and
 * `components/reports/donut_chart.tsx` already use for a token VALUE needed
 * as a raw `style` rather than a className.
 */
const FILL_INK_WHITE = palette["on-brand"];

// ---------------------------------------------------------------------------
// The matchers card's "Edit" hitSlop (whole-branch review design F1).
// ---------------------------------------------------------------------------
//
// "Edit" carries NO padding class at all — just `text-secondary` (12px/16px
// line-height, tailwind.config.ts) inside a bare `Pressable` — so its painted
// height is the line-height alone, 16px. That is SHORTER than either of
// `components/ui/chip.tsx`'s own painted pills (22-24px) `CHIP_HIT_SLOP` was
// computed against, so reusing that constant here verbatim would still miss
// 44: 16 + 12 + 12 = 40. The deficit is 44 - 16 = 28, split evenly: 14 top,
// 14 bottom closes it exactly (16 + 14 + 14 = 44).
//
// UNCAPPED HORIZONTALLY, UNLIKE CHIP_HIT_SLOP — and that is a deliberate
// difference, not an oversight. `CHIP_HIT_SLOP`'s left/right is capped at
// half the app's chip-row `gap-2` because chips sit ADJACENT to other
// Pressables in that row. "Edit" has no such neighbour: it is the only
// interactive element in its `flex-row items-center justify-between` header
// row (`app/wallet/[id].tsx`'s own "Notification matchers" title is a plain,
// non-interactive `Text`), the nearest Pressable below it (the "+ Add" chip
// row) sits at least 32px away (`pt-1` caption + `pt-3` row gap, both well
// clear of a 14px slop), and the nearest Pressable above it sits behind this
// card's own `p-4` padding plus the outer `pt-3` wrapper margin. Widening
// left/right the same 14px has nothing adjacent to collide with, so it does
// too, rather than leaving the control's short "Edit" label narrower than it
// needs to be.
const EDIT_MATCHERS_HIT_SLOP = { top: 14, bottom: 14, left: 14, right: 14 };

type HeaderFill = { kind: "brand" } | { kind: "provider"; color: string };

/**
 * Whether `providerKey`'s own colour is safe to fill the whole balance card
 * with, or whether the card falls back to the app's own brand green.
 *
 * No provider (`null` — Cash, any manual wallet) always falls back: there is
 * no company colour to use. A resolved provider additionally falls back when
 * white fails the 4.5:1 floor above — see the measured table.
 */
function fillForProvider(providerKey: string | null): HeaderFill {
  if (!providerKey) return { kind: "brand" };
  const { color } = providerBadge(providerKey);
  if (contrastRatio(FILL_INK_WHITE, color) < FILL_CONTRAST_FLOOR) return { kind: "brand" };
  return { kind: "provider", color };
}

export default function WalletDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const walletId = id ?? "";
  // A full-screen route outside the tab navigator: nothing above it clears the
  // status bar or Android's navigation bar. See app/_layout.tsx's
  // SafeAreaProvider comment for why each surface pads its own edges.
  const insets = useSafeAreaInsets();
  const [reconciling, setReconciling] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // The two writes this screen owns, each held as a REF plus a piece of state
  // (GAP-060, GAP-079).
  //
  // THE REFS ARE THE GUARDS. `isPending` alone cannot be one — React Query
  // notifies its observers on a timer, so two presses inside ONE JS tick both
  // read `false`, and on the archive path that is a second
  // `reassignWalletTransactions` over a ledger the first is still moving. Nor
  // can a `useState` be one: a setter does not change the value the CURRENT
  // render's handler closure is holding, so both presses in that tick still
  // read `false`. Only a ref is written and read back inside one tick.
  //
  // THE STATE IS THE RENDER — a ref changing re-renders nothing, and both
  // buttons have a busy state to show. `isPending` is ORed in with it, because
  // it stays true across the invalidation `onSuccess` awaits.
  const archiveInFlight = useRef(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const dismissInFlight = useRef(false);
  const [dismissBusy, setDismissBusy] = useState(false);

  const { data: wallet, isPending } = useWallet(walletId);
  const { data: drift } = useBalanceDrift(walletId);
  const { data: ruleset } = useRuleset();
  const { data: matchers } = useWalletMatchers(walletId);
  const { data: transactions } = useTransactions({ walletId });
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const archiveWallet = useArchiveWallet();
  const unarchiveWallet = useUnarchiveWallet();
  const dismissDrift = useDismissDrift();

  if (isPending) {
    return (
      <View testID="wallet-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={6} />
      </View>
    );
  }

  if (!wallet) {
    // A blank screen for a bad id leaves the user tapping a back button they
    // cannot see. `useWallet` resolves an ARCHIVED wallet normally, so this
    // branch really does mean "no such wallet".
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="wallet-detail-missing"
          title="Wallet not found"
          body="This wallet may have been removed. Go back and pick another one."
        />
      </View>
    );
  }

  // Read from the ruleset, never inlined — see components/wallets/balance_mismatch_badge.tsx.
  const toleranceCentavos = ruleset?.tunables.balanceDriftToleranceCentavos;
  // Nothing routes here, so nothing can track it — what `type: "cash"` meant.
  const isCash = isManualOnly(wallet);
  // Review fix (2026-08-18): a credit balance is the amount OWED
  // (lib/wallets/summary.ts's rule 23, and the "Owed" label in the balance
  // header below — task-5b moved it from a line under the figure to the
  // header's own small label above it, replacing "Current balance"), and
  // BalanceCorrectionSheet's "what does this wallet actually have?" plus its
  // in/out mapping is written for a HELD balance — on a credit card that
  // question is ambiguous between owed and available credit, and getting the
  // sign wrong would record taking on debt as money received. Excluded here
  // rather than answered wrong; see the on-screen note below for why.
  const isCredit = wallet.owedBalance;
  // The badge's own predicate, so the action and the badge cannot disagree about
  // whether there is a drift to dismiss. Narrowed to the drift itself, because
  // the mutation needs the reporting transaction's id off it.
  const dismissibleDrift = isDriftWorthShowing(drift, toleranceCentavos) ? drift : null;

  // A wallet's provider is DERIVED, never stored (types/domain.ts) — the same
  // "first matcher, oldest first" resolution app/(tabs)/wallets.tsx already
  // uses (`listMatchers` orders by `created_at ASC`), scoped here to this one
  // wallet's own matchers instead of the whole-device set. `null` for a
  // wallet with no matcher at all (Cash, any manual wallet) and for a matcher
  // whose package no installed provider claims.
  const firstMatcherPackage = (matchers ?? [])[0]?.packageName;
  const providerKey =
    firstMatcherPackage === undefined
      ? null
      : providerKeyForPackage(ruleset?.providers ?? [], firstMatcherPackage);
  const fill = fillForProvider(providerKey);
  const fillStyle = fill.kind === "provider" ? { backgroundColor: fill.color } : undefined;
  const fillClassName = fill.kind === "brand" ? "bg-brand dark:bg-brand-dark" : "";
  // Tokens for the `bg-brand` fallback (theme-correct — dark mode's brand
  // green is bright and needs DARK ink); the literal white above for the
  // provider-colour fill (theme-independent — see FILL_INK_WHITE's own
  // comment). Never both: exactly one of the two is defined per render.
  const inkClassName = fill.kind === "brand" ? "text-on-brand dark:text-on-brand-dark" : "";
  const inkStyle = fill.kind === "provider" ? { color: FILL_INK_WHITE } : undefined;

  // "In this period +₱X / Out −₱Y" (task-5b brief). Reuses
  // `summarizePeriod`/`periodForScope` — lib/reports/aggregate.ts's own
  // transfer-exclusion and lib/period.ts's own calendar-month window — rather
  // than a third copy of either rule; see aggregate.ts's header on why a
  // second money-in/money-out filter is how a wallet's figure ends up
  // disagreeing with the Reports tab's. Scoped to THIS wallet's transactions
  // already (`useTransactions({ walletId })` above), the same list the ledger
  // below renders.
  const nowMs = systemClock.now();
  const periodDates = periodForScope("monthly", toDateIso(new Date(nowMs)));
  const period = summarizePeriod(transactions ?? [], {
    from: periodDates.start,
    to: periodDates.end,
  });

  return (
    // DEVICE-TESTING FIX (2026-08-18, Task 2): the insets used to sit on the
    // ScrollView's `style` prop, which is the ScrollView's OUTER FRAME, not
    // its scrolling content — so the header rendered under the status bar and
    // the last row of the ledger could scroll in behind Android's navigation
    // bar. Matches `app/review/index.tsx`'s shape (insets on a padding-free
    // outer View wrapping the ScrollView), the same house pattern
    // `components/onboarding/onboarding_frame.tsx` uses, rather than
    // inventing a third: the outer View reserves both system-bar edges
    // first, so the ScrollView's own viewport — and everything that scrolls
    // inside it — never extends into either one.
    <View
      testID="wallet-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView className="flex-1">
        <View className="pb-8 pt-4">
          {/* The name row. The design board puts the wallet's name in a
              native nav header instead (a back chevron and a pencil beside
              it) — this screen has never had one (nothing above it clears
              the status bar; see this file's own header above), and
              building one is a navigation-layer change well outside this
              restyle. Kept here, plain, above the colour-filled card below,
              so it stays readable against the page background regardless of
              what the card beneath it is filled with. */}
          <View className="flex-row items-center gap-2 px-4 pb-3">
            <WalletIcon wallet={wallet} testID="wallet-detail-icon" />
            <Text className="flex-1 text-lg font-semibold text-fg dark:text-fg-dark">
              {wallet.name}
            </Text>
            {wallet.isArchived ? <Chip label="Deleted" tone="soon" /> : null}
          </View>

          <View className="px-4">
            {/* Full-bleed, filled with the resolved provider's own colour
                (or `bg-brand` — see `fillForProvider` above for both the
                "no provider" and the "contrast fails" cases). NOT the
                shared `Card` primitive: `Card` hardcodes `bg-surface`, and
                this fill is a runtime value neither a className nor a
                `variant` can express. Same outer shape (`rounded-2xl p-4`)
                so it still reads as a card on the page. */}
            <View
              testID="wallet-detail-balance-card"
              className={`gap-2 rounded-2xl p-4 ${fillClassName}`.trim()}
              style={fillStyle}
            >
              <View className="flex-row items-center justify-between">
                <Text className={`text-micro font-semibold ${inkClassName}`.trim()} style={inkStyle}>
                  {/* Rule 23: a credit balance is the outstanding amount
                      owed, not money held — said here instead of "Current
                      balance" so the header never reads like cash. */}
                  {isCredit ? "Owed" : "Current balance"}
                </Text>
                {providerKey ? (
                  // The provider's OWN badge, regardless of whether the card
                  // above used that provider's colour as its fill or fell
                  // back to bg-brand on contrast grounds — the badge has its
                  // own separately-measured ink (constants/providers.ts) and
                  // reads fine on either background.
                  <ProviderBadge
                    testID={`wallet-detail-provider-${providerKey}`}
                    providerKey={providerKey}
                    size={28}
                  />
                ) : (
                  // No provider at all: the wallet glyph, never a grey
                  // "unidentified provider" badge — same rule wallet_card.tsx
                  // already follows for the identical reason (a badge here
                  // would claim a company identity this wallet does not
                  // have). Always the on-brand fill in this branch, since a
                  // null providerKey always resolves `fillForProvider` to
                  // "brand".
                  <WalletIcon
                    wallet={wallet}
                    testID="wallet-detail-header-icon"
                    className="text-on-brand dark:text-on-brand-dark"
                  />
                )}
              </View>
              {/* `formatCentavos` rendered directly, NOT nested inside
                  `AmountText` — AmountText sets its own colour unconditionally
                  with no override prop, so nesting it here would silently
                  discard this card's white/on-brand ink (the exact bug this
                  project has shipped twice; see wallet_card.tsx's identical
                  note). */}
              <Text
                testID="wallet-detail-balance"
                style={{ fontVariant: ["tabular-nums"], ...(inkStyle ?? {}) }}
                className={`text-hero font-extrabold ${inkClassName}`.trim()}
              >
                {formatCentavos(wallet.balance)}
              </Text>
              <View testID="wallet-detail-period" className="flex-row gap-4">
                <Text className={`text-secondary ${inkClassName}`.trim()} style={inkStyle}>
                  {"In this period "}
                  <Text testID="wallet-detail-period-in" className="font-bold">
                    {`+${formatCentavos(period.income)}`}
                  </Text>
                </Text>
                <Text className={`text-secondary ${inkClassName}`.trim()} style={inkStyle}>
                  {"Out "}
                  {/* U+2212 MINUS SIGN, matching AmountText's own convention
                      (components/ui/amount_text.tsx) — digit-width, unlike a
                      hyphen, so this row does not wobble against every other
                      signed figure on screen. */}
                  <Text testID="wallet-detail-period-out" className="font-bold">
                    {`−${formatCentavos(period.spend)}`}
                  </Text>
                </Text>
              </View>
            </View>
          </View>

          {/* The drift badge stays OUTSIDE the colour-filled card and keeps
              its own tokens (text-fg-2, a warn-tone Chip) — those assume an
              ordinary page/card surface, and this screen does not own
              balance_mismatch_badge.tsx to re-theme it for an arbitrary
              provider fill. */}
          <View className="px-4 pt-2">
            <BalanceMismatchBadge
              testID="wallet-detail-drift"
              drift={drift}
              toleranceCentavos={toleranceCentavos}
            />
          </View>

          {/* Rule 4's actions — FOUR now, not three: edit, reconcile
              (cash only), adjust balance (bank/savings/e-wallet only), and
              archive. Reconcile and adjust balance are mutually exclusive per
              wallet type, so at most one of them ever renders here; dismiss
              is a separate, drift-conditional button layered on top (rule 3),
              not counted among these. There is still no delete: see the file
              header on why. Archived wallets get none of them — an archived
              wallet is read-only until it is unarchived (spec §UX states,
              "rows are read-only until unarchived"). */}
          {!wallet.isArchived ? (
            <View className="flex-row gap-2 px-4 pt-3">
              <View className="flex-1">
                <Button
                  testID="wallet-detail-edit"
                  title="Edit"
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: "/wallet/[id]/edit", params: { id: wallet.id } })
                  }
                />
              </View>
              {isCash ? (
                <View className="flex-1">
                  <Button
                    testID="wallet-detail-reconcile"
                    title="Reconcile"
                    variant="secondary"
                    onPress={() => setReconciling(true)}
                  />
                </View>
              ) : isCredit ? null : (
                // DEVICE-TESTING FIX (2026-08-18, Task 4): every wallet used
                // to start at ₱0.00 with no way to say "this already has
                // ₱3,000 in it" once it existed — CashReconcileSheet is
                // cash-only by rule 6/its own header, so non-cash, non-credit
                // wallets get their own correction, writing a ledger entry
                // the same way (see balance_correction_sheet.tsx for why it
                // is a different sheet, not a modified one). Credit is
                // excluded — see isCredit's own comment above.
                <View className="flex-1">
                  <Button
                    testID="wallet-detail-adjust-balance"
                    title="Adjust balance"
                    variant="secondary"
                    onPress={() => setCorrecting(true)}
                  />
                </View>
              )}
              {dismissibleDrift ? (
                <View className="flex-1">
                  <Button
                    testID="wallet-detail-dismiss-drift"
                    title="Dismiss"
                    variant="secondary"
                    loading={dismissDrift.isPending || dismissBusy}
                    // The id from the drift ON SCREEN, never a fresh read: this
                    // records what the user actually looked at and accepted. A
                    // report that lands between this render and the tap keeps its
                    // own drift, and the badge comes back for it.
                    onPress={() => {
                      if (dismissInFlight.current || dismissDrift.isPending) return;
                      dismissInFlight.current = true;
                      setDismissBusy(true);
                      dismissDrift.mutate(
                        {
                          walletId: wallet.id,
                          transactionId: dismissibleDrift.reportingTransactionId,
                        },
                        // `onSettled`: a refused dismissal leaves the badge and
                        // this button exactly where they were, so the retry the
                        // failure toast asks for has to be tappable.
                        {
                          onSettled: () => {
                            dismissInFlight.current = false;
                            setDismissBusy(false);
                          },
                        },
                      );
                    }}
                  />
                </View>
              ) : null}
              <View className="flex-1">
                {/* task-5b: "Adjust balance" and "Archive wallet" as
                    `secondary` buttons — was `ghost`, the one button in this
                    row that did not already match. Title gains "wallet" to
                    match the design's own copy; no test pins the old bare
                    "Archive" text, only this testID. */}
                <Button
                  testID="wallet-detail-archive"
                  title="Delete wallet"
                  variant="secondary"
                  // The mutation is reset ON THE WAY IN, not on the way out: a
                  // refusal the user backed away from must not be the first
                  // thing the sheet says the next time it opens (GAP-079).
                  onPress={() => {
                    archiveWallet.reset();
                    setArchiving(true);
                  }}
                />
              </View>
            </View>
          ) : null}

          {/* THE ONE ACTION AN ARCHIVED WALLET DOES GET, and the one the block
              above has been promising since it was written: "read-only until it
              is unarchived" described a state with no exit, because nothing in
              the app could unarchive anything (owner's device report: "no way
              to see and unarchive archived goals and the same for other planned
              tabs"). Restoring is the undo of an archive, not a destructive
              act, so it takes no confirmation sheet — unlike `ArchiveWalletSheet`,
              which asks where the transactions should go.

              THE ERROR IS SHOWN, NOT SWALLOWED. Archiving frees a wallet's name
              for reuse, so `unarchiveWallet` refuses when a live wallet has
              taken it (`DuplicateNameError`) rather than producing two live
              wallets called "GCash". The user's fix is to rename one of them,
              which is what the message says. */}
          {wallet.isArchived ? (
            <View className="gap-2 px-4 pt-3">
              <Button
                testID="wallet-detail-restore"
                title="Restore wallet"
                variant="secondary"
                loading={unarchiveWallet.isPending}
                onPress={() => unarchiveWallet.mutate(wallet.id)}
              />
              {unarchiveWallet.isError ? (
                <Text
                  testID="wallet-detail-restore-error"
                  className="text-sm text-danger dark:text-danger-dark"
                >
                  Another wallet is already using the name &ldquo;{wallet.name}&rdquo;. Rename that
                  one first, then restore this wallet.
                </Text>
              ) : (
                <Text className="text-sm text-fg-2 dark:text-fg-2-dark">
                  Restoring brings this wallet back with every transaction it already had.
                </Text>
              )}
            </View>
          ) : null}

          {/* Review fix (2026-08-18): SAY why there is no fourth button here,
              rather than just not having one. A silently missing action reads
              as a bug; a stated reason reads as a real limit. */}
          {!wallet.isArchived && isCredit ? (
            <View className="px-4 pt-2">
              <Text testID="wallet-detail-owed-note" className="text-sm text-fg-2 dark:text-fg-2-dark">
                Starting balance and manual corrections aren&apos;t available for a balance you
                owe yet — the figure can mean either what you owe or what you have left to
                spend, and this needs its own wording to get that right. Notifications still
                update this balance automatically.
              </Text>
            </View>
          ) : null}

          <CashReconcileSheet
            wallet={wallet}
            visible={reconciling}
            onDismiss={() => setReconciling(false)}
          />
          <BalanceCorrectionSheet
            wallet={wallet}
            visible={correcting}
            onDismiss={() => setCorrecting(false)}
          />
          <ArchiveWalletSheet
            wallet={wallet}
            visible={archiving}
            onDismiss={() => setArchiving(false)}
            otherWallets={wallets ?? []}
            transactionCount={(transactions ?? []).length}
            busy={archiveWallet.isPending || archiveBusy}
            // The sheet stays open on a failure — `setArchiving(false)` is on
            // the success arm and stays there — so it is the one surface that
            // can say what is still true: the wallet is live, its transactions
            // have not moved, and the choice above is still what will be sent.
            errorMessage={
              archiveWallet.isError
                ? "This wallet could not be deleted. Nothing was moved and nothing was retired — try again."
                : null
            }
            onArchive={(moveTransactionsTo) => {
              // The sheet's own `busy` guard is a prop, so within one JS tick
              // it is still the previous render's value — this ref is what a
              // second confirm in that tick actually meets.
              if (archiveInFlight.current || archiveWallet.isPending) return;
              archiveInFlight.current = true;
              setArchiveBusy(true);
              archiveWallet.mutate(
                { id: wallet.id, moveTransactionsTo },
                {
                  onSuccess: () => setArchiving(false),
                  // `onSettled`, not the success arm: a refused archive leaves
                  // the sheet open, and the retry it asks for needs the confirm
                  // button back.
                  onSettled: () => {
                    archiveInFlight.current = false;
                    setArchiveBusy(false);
                  },
                },
              );
            }}
          />

          {/* SHOWN FOR EVERY LIVE WALLET, WITH NO "is this cash?" GATE AT ALL.
              Rule 4 used to hide this card for a wallet TYPED as cash. Under
              the traits that replaced the type, "cash" means a wallet with no
              matchers — so keeping the gate would hide the matcher card from
              exactly the wallets that have none, and the dashed "+ Add" chip
              could never be reached to add a first one. A wallet stays manual
              because the user never picks a source here, not because the app
              refused to show them the control.

              ARCHIVED IS READ-ONLY, THE SAME INVARIANT THE ACTION ROW ABOVE
              ALREADY KEEPS (this file's own header: "an archived wallet is
              read-only until it is unarchived"). Unlike that row, this card
              is not simply hidden: its EXISTING chips stay informationally
              visible on an archived wallet (unchanged from before this
              task), because history reading is exactly what archiving is
              supposed to preserve — only the "Edit" and "+ Add" WRITE
              affordances disappear, and only an archived wallet with
              nothing to show and nothing to do renders no card at all. */}
          {!wallet.isArchived || (matchers && matchers.length > 0) ? (
            <View className="px-4 pt-3">
              <Card>
                <View className="flex-row items-center justify-between">
                  <Text className="text-row font-bold text-fg dark:text-fg-dark">
                    Notification matchers
                  </Text>
                  {!wallet.isArchived ? (
                    <Pressable
                      testID="wallet-detail-matchers-edit"
                      onPress={() =>
                        router.push({ pathname: "/wallet/[id]/edit", params: { id: wallet.id } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Edit notification matchers"
                      hitSlop={EDIT_MATCHERS_HIT_SLOP}
                    >
                      <Text className="text-secondary font-semibold text-brand dark:text-brand-dark">
                        Edit
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text className="pt-1 text-secondary text-fg-2 dark:text-fg-2-dark">
                  Alerts matching these land in this wallet.
                </Text>
                <View testID="wallet-detail-matchers" className="flex-row flex-wrap gap-2 pt-3">
                  {matchers && matchers.length > 0 ? (
                    <MatcherChipList matchers={matchers} providers={ruleset?.providers ?? []} />
                  ) : null}
                  {/* Dashed, unfilled — visually distinct from the solid
                      `outline` matcher chips beside it, the same way an
                      "add" affordance reads apart from the things it adds
                      to everywhere else in this app's forms. Goes to the
                      same edit screen as "Edit" above: the matcher picker
                      lives in wallet_form.tsx, reachable only from there. */}
                  {!wallet.isArchived ? (
                    <Pressable
                      testID="wallet-detail-matchers-add"
                      onPress={() =>
                        router.push({ pathname: "/wallet/[id]/edit", params: { id: wallet.id } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Add a notification matcher"
                      className="flex-row items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 dark:border-line-dark"
                      hitSlop={CHIP_HIT_SLOP}
                    >
                      <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
                        + Add
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            </View>
          ) : null}

          <SectionHeader
            title="Recent activity"
            action={
              (transactions ?? []).length > 0
                ? {
                    label: `See all ${(transactions ?? []).length}`,
                    // The general Transactions tab, not a wallet-filtered
                    // view — that filter plumbing lives in
                    // app/(tabs)/transactions.tsx, outside this task's file
                    // list. Nothing is hidden by this link: the full,
                    // untruncated wallet ledger is still the list rendered
                    // immediately below it on this very screen.
                    onPress: () => router.push("/transactions"),
                  }
                : undefined
            }
          />
          {/* THE app's ONE ledger list (m1c Task 6). `filtered` stays false: the
              wallet scope is what this screen IS, not a filter the user applied,
              so an empty one is "nothing tracked in this wallet" rather than
              "no transactions match these filters". */}
          <LedgerList
            testID="wallet-detail-ledger"
            transactions={transactions}
            wallets={wallets}
            categories={categories}
            // m1c Task 7: same rows, same destination as the Transactions tab.
            onSelect={(transaction) =>
              router.push({ pathname: "/transaction/[id]", params: { id: transaction.id } })
            }
            empty={
              <Text
                testID="wallet-detail-no-transactions"
                className="px-4 text-fg-2 dark:text-fg-2-dark"
              >
                Nothing tracked in this wallet yet.
              </Text>
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}
