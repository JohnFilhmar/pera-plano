// app/(tabs)/plan/limits/[id]/edit.tsx — edit a Limit (owner, 2026-08-20:
// "each limits created should still be modifiable if its still not").
//
// THE ROUTE SHAPE MATCHES app/wallet/[id]/edit.tsx, which already pairs a
// `[id].tsx` detail screen with an `[id]/edit.tsx` sibling. expo-router
// resolves both.
//
// NO ENTITLEMENT CHECK HERE, and the wallet edit route's header gives the
// reason in full: the cap is on CREATING a limit, and editing one the user
// already has is never blocked. A gate that stopped someone lowering a limit
// after a downgrade would be a gate on their own data
// (docs/05-monetization.md §3.1 principle 2).
//
// NO ARCHIVE HERE EITHER. That lives on the detail screen next to the other
// destructive-ish action, behind a confirmation — an edit form is where you go
// to change a number, and putting "retire this" on it invites the wrong tap.
//
// EDITING A DERIVED LIMIT IS AN ORDINARY EDIT. `derivedFrom` records where a
// limit came from and never makes it dependent (owner's decision: "edit any one
// -> the others stay put"), so nothing here re-derives its siblings.
import { useLocalSearchParams, useRouter } from "expo-router";

import { LimitForm, limitFormInitialFrom } from "@/components/limits/limit_form";
import type { LimitFormValues } from "@/components/limits/limit_form";
import { EmptyState } from "@/components/ui/empty_state";
import { FormScreen } from "@/components/ui/form_screen";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useUpdateLimit } from "@/hooks/mutations/use_update_limit";
import { useCategories } from "@/hooks/queries/use_categories";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { useWallets } from "@/hooks/queries/use_wallets";
import { View } from "react-native";

export default function EditLimitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: statuses } = useLimitStatuses();
  const { data: income } = useIncomeSummary();
  const { data: categories } = useCategories();
  const { data: wallets } = useWallets();
  const update = useUpdateLimit();

  // Render nothing until the data lands, rather than an empty form that then
  // fills in — a form whose values appear a frame later invites an edit on top
  // of a value the user never saw.
  if (statuses === undefined) {
    return (
      <View testID="limit-edit-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={3} />
      </View>
    );
  }

  const status = statuses.find((candidate) => candidate.limit.id === id);
  if (status === undefined) {
    return (
      <View testID="limit-edit-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This limit is gone"
          body="It was deleted. Your spending history is untouched, and you can restore the limit from Plan → Limits."
          action={{ label: "Back to limits", onPress: () => router.back() }}
        />
      </View>
    );
  }

  const onSave = async (values: LimitFormValues) => {
    // `useUpdateLimit` re-snapshots the base in the same mutation — limits rule
    // 11's "a manual edit to the Limit recomputes the base immediately".
    // Without it an edited limit keeps measuring against the figure it was
    // created with until the next period boundary.
    await update.mutateAsync({ id: status.limit.id, patch: values });
    router.back();
  };

  return (
    <FormScreen testID="limit-edit">
      <LimitForm
        testID="limit-edit-form"
        initial={limitFormInitialFrom(status.limit)}
        onSubmit={onSave}
        incomeUsable={(income?.monthlyEquivalent ?? null) !== null}
        monthlyIncome={income?.monthlyEquivalent ?? null}
        onDeclareIncome={() => router.push("/plan/income")}
        busy={update.isPending}
        submitLabel="Save changes"
        categories={categories ?? []}
        wallets={wallets ?? []}
      />
    </FormScreen>
  );
}
