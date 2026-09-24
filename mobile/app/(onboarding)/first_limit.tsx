// app/(onboarding)/first_limit.tsx — the M3c onboarding first-Limit step
// (m3c-onboarding-client plan Task 3, rules 4-5; docs/04-features/01-onboarding.md
// step 9).
//
// SCOPE IS NOW ASKED (owner, 2026-08-20); rollover/thresholds stay fixed at
// "false" and 50/80/100% respectively — every one of them editable later in
// Plan -> Limits, none of them a decision onboarding needs to force.
//
// IT NEVER CREATES A SECOND LIMIT AT A SCOPE THAT HAS ONE (GAP-067). The flow
// is re-entered often enough to matter -- a background relock while the user is
// in system Settings for the access or battery step drops them back at the
// start of it -- and `createLimit` has no unique constraint on scope, so the
// second pass used to leave two active limits at the same cadence. See
// `submit`.
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
// whole story. Reached from income.tsx; advances to alerts.tsx (GAP-003 put
// that step between this one and done.tsx).
import { useCallback } from "react";
import { useRouter } from "expo-router";

import { FirstLimitForm } from "@/components/onboarding/first_limit_form";
import type { FirstLimitFormValues } from "@/components/onboarding/first_limit_form";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { useCreateLimit } from "@/hooks/mutations/use_create_limit";
import { useUpdateLimit } from "@/hooks/mutations/use_update_limit";
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
  const updateLimit = useUpdateLimit();
  // Which cadences already have a limit — read for BOTH halves of `submit`:
  // the one the user chose, and the three derived from it.
  const { data: statuses } = useLimitStatuses();

  // nextStep("first_limit") === "alerts" (lib/onboarding/onboarding_state.ts),
  // hardcoded so the literal matches a real file for expo-router to resolve.
  // WAS "done" until GAP-003 put the POST_NOTIFICATIONS ask between the two:
  // the alert this step's Limit will raise is the best possible reason to
  // grant it, and it is the screen immediately after this one.
  const advance = useCallback(() => {
    if (onDone) {
      onDone();
      return;
    }
    router.push("/(onboarding)/alerts");
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
      // THE CHOSEN SCOPE IS IDEMPOTENT TOO (GAP-067). This step is reachable a
      // second time -- by back-navigation, and by a relock that restarts the
      // flow -- and it used to insert unconditionally, leaving the user with
      // two active limits at one cadence and a Safe-to-Spend figure computed
      // from both. `occupied` below has answered the same question for the
      // derived cadences since they existed; the scope the user actually asked
      // for was the one case never asked about.
      //
      // UPDATED, NOT SKIPPED. The user has just filled in this form and
      // tapped save; discarding what they typed because an earlier pass wrote
      // something at that cadence would be the same screen doing nothing, with
      // no way for them to tell. An edit is also what the app already calls
      // this: `app/(tabs)/plan/limits/[id]/edit.tsx` treats editing a DERIVED
      // limit as an ordinary edit, and `updateLimit` leaves `derived_from`
      // alone, so the provenance of a row this replaces is preserved either
      // way.
      //
      // ROLLOVER AND is_active ARE NOT IN THE PATCH, so an existing limit keeps
      // both. A fresh one is created with `rollover: false` because that is
      // this step's fixed default; forcing the same `false` onto a limit the
      // user had since switched on in Plan -> Limits would quietly change how
      // much they may spend, from a screen that never mentioned it.
      const existing = (statuses ?? []).find((status) => status.limit.scope === values.scope);
      const created = existing
        ? await updateLimit.mutateAsync({
            id: existing.limit.id,
            patch: { basis: values.basis, value: values.value },
          })
        : await createLimit.mutateAsync({
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
    [createLimit, updateLimit, advance, statuses],
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
        busy={createLimit.isPending || updateLimit.isPending}
        onSubmit={submit}
        // BACK TO THE INCOME STEP, not Plan's /plan/income route. The tabs are
        // not mounted during onboarding, and the percent-blocked card is the
        // only thing on this screen that needs a figure the previous step
        // collects — `router.back()` lands there because income.tsx is what
        // pushed this screen, and the flow resumes forward from there.
        onDeclareIncome={goBack}
      />
    </OnboardingFrame>
  );
}
