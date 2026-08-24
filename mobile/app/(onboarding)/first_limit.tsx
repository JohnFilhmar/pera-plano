// app/(onboarding)/first_limit.tsx — the M3c onboarding first-Limit step
// (m3c-onboarding-client plan Task 3, rules 4-5; docs/04-features/01-onboarding.md
// step 9).
//
// SCOPE IS NOW ASKED (owner, 2026-08-20); rollover/thresholds stay fixed at
// "false" and 50/80/100% respectively — every one of them editable later in
// Plan -> Limits, none of them a decision onboarding needs to force.
//
// NO ENTITLEMENT CHECK HERE, DELIBERATELY. `canCreateLimit` (lib/entitlements.ts)
// gates a SECOND active Limit; the linear onboarding flow creates at most one,
// so the gate can never fire on this path (docs/05-monetization.md's own
// "Behavior at the gate" paragraph for onboarding makes the same point about
// Limits). Calling it here would be a check with no way to ever say no.
//
// COMPONENTS NEVER IMPORT A REPOSITORY (release-gate grep). This file does,
// through hooks/mutations/use_create_limit.ts and
// hooks/queries/use_income_summary.ts only.
//
// IT NAVIGATES ITSELF — see app/(onboarding)/wallets.tsx's header for the
// whole story. Reached from income.tsx; advances to done.tsx, which is the
// transition onboarding_state.ts's own `nextStep` doc singles out as the one
// a wrong answer strands the user on.
import { useCallback } from "react";
import { useRouter } from "expo-router";

import { FirstLimitForm } from "@/components/onboarding/first_limit_form";
import type { FirstLimitFormValues } from "@/components/onboarding/first_limit_form";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { useCreateLimit } from "@/hooks/mutations/use_create_limit";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { derivedLimitsFrom } from "@/lib/limits/limit_derivation";

export default function FirstLimitScreen({
  onDone,
  onBack,
}: { onDone?: () => void; onBack?: () => void } = {}) {
  const router = useRouter();
  const { data: income } = useIncomeSummary();
  const createLimit = useCreateLimit();
  // Read only to know which cadences already have a limit — see `submit`.
  const { data: statuses } = useLimitStatuses();

  // nextStep("first_limit") === "done" (lib/onboarding/onboarding_state.ts),
  // hardcoded so the literal matches a real file for expo-router to resolve.
  const advance = useCallback(() => {
    if (onDone) {
      onDone();
      return;
    }
    router.push("/(onboarding)/done");
  }, [onDone, router]);

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  }, [onBack, router]);

  const submit = useCallback(
    async (values: FirstLimitFormValues) => {
      const created = await createLimit.mutateAsync({
        // THE USER'S CHOICE, not a hardcoded "monthly" (owner, 2026-08-20).
        scope: values.scope,
        basis: values.basis,
        value: values.value,
        rollover: false,
      });

      // AND THE OTHER THREE CADENCES (owner, 2026-08-20): "limits are still not
      // automated to auto insert to user's database ... after entering it,
      // navigating to plan->limits only shows the entered onboarding data, not
      // calculated". So one answer populates the whole Limits screen, and every
      // row is an ordinary editable limit from the moment it lands.
      //
      // FAILURES HERE NEVER BLOCK ONBOARDING. The limit the user actually asked
      // for is already saved; a missing derived row is a convenience lost, not
      // data, and stranding someone on the last setup step over one would be
      // far worse. Sequential rather than parallel so a partial failure leaves
      // a prefix of the set rather than an arbitrary subset.
      //
      // ONLY THE CADENCES THAT ARE STILL EMPTY. In a clean onboarding that is
      // all three, but this step is reachable again after a back-navigation
      // and the user may already have limits from an earlier run — filling in
      // what is missing is right in both cases, where "always create three"
      // would quietly duplicate them.
      const occupied = (statuses ?? []).map((status) => status.limit.scope);
      for (const derived of derivedLimitsFrom(created, occupied)) {
        try {
          await createLimit.mutateAsync(derived);
        } catch (error: unknown) {
          console.warn("a derived limit could not be created during onboarding", error);
        }
      }

      advance();
    },
    // `statuses` BELONGS HERE. Without it this callback closes over the very
    // first render's value — `undefined`, before the query resolves — and the
    // occupied-scope check silently becomes "nothing is occupied" forever,
    // which is exactly the duplication it exists to prevent.
    [createLimit, advance, statuses],
  );

  return (
    <OnboardingFrame
      step="first_limit"
      title="Set your first Limit"
      onPrimary={advance}
      onBack={goBack}
      onSkip={advance}
    >
      <FirstLimitForm
        monthlyIncome={income?.monthlyEquivalent ?? null}
        busy={createLimit.isPending}
        onSubmit={submit}
      />
    </OnboardingFrame>
  );
}
