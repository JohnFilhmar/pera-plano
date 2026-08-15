// app/(tabs)/plan/limits/new.tsx — create a Limit (m2 Task 8;
// docs/04-features/03-limits.md "Flow: create a Limit", steps 1-7).
//
// PERCENT IS ENTERED AS A PERCENTAGE AND STORED AS PERCENT × 100. `Limit.value`
// is "percent × 100 as an integer (12.5% -> 1250)" per types/domain.ts — kept
// integer so nothing money-adjacent is a float. The m2 plan's own snippet does
// `Math.round(Number(percent))`, which stores 20 for 20% and makes every
// percent-of-income limit a hundredth of its real size, with nothing throwing.
// The peso field has the same shape of hazard from the other direction, which
// is why it goes through `centavosFromDigits` rather than `Number(x) * 100`
// (`12.34 * 100 === 1233.9999...`).
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { centavosFromDigits, formatCentavos } from "@/components/ui/amount_text";
import { useCreateLimit } from "@/hooks/mutations/use_create_limit";
import { percentToValue } from "@/lib/limits/limit_input";
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

  const [scope, setScope] = useState<LimitScope>("monthly");
  const [basis, setBasis] = useState<LimitBasis>("fixed");
  const [pesoDigits, setPesoDigits] = useState("");
  const [percentText, setPercentText] = useState("");
  const [rollover, setRollover] = useState(false);

  // Wired to the IncomeProfile in m2-part2 Task 12. Until then a
  // percent-of-income limit cannot be created at all, which is the correct
  // conservative state: spec step 3 says it "cannot be saved as active without"
  // a usable income, and the app cannot yet tell whether one exists.
  const incomeUsable = false;

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
  const value = basis === "fixed" ? centavosFromDigits(pesoDigits) : percentToValue(percentText);
  // `value > 0` is 001_core.sql's own CHECK. Blocking here turns a database
  // constraint violation into a disabled button.
  const canSave = !percentBlocked && value > 0 && !create.isPending;

  const onSave = async () => {
    if (!canSave) return;
    await create.mutateAsync({ scope, basis, value, rollover });
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-bg dark:bg-bg-dark" contentContainerClassName="gap-6 p-4">
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
              basis === "fixed" ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"
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
            <TextInput
              testID="limit-amount"
              className="mt-3 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
              keyboardType="numeric"
              placeholder="Amount, e.g. 8000"
              value={pesoDigits}
              onChangeText={setPesoDigits}
            />
            {/* Echoed back formatted, because the field takes DIGITS: typing
                8000 means ₱80.00, and a user who expected ₱8,000.00 has to be
                able to see the difference before saving. */}
            <Text testID="limit-amount-preview" className="mt-2 text-fg-2 dark:text-fg-2-dark">
              {formatCentavos(centavosFromDigits(pesoDigits))}
            </Text>
          </>
        ) : (
          <TextInput
            testID="limit-percent"
            className="mt-3 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
            keyboardType="numeric"
            placeholder="Percent of income, e.g. 20"
            value={percentText}
            onChangeText={setPercentText}
          />
        )}

        {percentBlocked ? (
          <Card variant="flat">
            <Text testID="limit-percent-blocked" className="text-fg dark:text-fg-dark">
              Percent-of-income needs a declared income. Switch to a fixed amount for now — you
              can change this limit once your income is set up.
            </Text>
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
    </ScrollView>
  );
}
