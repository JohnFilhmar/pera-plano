// app/(tabs)/plan/limits/new.tsx — create a Limit (m2 Task 8;
// docs/04-features/03-limits.md "Flow: create a Limit", steps 1-7).
//
// PERCENT IS ENTERED AS A PERCENTAGE AND STORED AS PERCENT × 100. `Limit.value`
// is "percent × 100 as an integer (12.5% -> 1250)" per types/domain.ts — kept
// integer so nothing money-adjacent is a float. The m2 plan's own snippet does
// `Math.round(Number(percent))`, which stores 20 for 20% and makes every
// percent-of-income limit a hundredth of its real size, with nothing throwing.
// The peso field has the same shape of hazard from the other direction, which
// is why it goes through `centavosFrom` rather than `Number(x) * 100`
// (`12.34 * 100 === 1233.9999...`).
//
// BOTH FIELDS ARE KEYED ON THE SHARED PANEL SINCE numeric-input-system W1,
// and the peso one changed MEANING with it: `centavosFrom` reads the keys as
// PESOS, so "8000" is ₱8,000.00 rather than the ₱80.00 the old
// centavos-by-digit field made of it. A fraction exists only when the user
// presses the decimal key.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCentavos } from "@/components/ui/amount_text";
import { FormScreen } from "@/components/ui/form_screen";
import { NumericField } from "@/components/ui/numeric_field";
import { useCreateLimit } from "@/hooks/mutations/use_create_limit";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { percentToValue } from "@/lib/limits/limit_input";
import { centavosFrom } from "@/lib/money/peso_input";
import type { LimitBasis, LimitScope } from "@/types/domain";

const SCOPES: readonly LimitScope[] = ["daily", "weekly", "monthly", "annual"];

const SCOPE_LABEL: Record<LimitScope, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

export default function NewLimitScreen() {
  const router = useRouter();
  const { gated } = useLocalSearchParams<{ gated?: string }>();
  const create = useCreateLimit();
  const { data: income } = useIncomeSummary();

  const [scope, setScope] = useState<LimitScope>("monthly");
  const [basis, setBasis] = useState<LimitBasis>("fixed");
  const [pesoText, setPesoText] = useState("");
  const [percentText, setPercentText] = useState("");
  const [rollover, setRollover] = useState(false);

  // Limits rule 12's "usable IncomeProfile": a monthly-equivalent figure the
  // app can actually multiply. Anything else — unknown, or an amount it has not
  // worked out yet — means a percent limit cannot be saved as active (spec
  // step 3). Replaces the hardcoded `false` this screen shipped with in m2
  // Task 8, before the income service existed.
  const incomeUsable = (income?.monthlyEquivalent ?? null) !== null;

  if (gated === "1") {
    return (
      <View testID="limits-gated" className="flex-1 items-center justify-center bg-bg p-6 dark:bg-bg-dark">
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Limit cap reached</Text>
        {/* Constraint 11: a cap blocks creation and never deletes anything. */}
        <Text className="mt-2 text-center text-fg-2 dark:text-fg-2-dark">
          Free keeps one active limit, and your existing limits stay exactly as they are. Plus
          removes the cap and adds per-category limits.
        </Text>
      </View>
    );
  }

  const percentBlocked = basis === "percent-of-income" && !incomeUsable;
  const value = basis === "fixed" ? centavosFrom(pesoText) : percentToValue(percentText);
  // `value > 0` is 001_core.sql's own CHECK. Blocking here turns a database
  // constraint violation into a disabled button.
  const canSave = !percentBlocked && value > 0 && !create.isPending;

  const onSave = async () => {
    if (!canSave) return;
    await create.mutateAsync({ scope, basis, value, rollover });
    router.back();
  };

  return (
    // NO ScrollView HERE (numeric-input-system Task 12). FormScreen IS a
    // keyboard-aware scroll view; nesting it inside another one left the
    // OUTER one — which knows nothing about the keypad's height — as the only
    // one with real scroll range, so the avoidance became a no-op. Same fix
    // as app/(tabs)/plan/bills/new.tsx and loans/new.tsx.
    //
    // gap-6/bg-bg/px-4/pt-4 move in from that wrapper's contentContainer.
    // pt-4 is a bare utility rather than insets.top: (tabs)/_layout.tsx
    // already insets every tab-nested screen's top edge in one place. No
    // bottom padding — FormScreen's contentContainerStyle owns that edge, so
    // a symmetric p-4 would double-count it.
    <FormScreen testID="limit-new">
      <View className="gap-6 bg-bg px-4 pt-4 dark:bg-bg-dark">
        <View>
          <Text className="font-semibold text-fg dark:text-fg-dark">Period</Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {SCOPES.map((option) => (
              <Pressable
                key={option}
                testID={`limit-scope-${option}`}
                onPress={() => setScope(option)}
                className={`rounded-full px-4 py-2 ${
                  scope === option
                    ? "bg-brand dark:bg-brand-dark"
                    : "bg-surface dark:bg-surface-dark"
                }`}
              >
                <Text
                  className={
                    scope === option
                      ? "text-surface dark:text-surface-dark"
                      : "text-fg dark:text-fg-dark"
                  }
                >
                  {SCOPE_LABEL[option]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Text className="font-semibold text-fg dark:text-fg-dark">Basis</Text>
          <View className="mt-2 flex-row gap-2">
            <Pressable
              testID="limit-basis-fixed"
              onPress={() => setBasis("fixed")}
              className={`rounded-full px-4 py-2 ${
                basis === "fixed"
                  ? "bg-brand dark:bg-brand-dark"
                  : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text
                className={
                  basis === "fixed"
                    ? "text-surface dark:text-surface-dark"
                    : "text-fg dark:text-fg-dark"
                }
              >
                Fixed ₱
              </Text>
            </Pressable>
            <Pressable
              testID="limit-basis-percent"
              onPress={() => setBasis("percent-of-income")}
              className={`rounded-full px-4 py-2 ${
                basis === "percent-of-income"
                  ? "bg-brand dark:bg-brand-dark"
                  : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text
                className={
                  basis === "percent-of-income"
                    ? "text-surface dark:text-surface-dark"
                    : "text-fg dark:text-fg-dark"
                }
              >
                % of income
              </Text>
            </Pressable>
          </View>

          {basis === "fixed" ? (
            <>
              <NumericField
                testID="limit-amount"
                label="Limit amount"
                mode="peso"
                placeholder="Amount, e.g. 8000"
                value={pesoText}
                onChangeText={setPesoText}
              />
              {/* The field itself shows what has been KEYED (₱8,000 while
                  typing); this line states the same figure the way the row
                  will be stored, centavos and all, before the user commits
                  to it. */}
              <Text testID="limit-amount-preview" className="mt-2 text-fg-2 dark:text-fg-2-dark">
                {formatCentavos(centavosFrom(pesoText))}
              </Text>
            </>
          ) : (
            // `rate`, not `peso`: a percent is not money, so the panel's
            // read-out suffixes a % instead of prefixing a ₱ and grouping.
            <NumericField
              testID="limit-percent"
              label="Percent of income"
              mode="rate"
              placeholder="Percent of income, e.g. 20"
              value={percentText}
              onChangeText={setPercentText}
            />
          )}

          {percentBlocked ? (
            <Card variant="flat">
              <Text testID="limit-percent-blocked" className="text-fg dark:text-fg-dark">
                Percent-of-income needs to know what you earn. Set your income now, or use a fixed
                amount instead — you can change this limit later either way.
              </Text>
              {/* Spec step 3 offers exactly two ways out: "declare income now
                  (opens the income flow) or switch to fixed". Both are here. */}
              <View className="mt-3">
                <Button
                  title="Set my income"
                  variant="secondary"
                  testID="limit-declare-income"
                  onPress={() => router.push("/plan/income")}
                />
              </View>
            </Card>
          ) : null}
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="font-semibold text-fg dark:text-fg-dark">Rollover</Text>
            {/* Spec step 5 asks for "a one-line explanation of the rollover
                rule". Both halves matter: it carries forward, and it never
                stacks (rules 14-16). */}
            <Text className="text-fg-2 dark:text-fg-2-dark">
              Unused headroom carries into the next period — at most one period&apos;s worth, never
              stacking.
            </Text>
          </View>
          <Switch testID="limit-rollover" value={rollover} onValueChange={setRollover} />
        </View>

        <Button
          title="Save"
          testID="limit-save"
          onPress={onSave}
          disabled={!canSave}
          loading={create.isPending}
        />
      </View>
    </FormScreen>
  );
}
