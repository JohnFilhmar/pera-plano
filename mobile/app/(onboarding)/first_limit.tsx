// app/(onboarding)/first_limit.tsx — the M3c onboarding first-Limit step
// (m3c-onboarding-client plan Task 3, rules 4-5; docs/04-features/01-onboarding.md
// step 9).
//
// scope/rollover/thresholds ARE FIXED, NOT ASKED (docs rule 14): "monthly",
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
import { useCallback } from "react";

import { FirstLimitForm } from "@/components/onboarding/first_limit_form";
import type { FirstLimitFormValues } from "@/components/onboarding/first_limit_form";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { useCreateLimit } from "@/hooks/mutations/use_create_limit";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";

export default function FirstLimitScreen({
  onDone,
  onBack,
}: { onDone?: () => void; onBack?: () => void } = {}) {
  const { data: income } = useIncomeSummary();
  const createLimit = useCreateLimit();

  const advance = useCallback(() => onDone?.(), [onDone]);

  const submit = useCallback(
    async (values: FirstLimitFormValues) => {
      await createLimit.mutateAsync({
        scope: "monthly",
        basis: values.basis,
        value: values.value,
        rollover: false,
      });
      advance();
    },
    [createLimit, advance],
  );

  return (
    <OnboardingFrame
      step="first_limit"
      title="Set your first Limit"
      onPrimary={advance}
      onBack={onBack}
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
