// app/(tabs)/plan/limits/new.tsx — create a Limit (m2 Task 8;
// docs/04-features/03-limits.md "Flow: create a Limit", steps 1-7).
//
// THE FORM ITSELF LIVES IN components/limits/limit_form.tsx (2026-08-20), so
// this route and app/(tabs)/plan/limits/[id]/edit.tsx cannot drift apart. What
// stays here is what only a CREATE does: the entitlement gate, and the
// derivation that fills in the other cadences from the one the user entered.
//
// THE DERIVATION IS THE OWNER'S DECISION OF 2026-08-20. Entering one limit also
// creates the equivalent at every other cadence, so Plan -> Limits shows a
// daily, weekly, monthly and annual row rather than only the one that was
// typed — "its okay because user can update it anyways". Each derived row is an
// ordinary limit from the moment it is written; editing one leaves the rest
// alone.
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { LimitForm } from "@/components/limits/limit_form";
import type { LimitFormValues } from "@/components/limits/limit_form";
import { FormScreen } from "@/components/ui/form_screen";
import { useCreateLimit } from "@/hooks/mutations/use_create_limit";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { derivedLimitsFrom } from "@/lib/limits/limit_derivation";

export default function NewLimitScreen() {
  const router = useRouter();
  const { gated } = useLocalSearchParams<{ gated?: string }>();
  const create = useCreateLimit();
  const { data: income } = useIncomeSummary();
  // Read only to know which cadences already have a limit — see `onSave`.
  const { data: statuses } = useLimitStatuses();

  // Limits rule 12's "usable IncomeProfile": a monthly-equivalent figure the
  // app can actually multiply. Anything else — unknown, or an amount it has not
  // worked out yet — means a percent limit cannot be saved as active (spec
  // step 3). Replaces the hardcoded `false` this screen shipped with in m2
  // Task 8, before the income service existed.
  const incomeUsable = (income?.monthlyEquivalent ?? null) !== null;

  if (gated === "1") {
    return (
      <View
        testID="limits-gated"
        className="flex-1 items-center justify-center bg-bg p-6 dark:bg-bg-dark"
      >
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Limit cap reached</Text>
        {/* Constraint 11: a cap blocks creation and never deletes anything. */}
        <Text className="mt-2 text-center text-fg-2 dark:text-fg-2-dark">
          Free keeps one active limit, and your existing limits stay exactly as they are. Plus
          removes the cap and adds per-category limits.
        </Text>
      </View>
    );
  }

  const onSave = async (values: LimitFormValues) => {
    const created = await create.mutateAsync(values);

    // ONLY THE CADENCES THAT ARE STILL EMPTY. Without the occupied-scope list
    // this route would spawn three more rows on EVERY manual save — a user
    // with the full set who adds one more limit by hand getting three
    // duplicates, then three more the next time. "Fill in what is missing" is
    // the same rule onboarding follows and the only one that stays sane on a
    // screen the user keeps coming back to.
    const occupied = (statuses ?? []).map((status) => status.limit.scope);

    // FAILURES HERE ARE NOT FATAL. The limit the user actually asked for is
    // already saved; a derived row that does not land is a convenience
    // missing, not data lost, and it must never turn a successful save into an
    // error screen. Created one at a time rather than in parallel so a partial
    // failure leaves a prefix of the set rather than an arbitrary subset.
    for (const derived of derivedLimitsFrom(created, occupied)) {
      try {
        await create.mutateAsync(derived);
      } catch (error: unknown) {
        console.warn("a derived limit could not be created", error);
      }
    }

    router.back();
  };

  return (
    // NO ScrollView HERE (numeric-input-system Task 12). FormScreen IS a
    // keyboard-aware scroll view; nesting it inside another one left the OUTER
    // one — which knows nothing about the keypad's height — as the only one
    // with real scroll range, so the avoidance became a no-op. Same fix as
    // app/(tabs)/plan/bills/new.tsx and loans/new.tsx.
    <FormScreen testID="limit-new">
      <LimitForm
        onSubmit={onSave}
        incomeUsable={incomeUsable}
        onDeclareIncome={() => router.push("/plan/income")}
        busy={create.isPending}
        submitLabel="Save"
      />
    </FormScreen>
  );
}
