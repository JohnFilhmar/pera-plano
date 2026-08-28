// app/(onboarding)/done.tsx — the M3c onboarding flow's last step
// (m3c-onboarding-client plan Task 3, rule 6; docs/04-features/01-onboarding.md
// step 10).
//
// THE ONLY WRITER OF `onboarding_complete`. `completeOnboarding()`
// (lib/onboarding/onboarding_state.ts) is the single place in the app that
// ever flips a brand-new user into "/(tabs)" — every other step screen in
// this flow funnels through here rather than writing the setting itself.
//
// NO SKIP LINK. OnboardingFrame's own header comment is explicit that "done"
// has nothing left to skip — this is the step being skipped past lands on,
// not one more thing to skip. `onSkip` is simply never passed.
//
// SELF-SUFFICIENT, NOT FED THROUGH PROPS. Like app/(onboarding)/wallets.tsx,
// this screen re-reads what actually landed in the database (Wallets, income,
// the first Limit) rather than trusting a chain of props carried across five
// screens — the summary is only ever as honest as the ledger it is reading
// from, which is also the number Home is about to show.
//
// COMPONENTS NEVER IMPORT A REPOSITORY (release-gate grep). This file does,
// through hooks/queries/use_wallets.ts, use_income_summary.ts and
// use_limit_statuses.ts only.
//
// IT NAVIGATES ITSELF — see app/(onboarding)/wallets.tsx's header for the
// whole story. This screen is where that defect bit hardest: with no caller to
// supply `onDone`, "Go to Home" wrote `onboarding_complete` and then went
// nowhere, so the one action that ends onboarding could never be observed to
// end it.
//
// `replace`, NOT `push`, FOR THE LAST HOP. Every other step pushes, so Back
// walks the flow backwards. This one leaves the flow for good: onboarding is
// finished and `onboarding_complete` is already written, so a back gesture
// from Home must not land the user on a setup step that would re-run its
// writes. Replacing drops "done" from the history instead of stacking Home on
// top of it.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Lock } from "lucide-react-native";
import { Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { AmountText } from "@/components/ui/amount_text";
import { BrandMark } from "@/components/ui/brand_mark";
import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { useWallets } from "@/hooks/queries/use_wallets";
import { completeOnboarding } from "@/lib/onboarding/onboarding_state";
import { clearWalletDraft } from "@/lib/onboarding/wallet_draft";

const LockGlyph = registerIcon(Lock);

const CADENCE_LABEL: Record<string, string> = {
  kinsenas: "kinsenas (15th and month-end)",
  weekly: "weekly",
  monthly: "monthly",
  irregular: "no fixed schedule",
};

export default function DoneScreen({
  onDone,
  onBack,
}: { onDone?: () => void; onBack?: () => void } = {}) {
  const router = useRouter();
  const { data: wallets } = useWallets();
  const { data: income } = useIncomeSummary();
  const { data: limitStatuses } = useLimitStatuses();
  const [finishing, setFinishing] = useState(false);

  // task-7-brief.md Step 4: the launch beat "plays on mount, alongside the
  // confetti dots the board draws." There is no confetti component to reuse
  // and this task builds no new one (dispatch note, and Interfaces: "no new
  // components") — so this screen carries the mark alone. `playToken` still
  // moves once, on mount, matching the shape every other success beat uses
  // even though a fresh mount alone would already trigger `BrandMark`'s own
  // one-shot effect; this keeps the four beats one pattern instead of three
  // plus a special case.
  const [playToken, setPlayToken] = useState(0);
  useEffect(() => {
    setPlayToken((token) => token + 1);
  }, []);

  const walletCount = wallets?.length ?? 0;
  const incomeKnown = income !== undefined && income.cadence !== null;
  const firstLimit = limitStatuses?.[0] ?? null;

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await completeOnboarding();
      // The wallet step's in-memory draft has no reason to outlive the flow it
      // belongs to: anything in it that mattered is a Wallet row by now, and a
      // second run of onboarding (a reset, a restored backup) must start from
      // the database, never from the last run's half-finished list.
      clearWalletDraft();
      if (onDone) {
        onDone();
      } else {
        router.replace("/(tabs)");
      }
    } finally {
      setFinishing(false);
    }
  }, [finishing, onDone, router]);

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  }, [onBack, router]);

  return (
    <OnboardingFrame
      step="done"
      title="You're all set"
      onPrimary={finish}
      primaryLabel="Go to Home"
      primaryBusy={finishing}
      onBack={goBack}
    >
      {/* THE CHECK MEDALLION. A big, calm "you're done" mark rather than
          another line of copy — the four cards below are the detail; this is
          the one glance that says the setup succeeded. */}
      <View className="items-center py-2">
        <View
          testID="done-medallion"
          className="h-20 w-20 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft-dark"
        >
          <BrandMark testID="done-mark" variant="launch" playToken={playToken} size={40} />
        </View>
      </View>

      <Text
        testID="done-step-intro"
        className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark"
      >
        Here&apos;s what PeraPlano set up for you. Everything here can be changed any time.
      </Text>

      <Card testID="done-wallets-summary">
        <Text className="text-row font-bold text-fg dark:text-fg-dark">
          {walletCount === 0
            ? "No wallets yet"
            : walletCount === 1
              ? "1 wallet ready"
              : `${walletCount} wallets ready`}
        </Text>
        <Text className="mt-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
          {walletCount === 0
            ? "Add one any time from the Wallets tab."
            : "PeraPlano will pick up transactions from these automatically."}
        </Text>
      </Card>

      <Card testID="done-income-summary">
        <Text className="text-row font-bold text-fg dark:text-fg-dark">
          {incomeKnown ? "Income declared" : "Income not set yet"}
        </Text>
        <Text className="mt-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
          {incomeKnown
            ? `Paid ${CADENCE_LABEL[income!.cadence as string] ?? income!.cadence}.`
            : "PeraPlano will work this out from your transactions over the next few paydays."}
        </Text>
      </Card>

      <Card testID="done-limit-summary">
        <Text className="text-row font-bold text-fg dark:text-fg-dark">
          {firstLimit ? "Your first Limit is active" : "No Limit set yet"}
        </Text>
        {firstLimit && firstLimit.effectiveLimit !== null ? (
          <View className="mt-1 flex-row items-center gap-1">
            <Text className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
              Monthly limit:
            </Text>
            <AmountText amount={firstLimit.effectiveLimit} size="sm" showSign={false} />
          </View>
        ) : (
          <Text className="mt-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
            Add one any time from the Plan tab — Safe-to-Spend works better with one.
          </Text>
        )}
      </Card>

      {/* THE FOURTH CHECKLIST ITEM — the design's own count for this screen.
          Deliberately static, unlike the three above: it names a standing
          property of the app (docs/04-features/01-onboarding.md's local-first
          promise, the same one access_explainer.tsx states) rather than a
          fresh query, so it needs no new hook — this task may not add one
          (lib/db/repos, hooks/queries and constants/query_keys.ts belong to a
          concurrent task). */}
      <Card testID="done-privacy-summary">
        <View className="flex-row items-center gap-2">
          <LockGlyph size={16} className="text-brand dark:text-brand-dark" />
          <Text className="text-row font-bold text-fg dark:text-fg-dark">
            Your data stays on this phone
          </Text>
        </View>
        <Text className="mt-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
          Notifications are parsed on-device. PeraPlano never sends your bank or e-wallet text
          anywhere else.
        </Text>
      </Card>
    </OnboardingFrame>
  );
}
