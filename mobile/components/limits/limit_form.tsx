// components/limits/limit_form.tsx — the Limit editor, extracted from
// app/(tabs)/plan/limits/new.tsx so CREATE and EDIT are the same form.
//
// WHY EXTRACT RATHER THAN COPY. The owner's report is that limits "should still
// be modifiable"; the create screen already had every control an edit needs.
// A second hand-written copy on the edit route is how the two drift — one
// gaining the percent-of-income guard, the other keeping the old rollover copy
// — and a limit edited on a screen that disagrees with the one it was created
// on is a bug the user has no way to explain.
//
// PERCENT IS ENTERED AS A PERCENTAGE AND STORED AS PERCENT × 100, carried over
// from the create screen verbatim. `Limit.value` is "percent × 100 as an
// integer (12.5% -> 1250)" per types/domain.ts — kept integer so nothing
// money-adjacent is a float. The m2 plan's own snippet does
// `Math.round(Number(percent))`, which stores 20 for 20% and makes every
// percent-of-income limit a hundredth of its real size, with nothing throwing.
// The peso field has the same hazard from the other direction, which is why it
// goes through `centavosFrom` rather than `Number(x) * 100`
// (`12.34 * 100 === 1233.9999...`).
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCentavos } from "@/components/ui/amount_text";
import { NumericField } from "@/components/ui/numeric_field";
import { percentToValue, valueToPercent } from "@/lib/limits/limit_input";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type { Limit, LimitBasis, LimitScope } from "@/types/domain";

const SCOPES: readonly LimitScope[] = ["daily", "weekly", "monthly", "annual"];

export const SCOPE_LABEL: Record<LimitScope, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

export type LimitFormValues = {
  scope: LimitScope;
  basis: LimitBasis;
  /** Centavos for `fixed`; percent × 100 for `percent-of-income`. */
  value: number;
  rollover: boolean;
};

export type LimitFormProps = {
  onSubmit: (values: LimitFormValues) => void;
  /** True when the app knows a monthly-equivalent income it can multiply. */
  incomeUsable: boolean;
  /** Opens the income flow from the percent-of-income guard. */
  onDeclareIncome: () => void;
  busy?: boolean;
  initial?: Partial<LimitFormValues>;
  submitLabel?: string;
  testID?: string;
};

/**
 * The form's own text seed for whichever field the basis uses.
 *
 * SPLIT BY BASIS BECAUSE THE UNITS ARE NOT THE SAME. `value` is centavos under
 * `fixed` and percent × 100 under `percent-of-income`, so one shared
 * `String(value)` would seed an 8,000-peso limit as "800000" AND a 20% limit as
 * "2000". Each goes through the converter that owns its unit.
 */
function seedFor(basis: LimitBasis, value: number | undefined): { peso: string; percent: string } {
  if (value === undefined) return { peso: "", percent: "" };
  return basis === "fixed"
    ? { peso: pesoInputFrom(value), percent: "" }
    : { peso: "", percent: valueToPercent(value) };
}

export function LimitForm({
  onSubmit,
  incomeUsable,
  onDeclareIncome,
  busy = false,
  initial,
  submitLabel = "Save",
  testID = "limit-form",
}: LimitFormProps) {
  const [scope, setScope] = useState<LimitScope>(initial?.scope ?? "monthly");
  const [basis, setBasis] = useState<LimitBasis>(initial?.basis ?? "fixed");
  const seed = seedFor(initial?.basis ?? "fixed", initial?.value);
  const [pesoText, setPesoText] = useState(seed.peso);
  const [percentText, setPercentText] = useState(seed.percent);
  const [rollover, setRollover] = useState(initial?.rollover ?? false);

  const percentBlocked = basis === "percent-of-income" && !incomeUsable;
  const value = basis === "fixed" ? centavosFrom(pesoText) : percentToValue(percentText);
  // `value > 0` is 001_core.sql's own CHECK. Blocking here turns a database
  // constraint violation into a disabled button.
  const canSave = !percentBlocked && value > 0 && !busy;

  return (
    <View testID={testID} className="gap-6 bg-bg px-4 pt-4 dark:bg-bg-dark">
      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">Period</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {SCOPES.map((option) => (
            <Pressable
              key={option}
              testID={`limit-scope-${option}`}
              onPress={() => setScope(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === option }}
              className={`rounded-full px-4 py-2 ${
                scope === option ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text
                className={
                  scope === option
                    ? "text-on-brand dark:text-on-brand-dark"
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
            accessibilityRole="button"
            accessibilityState={{ selected: basis === "fixed" }}
            className={`rounded-full px-4 py-2 ${
              basis === "fixed" ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text
              className={
                basis === "fixed"
                  ? "text-on-brand dark:text-on-brand-dark"
                  : "text-fg dark:text-fg-dark"
              }
            >
              Fixed ₱
            </Text>
          </Pressable>
          <Pressable
            testID="limit-basis-percent"
            onPress={() => setBasis("percent-of-income")}
            accessibilityRole="button"
            accessibilityState={{ selected: basis === "percent-of-income" }}
            className={`rounded-full px-4 py-2 ${
              basis === "percent-of-income"
                ? "bg-brand dark:bg-brand-dark"
                : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text
              className={
                basis === "percent-of-income"
                  ? "text-on-brand dark:text-on-brand-dark"
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
                typing); this line states the same figure the way the row will
                be stored, centavos and all, before the user commits to it. */}
            <Text testID="limit-amount-preview" className="mt-2 text-fg-2 dark:text-fg-2-dark">
              {formatCentavos(centavosFrom(pesoText))}
            </Text>
          </>
        ) : (
          // `rate`, not `peso`: a percent is not money, so the panel's read-out
          // suffixes a % instead of prefixing a ₱ and grouping.
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
                onPress={onDeclareIncome}
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
        title={submitLabel}
        testID="limit-save"
        onPress={() => canSave && onSubmit({ scope, basis, value, rollover })}
        disabled={!canSave}
        loading={busy}
      />
    </View>
  );
}

/** Seeds this form from a stored limit. */
export function limitFormInitialFrom(limit: Limit): Partial<LimitFormValues> {
  return {
    scope: limit.scope,
    basis: limit.basis,
    value: limit.value,
    rollover: limit.rollover,
  };
}
