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
// SCOPE IS ASKED, AND USED TO BE PINNED (owner, 2026-08-20). The report: the
// onboarding limit is "unmodifiable and it should be modifiable to change it to
// daily, weekly, monthly, or annually". docs rule 14's "the first Limit
// defaults to scope: monthly" is honoured as a DEFAULT — monthly is the
// preselected chip — rather than as the only option, which is what it had
// become in practice.
//
// THE PER-DAY APPROXIMATION IS NO LONGER A FIXED `÷ 30`. That divisor was only
// correct while monthly was the sole cadence; the figures now come from
// `baseFor` and `dailyRateOf`, which carry the engine's own 12/52/365
// conventions — so the sentence this screen shows and the limit the app later
// enforces cannot disagree.
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
import { dailyRateOf } from "@/lib/limits/limit_derivation";
import { baseFor } from "@/lib/limits/limit_engine";
import { percentToValue } from "@/lib/limits/limit_input";
import { centavosFrom } from "@/lib/money/peso_input";
import type { Centavos, LimitBasis, LimitScope } from "@/types/domain";

export type FirstLimitFormValues = {
  basis: LimitBasis;
  /** Centavos for `fixed`; percent × 100 as an integer for `percent-of-income`. */
  value: number;
  /**
   * WAS HARDCODED TO `monthly` AND IS NOW ASKED (owner, 2026-08-20: the
   * onboarding limit is "unmodifiable and it should be modifiable to change it
   * to daily, weekly, monthly, or annually").
   *
   * docs rule 14's "the first Limit defaults to scope: monthly" is kept as a
   * DEFAULT — monthly is still the preselected chip — rather than as the only
   * option, which is what it had become in practice.
   */
  scope: LimitScope;
};

const SCOPES: readonly LimitScope[] = ["daily", "weekly", "monthly", "annual"];

const SCOPE_CHIP: Record<LimitScope, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

/** How the preview sentence names the period. */
const SCOPE_EVERY: Record<LimitScope, string> = {
  daily: "every day",
  weekly: "every week",
  monthly: "every month",
  annual: "every year",
};

export type FirstLimitFormProps = {
  /** Monthly-equivalent income, or `null` when none was declared (rule 5). */
  monthlyIncome: Centavos | null;
  busy?: boolean;
  onSubmit: (values: FirstLimitFormValues) => void;
};

export function FirstLimitForm({ monthlyIncome, busy = false, onSubmit }: FirstLimitFormProps) {
  const [basis, setBasis] = useState<LimitBasis>("fixed");
  const [scope, setScope] = useState<LimitScope>("monthly");
  const [pesoText, setPesoText] = useState("");
  const [percentText, setPercentText] = useState("");

  const percentAvailable = monthlyIncome !== null;

  const value = basis === "fixed" ? centavosFrom(pesoText) : percentToValue(percentText);

  // WHAT ONE PERIOD IS WORTH IN PESOS, via the ENGINE'S OWN resolver rather
  // than arithmetic repeated here.
  //
  // This used to be `monthlyIncome × percent ÷ 10,000` with a hand-written
  // helper, which was right only because the scope was pinned to monthly. Now
  // that the user picks the cadence, a percent limit resolves differently per
  // scope (`baseFor`: monthly = M×v%, annual = 12M×v%, weekly = (12M÷52)×v%,
  // daily = (12M÷365)×v%) — and the one place that already knows those four
  // formulas is the engine that will enforce the limit afterwards. Asking it
  // means the sentence this screen shows and the limit the app later measures
  // cannot say different things.
  const periodValue = baseFor({ basis, value, scope }, monthlyIncome) ?? 0;

  // Rule 4's per-day figure, for any cadence. `dailyRateOf` carries the same
  // 12/52/365 conventions as `baseFor` above, so the two halves of the sentence
  // agree; the old fixed `÷ 30` only worked while monthly was the only option.
  const dailyValue = Math.round(dailyRateOf(scope, periodValue));

  const canSave = value > 0 && !busy;

  function chooseBasis(next: LimitBasis): void {
    if (next === "percent-of-income" && !percentAvailable) return;
    setBasis(next);
  }

  return (
    <View className="gap-6">
      <Text testID="first-limit-form-intro" className="text-fg-2 dark:text-fg-2-dark">
        A spending Limit is the simplest guardrail — you can refine it any time in Plan.
      </Text>

      {/* THE CADENCE, ASKED RATHER THAN ASSUMED (owner, 2026-08-20). Monthly
          stays preselected — docs rule 14's default — but a user who thinks in
          weeks no longer has to enter a monthly figure and convert it in their
          head, then find they cannot change it afterwards. */}
      <View className="flex-row flex-wrap gap-2">
        {SCOPES.map((option) => (
          <Pressable
            key={option}
            testID={`first-limit-scope-${option}`}
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
              {SCOPE_CHIP[option]}
            </Text>
          </Pressable>
        ))}
      </View>

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
          // The panel's header names the cadence the user picked, so a keypad
          // opened over a "Weekly limit" does not still say "Monthly limit".
          label={`${SCOPE_CHIP[scope]} limit`}
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
        {scope === "daily"
          ? // "…every day is about ₱X a day" says the same thing twice. On the
            // daily cadence the figure IS the daily figure, so the sentence
            // stops there rather than restating itself.
            `${formatCentavos(periodValue)} every day.`
          : `${formatCentavos(periodValue)} ${SCOPE_EVERY[scope]} is about ${formatCentavos(
              dailyValue,
            )} a day.`}
      </Text>

      <Button
        title="Set this Limit"
        testID="first-limit-save"
        disabled={!canSave}
        loading={busy}
        onPress={() => onSubmit({ basis, value, scope })}
      />
    </View>
  );
}
