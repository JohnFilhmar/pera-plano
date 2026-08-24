// components/plan/limits_panel.tsx — the Limits list (m2 Task 8;
// docs/04-features/03-limits.md "UX states & flows").
//
// A PANEL, NOT A SCREEN. `app/(tabs)/plan/limits.tsx` still exists and still
// renders this panel as a full screen, standalone: Plan's segmented control
// (`app/(tabs)/plan/index.tsx`, mobile-ui-revamp Part 2 Task 7) swaps panels
// in place without navigating, but `/plan/limits` stays a real, routable
// stack screen too. `limits/[id].tsx` pops back to it with `router.back()`;
// Home (`app/(tabs)/index.tsx`) pushes straight to `/plan/limits/[id]` from
// its alert cards and limit-progress list; and a coalesced limit-alert
// notification resolves to the bare `/plan/limits` itself
// (`lib/alerts/alert_routes.ts`). Deleting the route would strand all three
// (revamp spec R4) — which is also why this panel keeps its own `ScrollView`
// below rather than relying on one hoisted up to the segmented host: the
// standalone route above has no scroller of its own to fall back on.
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
//
// THE INCOME ROW IS UNCONDITIONAL (mobile-ui-revamp Part 2 Task 7). It sits
// above the loading/empty/loaded branches below, not inside any one of them,
// because a percent-of-income Limit reads directly from this figure — the
// placement is what says Income lives under Limits rather than beside it as
// its own segment. The figure itself follows `getIncomeSummary`'s own rule
// (lib/income/income_service.ts decision 3): `monthlyEquivalent` is `null`,
// never a silent zero, whenever income is unresolved OR genuinely unknown, so
// this row shows the "Take-home" label alone in both of those cases rather
// than ever printing ₱0.00 — a real claim about a real number the app does
// not have. `formatCentavos` is called directly instead of reaching for
// `<AmountText>`: nesting AmountText inside this row's own styled `<Text>`
// would let AmountText's unconditional colour and size win silently, and the
// row's semibold styling would never actually land.
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { LimitCard } from "@/components/limits/limit_card";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button, registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useCategories } from "@/hooks/queries/use_categories";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { canCreateLimit } from "@/lib/entitlements";
import { findLimitGaps, resolvedLimitFrom } from "@/lib/limits/limit_consistency";
import { limitDisplayName } from "@/lib/limits/limit_label";
import type { LimitStatus } from "@/lib/limits/limit_service";

const ChevronGlyph = registerIcon(ChevronRight);

/**
 * TalkBack has nothing to read off a bare row (F5) — this states what
 * `LimitCard` beside it draws: the cap's name, and its spend against the
 * effective limit, in the same "X of Y spent" shape the card's own cap line
 * uses. Paused/inactive limits have no effective limit to divide against
 * (`LimitCard`'s own `measuring` guard), so those two states get a shorter,
 * still-true label instead of a fraction the data cannot back.
 */
function limitRowAccessibilityLabel(name: string, status: LimitStatus): string {
  if (status.uiState === "inactive") return `${name}, inactive`;
  if (status.uiState === "paused") return `${name}, paused`;

  const spend = formatCentavos(status.spend);
  const cap = formatCentavos(status.effectiveLimit ?? 0);
  return status.uiState === "over"
    ? `${name}, over limit, ${spend} of ${cap} spent`
    : `${name}, ${spend} of ${cap} spent`;
}

export function LimitsPanel() {
  const router = useRouter();
  const { data: statuses } = useLimitStatuses();
  const { data: categories } = useCategories();
  const { data: income } = useIncomeSummary();

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

  // `null` while the query is still in flight AND while it has resolved to
  // "unknown" — both cases render the row's label rather than a number, so
  // they are deliberately collapsed into the same value here.
  const monthlyIncome = income?.monthlyEquivalent ?? null;

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <Pressable
        testID="plan-income-row"
        accessibilityRole="button"
        accessibilityLabel="Income"
        onPress={() => router.push("/plan/income")}
        className="mx-4 mb-3 mt-4"
      >
        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text
                className="text-row font-semibold text-fg dark:text-fg-dark"
                style={monthlyIncome === null ? undefined : { fontVariant: ["tabular-nums"] }}
              >
                {monthlyIncome === null ? "Take-home" : formatCentavos(monthlyIncome)}
              </Text>
              <Text className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
                Powers %-of-income limits and the period
              </Text>
            </View>
            <ChevronGlyph size={18} className="text-fg-2 dark:text-fg-2-dark" />
          </View>
        </Card>
      </Pressable>

      {/* Render nothing until the list has loaded. An empty state that
          flashes on every cold start reads as data loss — the same rule the
          Wallets tab keeps. The income row above is unaffected by this: it
          has its own loading rule (see this file's header) and is never
          gated behind the limits list resolving. */}
      {statuses === undefined ? (
        <View testID="limits-loading" className="flex-1 bg-bg dark:bg-bg-dark">
          <LoadingSkeleton rows={5} />
        </View>
      ) : statuses.length === 0 ? (
        <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
          {/* The spec's UX-states table string, not the plan's. */}
          <EmptyState
            testID="limits-empty"
            title="Set your first limit"
            body="A cap on spending for a day, week, month, or year — PeraPlano watches it for you."
            action={{ label: "Add a limit", onPress: onAdd }}
          />
        </View>
      ) : (
        <>
          <ScrollView contentContainerClassName="gap-3 p-4">
            {/* ABOVE THE CARDS, NOT INSIDE ONE. A gap is a statement about a
                PAIR of limits, so it belongs to neither card — putting it on
                one would make the same disagreement read as that limit's
                fault. */}
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
            {statuses.map((status) => {
              const name = limitDisplayName(status.limit, categoryNames);
              return (
                <Pressable
                  key={status.limit.id}
                  testID={`limit-row-${status.limit.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={limitRowAccessibilityLabel(name, status)}
                  onPress={() =>
                    router.push({ pathname: "/plan/limits/[id]", params: { id: status.limit.id } })
                  }
                >
                  <LimitCard
                    testID={`limit-card-${status.limit.id}`}
                    name={name}
                    spend={status.spend}
                    effectiveLimit={status.effectiveLimit}
                    daysLeft={status.window.daysLeft}
                    uiState={status.uiState}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          <View className="absolute bottom-6 right-6">
            <Button title="Add" onPress={onAdd} testID="limits-add" />
          </View>
        </>
      )}
    </View>
  );
}
