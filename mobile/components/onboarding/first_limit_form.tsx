// components/onboarding/first_limit_form.tsx — the onboarding first-Limit
// step's content (m3c-onboarding-client plan Task 3, rules 4-5;
// docs/04-features/01-onboarding.md step 9).
//
// THE LIVE PREVIEW SENTENCE IS THE WHOLE POINT (rule 4). "₱10,000 every month
// is about ₱333 a day" is what turns an abstract monthly figure into
// something a person can compare against a jeepney fare. It updates on every
// keystroke, never only on submit — a sentence that only appears after saving
// has already missed the moment it exists for.
//
// SCOPE IS ALWAYS `monthly`, NOT A CHOICE HERE (docs rule 14: "the first Limit
// defaults to scope: monthly"). The per-day approximation below divides by
// 30 for exactly that reason — a daily figure derived from a weekly or annual
// scope would need a different divisor, and onboarding's first Limit never
// offers those.
//
// PERCENT ONLY WHEN INCOME IS DECLARED (rule 5), hidden rather than shown
// disabled — a greyed-out option a user cannot explain invites a support
// question; an absent one with a one-line reason does not.
//
// THE PERCENT-STORAGE TRAP (task-3-brief's own warning). `Limit.value` for
// `percent-of-income` is percent × 100 as an integer (types/domain.ts); this
// form goes through `percentToValue` — the same helper
// app/(tabs)/plan/limits/new.tsx uses — rather than `Math.round(Number(text))`,
// which would store 20 for a typed "20%": a hundredth of the real limit, with
// nothing that throws.
//
// THE PESO HALF HAS THE SAME SHAPE OF HAZARD FROM THE OTHER DIRECTION, which
// is why it goes through `centavosFrom` (lib/money/peso_input.ts) rather than
// `Number(text) * 100` — `12.34 * 100` is 1233.9999999999998. Since
// numeric-input-system W1 that helper reads the keys as PESOS: "10000" is
// ₱10,000.00, not the ₱100.00 the old centavos-by-digit field made of it.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { NumericField } from "@/components/ui/numeric_field";
import { percentToValue } from "@/lib/limits/limit_input";
import { centavosFrom } from "@/lib/money/peso_input";
import type { Centavos, LimitBasis } from "@/types/domain";

export type FirstLimitFormValues = {
  basis: LimitBasis;
  /** Centavos for `fixed`; percent × 100 as an integer for `percent-of-income`. */
  value: number;
};

export type FirstLimitFormProps = {
  /** Monthly-equivalent income, or `null` when none was declared (rule 5). */
  monthlyIncome: Centavos | null;
  busy?: boolean;
  onSubmit: (values: FirstLimitFormValues) => void;
};

/** `monthlyIncome` × `percentValue` (percent × 100) → centavos, integer
 * throughout — the same reasoning `percentToValue`'s own doc gives for never
 * reaching for a float multiply on money. */
function monthlyFromPercent(monthlyIncome: Centavos, percentValue: number): Centavos {
  return Math.round((monthlyIncome * percentValue) / 10_000);
}

/** A monthly figure's rough daily equivalent — scope is always `monthly`
 * here (docs rule 14), so 30 is the fixed divisor, not a derived one. */
function dailyEquivalent(monthlyValue: Centavos): Centavos {
  return Math.round(monthlyValue / 30);
}

export function FirstLimitForm({ monthlyIncome, busy = false, onSubmit }: FirstLimitFormProps) {
  const [basis, setBasis] = useState<LimitBasis>("fixed");
  const [pesoText, setPesoText] = useState("");
  const [percentText, setPercentText] = useState("");

  const percentAvailable = monthlyIncome !== null;

  const value = basis === "fixed" ? centavosFrom(pesoText) : percentToValue(percentText);

  const monthlyValue =
    basis === "fixed" ? value : monthlyIncome !== null ? monthlyFromPercent(monthlyIncome, value) : 0;

  const canSave = value > 0 && !busy;

  function chooseBasis(next: LimitBasis): void {
    if (next === "percent-of-income" && !percentAvailable) return;
    setBasis(next);
  }

  return (
    <View className="gap-6">
      <Text testID="first-limit-form-intro" className="text-fg-2 dark:text-fg-2-dark">
        A monthly spending Limit is the simplest guardrail — you can refine it any time in Plan.
      </Text>

      <View className="flex-row gap-2">
        <Pressable
          testID="first-limit-basis-fixed"
          onPress={() => chooseBasis("fixed")}
          accessibilityRole="button"
          accessibilityState={{ selected: basis === "fixed" }}
          className={`rounded-full px-4 py-2 ${
            basis === "fixed" ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"
          }`}
        >
          <Text
            className={
              basis === "fixed" ? "text-surface dark:text-surface-dark" : "text-fg dark:text-fg-dark"
            }
          >
            Fixed ₱
          </Text>
        </Pressable>

        {/* Rule 5: hidden, not disabled, when no income was declared — there
            is nothing here for the user to unlock, only a reason to state. */}
        {percentAvailable ? (
          <Pressable
            testID="first-limit-basis-percent"
            onPress={() => chooseBasis("percent-of-income")}
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
                  ? "text-surface dark:text-surface-dark"
                  : "text-fg dark:text-fg-dark"
              }
            >
              % of income
            </Text>
          </Pressable>
        ) : null}
      </View>

      {!percentAvailable ? (
        <Text testID="first-limit-no-income-note" className="text-sm text-fg-2 dark:text-fg-2-dark">
          You haven&apos;t told PeraPlano your income yet, so this Limit is a fixed peso amount.
          Once you do, you can switch it to a percentage any time.
        </Text>
      ) : null}

      {/* TWO MODES, NOT ONE FIELD WITH TWO MEANINGS (numeric-input-system
          Task 12, and the `add-numpad-to-this-section` screenshot it closes).
          `peso` groups the integer part and prefixes ₱; `rate` suffixes a %
          and never formats money. Both are Pressables — there is no TextInput
          left in this form, so the step cannot raise Android's keyboard over
          the panel however it is later edited. */}
      {basis === "fixed" ? (
        <NumericField
          testID="first-limit-amount"
          label="Monthly limit"
          mode="peso"
          placeholder="Amount, e.g. 10000"
          value={pesoText}
          onChangeText={setPesoText}
        />
      ) : (
        <NumericField
          testID="first-limit-percent"
          label="Percent of income"
          mode="rate"
          placeholder="Percent of income, e.g. 20"
          value={percentText}
          onChangeText={setPercentText}
        />
      )}

      {/* Rule 4 — the sentence that makes the abstraction land, live on every
          keystroke. */}
      <Text testID="first-limit-preview" className="text-lg font-semibold text-fg dark:text-fg-dark">
        {`${formatCentavos(monthlyValue)} every month is about ${formatCentavos(
          dailyEquivalent(monthlyValue),
        )} a day.`}
      </Text>

      <Button
        title="Set this Limit"
        testID="first-limit-save"
        disabled={!canSave}
        loading={busy}
        onPress={() => onSubmit({ basis, value })}
      />
    </View>
  );
}
