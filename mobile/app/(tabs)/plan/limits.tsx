// app/(tabs)/plan/limits/index.tsx — the Limits list (m2 Task 8;
// docs/04-features/03-limits.md "UX states & flows").
//
// Reads one hook and renders one card per limit. The 50/80/100 boundaries, the
// period window and the paused/inactive states are all decided by
// `getLimitStatuses` — this file lays them out and does no arithmetic, which is
// the same split `app/(tabs)/wallets.tsx` keeps with `lib/wallets/summary.ts`.
//
// THE ENTITLEMENT GATE IS AT THE CALL SITE (m2 Global Constraint 10), on the
// Add action rather than inside the repository, because this is the only place
// that has somewhere to send the user when the answer is no. MVP hardcodes the
// `plus` tier so `canCreateLimit` never actually blocks — the branch exists so
// that turning the tier on is a one-line change and not a feature.
import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";

import { LimitCard } from "@/components/limits/limit_card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { useCategories } from "@/hooks/queries/use_categories";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { canCreateLimit } from "@/lib/entitlements";
import { limitDisplayName } from "@/lib/limits/limit_label";

export default function LimitsScreen() {
  const router = useRouter();
  const { data: statuses } = useLimitStatuses();
  const { data: categories } = useCategories();

  // Names for the card labels. `useCategories` may still be loading, and
  // `limitDisplayName` degrades to a count rather than waiting — a card that
  // renders "Monthly limit · 1 category" for a moment is better than a list
  // that does not appear until a second query lands.
  const categoryNames = new Map((categories ?? []).map((category) => [category.id, category.name]));

  const onAdd = () => {
    // Rule: the cap counts ACTIVE limits, not all of them. A user who
    // deactivated one has room for another.
    const activeCount = (statuses ?? []).filter((status) => status.limit.isActive).length;
    router.push(canCreateLimit(activeCount) ? "/plan/limits/new" : "/plan/limits/new?gated=1");
  };

  // Render nothing until the list has loaded. An empty state that flashes on
  // every cold start reads as data loss — the same rule the Wallets tab keeps.
  if (statuses === undefined) {
    return <View testID="limits-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  if (statuses.length === 0) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        {/* The spec's UX-states table string, not the plan's. */}
        <EmptyState
          testID="limits-empty"
          title="Set your first limit"
          body="A cap on spending for a day, week, month, or year — PeraPlano watches it for you."
          action={{ label: "Add a limit", onPress: onAdd }}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="gap-3 p-4">
        {statuses.map((status) => (
          <Pressable
            key={status.limit.id}
            testID={`limit-row-${status.limit.id}`}
            onPress={() =>
              router.push({ pathname: "/plan/limits/[id]", params: { id: status.limit.id } })
            }
          >
            <LimitCard
              testID={`limit-card-${status.limit.id}`}
              name={limitDisplayName(status.limit, categoryNames)}
              spend={status.spend}
              effectiveLimit={status.effectiveLimit}
              daysLeft={status.window.daysLeft}
              uiState={status.uiState}
            />
          </Pressable>
        ))}
      </ScrollView>
      <View className="absolute bottom-6 right-6">
        <Button title="Add" onPress={onAdd} testID="limits-add" />
      </View>
    </View>
  );
}
