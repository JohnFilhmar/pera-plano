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
// use_limit_statuses.ts only. `modules/notification_listener` is the one
// non-hook read: the notification-access grant is not in the database at all
// (it is a live native query — see `isAccessGranted`'s own doc), and this
// screen may not claim automatic tracking without it.
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

import { SCOPE_CHIP } from "@/components/onboarding/first_limit_form";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { AmountText } from "@/components/ui/amount_text";
import { BrandMark } from "@/components/ui/brand_mark";
import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { useWallets } from "@/hooks/queries/use_wallets";
import type { LimitStatus } from "@/lib/limits/limit_service";
import { completeOnboarding } from "@/lib/onboarding/onboarding_state";
import { isAccessGranted } from "@/modules/notification_listener";

const LockGlyph = registerIcon(Lock);

const CADENCE_LABEL: Record<string, string> = {
  kinsenas: "kinsenas (15th and month-end)",
  weekly: "weekly",
  monthly: "monthly",
  irregular: "no fixed schedule",
};

/**
 * The wallets card's second line — or `null` while the grant is still unread.
 *
 * THE AUTO-PICKUP SENTENCE IS A CLAIM ABOUT A PERMISSION, not about wallets.
 * Nothing on this screen read the grant, so a user who declined Notification
 * Access — manual mode, a first-class outcome this flow supports (docs step 10)
 * — was told on the last screen of setup that PeraPlano would track these
 * wallets for them. It will not, and they find out by watching an empty ledger
 * for a week.
 *
 * `null` while the answer is unknown, rather than the manual sentence: an
 * unresolved native call is not a refusal, and a screen whose whole job is
 * confirming what is true must not fill the gap with a guess in either
 * direction.
 */
function walletsCardBody(walletCount: number, accessGranted: boolean | null): string | null {
  if (walletCount === 0) return "Add one any time from the Wallets tab.";
  if (accessGranted === null) return null;
  return accessGranted
    ? "PeraPlano will pick up transactions from these automatically."
    : "PeraPlano isn't picking these up automatically yet — turn on notification access from Settings any time. Everything keeps working in manual mode until you do.";
}

/**
 * The limit card's headline.
 *
 * A LIMIT WITH NO EFFECTIVE FIGURE IS NOT "ACTIVE". `getLimitStatuses` returns
 * `effectiveLimit: null` for a limit it cannot resolve — a percent-of-income
 * limit with no income yet (`paused`), or one that is switched off — and this
 * card called every one of them active while the body underneath told the user
 * to go and add a Limit. Two statements about the same limit, contradicting
 * each other, on the last screen of setup.
 */
function limitCardTitle(status: LimitStatus | null): string {
  if (status === null) return "No Limit set yet";
  if (status.effectiveLimit !== null) return "Your first Limit is active";
  if (!status.limit.isActive) return "Your first Limit is switched off";
  return "Your first Limit is waiting on your income";
}

/** The line under it, for every state with no figure to show. */
function limitCardBody(status: LimitStatus | null): string {
  if (status === null) {
    return "Add one any time from the Plan tab — Safe-to-Spend works better with one.";
  }
  if (!status.limit.isActive) return "Switch it back on any time from the Plan tab.";
  // `paused` is `base === null`, and `baseFor` only returns null for a
  // percent-of-income limit with no income — so this branch can name the one
  // thing that is actually missing.
  return "It's a share of your income, and PeraPlano doesn't know your income yet. Declare it in Plan and this Limit starts working.";
}

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

  // WHETHER THE AUTO-PICKUP SENTENCE IS TRUE, asked here rather than carried
  // in from the access step: the grant is revocable from system settings at any
  // moment with no callback to this app (`isAccessGranted`'s own doc), and the
  // user has walked through several screens since answering it.
  const [accessGranted, setAccessGranted] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    isAccessGranted()
      .then((granted) => {
        if (!cancelled) setAccessGranted(granted);
      })
      // A bridge that throws is not a grant. The copy below never claims the
      // permission is off — only that nothing is being picked up yet — so this
      // stays honest whether the answer was "no" or "could not ask".
      .catch(() => {
        if (!cancelled) setAccessGranted(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const walletCount = wallets?.length ?? 0;
  const incomeKnown = income !== undefined && income.cadence !== null;
  const firstLimit = limitStatuses?.[0] ?? null;
  const walletsBody = walletsCardBody(walletCount, accessGranted);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await completeOnboarding();
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
        {walletsBody === null ? null : (
          <Text
            testID="done-wallets-mode"
            className="mt-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
          >
            {walletsBody}
          </Text>
        )}
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
          {limitCardTitle(firstLimit)}
        </Text>
        {firstLimit !== null && firstLimit.effectiveLimit !== null ? (
          <View className="mt-1 flex-row items-center gap-1">
            {/* THE SCOPE THE USER PICKED, not a hardcoded "Monthly". The first
                Limit step has offered daily/weekly/monthly/annual since
                2026-08-20; this line called every one of them monthly. */}
            <Text className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
              {`${SCOPE_CHIP[firstLimit.limit.scope]} limit:`}
            </Text>
            <AmountText amount={firstLimit.effectiveLimit} size="sm" showSign={false} />
          </View>
        ) : (
          <Text className="mt-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
            {limitCardBody(firstLimit)}
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
