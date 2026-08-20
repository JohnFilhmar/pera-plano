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
import { Pressable, ScrollView, Text, View } from "react-native";

import { LimitCard } from "@/components/limits/limit_card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { useCategories } from "@/hooks/queries/use_categories";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { canCreateLimit } from "@/lib/entitlements";
import { findLimitGaps, resolvedLimitFrom } from "@/lib/limits/limit_consistency";
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
    //
    // AND NOT THE ONES THE APP DERIVED (owner-approved 2026-08-20). Entering
    // one limit now also creates the equivalent at the other three cadences
    // (lib/limits/limit_derivation.ts), so counting those would take a Free
    // user from "one limit" to "gated" the instant they finished onboarding —
    // tripping a gate they never approached, over rows they never asked for.
    // The owner's ruling: derived limits are free.
    const activeCount = (statuses ?? []).filter(
      (status) => status.limit.isActive && status.limit.derivedFrom === null,
    ).length;
    router.push(canCreateLimit(activeCount) ? "/plan/limits/new" : "/plan/limits/new?gated=1");
  };

  // "Show warnings on gaps between other created limits" (owner, 2026-08-20).
  //
  // ONLY LIMITS THE USER IS ACTUALLY HELD TO. A paused limit (percent-of-income
  // with no usable income) has no base to compare, and an inactive one is not
  // being enforced — warning that a limit nobody is measuring against disagrees
  // with one that is would be noise.
  const gaps = findLimitGaps(
    (statuses ?? [])
      .filter((status) => status.limit.isActive && !status.paused && status.base !== null)
      .map((status) => resolvedLimitFrom(status.limit, status.base!)),
  );

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
        {/* ABOVE THE CARDS, NOT INSIDE ONE. A gap is a statement about a PAIR
            of limits, so it belongs to neither card — putting it on one would
            make the same disagreement read as that limit's fault. */}
        {gaps.map((gap) => (
          <View
            key={`${gap.kind}-${gap.shorterId}-${gap.longerId}`}
            testID={`limit-gap-${gap.kind}`}
            className={`rounded-xl p-3 ${
              gap.kind === "contradiction"
                ? "bg-brand-soft dark:bg-brand-soft-dark"
                : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text className="text-fg dark:text-fg-dark">{gap.message}</Text>
          </View>
        ))}
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
