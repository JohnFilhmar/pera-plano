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
// THE PERCENT BASIS IS ALWAYS ON THE SCREEN (owner, 2026-08-26: the step "is
// missing the % input"). It used to be hidden outright whenever no income was
// known — rule 5 read as "offer it only once income exists" — and since the
// income step is skippable, and detection may not have worked a figure out
// yet, the practical result was a first-Limit step that offered no percentage
// at all to most users. The rule it was protecting is real (a percent limit
// cannot RESOLVE without income: `baseFor` returns null), but hiding the
// control is the wrong way to say so: the user cannot see what they are
// missing, or how to get it.
//
// So this step now behaves exactly like Plan's own Limit editor
// (components/limits/limit_form.tsx), which has always shown both bases:
// picking "% of income" with no income known blocks the SAVE and explains it,
// with the same two exits — declare income now (this step routes back to
// onboarding's income step) or switch back to a fixed peso amount.
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
import { Text, View } from "react-native";

import { LimitPreview } from "@/components/limits/limit_preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumericField } from "@/components/ui/numeric_field";
import { SegmentedControl } from "@/components/ui/segmented_control";
import { percentToValue } from "@/lib/limits/limit_input";
import { centavosFrom } from "@/lib/money/peso_input";
import type { Centavos, LimitBasis, LimitScope } from "@/types/domain";

/**
 * The basis toggle's OWN value space — deliberately not `LimitBasis` itself.
 * `SegmentedControl` derives each segment's `testID` as `${controlID}-${value}`,
 * and this screen's pinned testIDs are `first-limit-basis-fixed` /
 * `first-limit-basis-percent` (components/onboarding/__tests__/
 * first_limit_step.test.tsx, out of this task's file list). `LimitBasis`'s own
 * `"percent-of-income"` would derive `first-limit-basis-percent-of-income`
 * instead — a silent testID rename, which this revamp may not do anywhere.
 * Translating one short-lived local union at the two call sites below is
 * cheaper than that, and keeps `LimitBasis` itself exactly what the domain
 * layer already agrees it means.
 */
type BasisSegment = "fixed" | "percent";

function toLimitBasis(segment: BasisSegment): LimitBasis {
  return segment === "percent" ? "percent-of-income" : "fixed";
}

function toBasisSegment(basis: LimitBasis): BasisSegment {
  return basis === "percent-of-income" ? "percent" : "fixed";
}

/**
 * BOTH SEGMENTS, UNCONDITIONALLY. This list used to be rebuilt each render with
 * "% of income" dropped whenever no income was known, which is how the option
 * disappeared for every user who skipped the income step (or let detection
 * work it out later) — the report this change answers. Plan's own Limit editor
 * has always shown both and explained the block instead
 * (components/limits/limit_form.tsx's `percentBlocked` card); onboarding now
 * does the same, and can send the user back to the income step to unblock it.
 */
const BASIS_SEGMENTS = [
  { value: "fixed", label: "Fixed ₱" },
  { value: "percent", label: "% of income" },
] as const satisfies ReadonlyArray<{ value: BasisSegment; label: string }>;

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

export type FirstLimitFormProps = {
  /** Monthly-equivalent income, or `null` when none is known yet. */
  monthlyIncome: Centavos | null;
  busy?: boolean;
  onSubmit: (values: FirstLimitFormValues) => void;
  /**
   * Sends the user back to the onboarding income step from the percent-blocked
   * card. Optional only so the presentational tests can mount this form bare;
   * the route always supplies it.
   */
  onDeclareIncome?: () => void;
};

export function FirstLimitForm({
  monthlyIncome,
  busy = false,
  onSubmit,
  onDeclareIncome,
}: FirstLimitFormProps) {
  const [basis, setBasis] = useState<LimitBasis>("fixed");
  const [scope, setScope] = useState<LimitScope>("monthly");
  const [pesoText, setPesoText] = useState("");
  const [percentText, setPercentText] = useState("");

  const percentAvailable = monthlyIncome !== null;
  // The percent OPTION is always offered; what income decides is whether a
  // percent limit can be RESOLVED yet — see this file's header.
  const percentBlocked = basis === "percent-of-income" && !percentAvailable;

  const value = basis === "fixed" ? centavosFrom(pesoText) : percentToValue(percentText);

  // THE PREVIEW SENTENCE ITSELF NOW LIVES IN components/limits/limit_preview.tsx,
  // rendered below. The arithmetic that used to sit here (`baseFor` for one
  // period, `dailyRateOf` for the per-day restatement) moved there unchanged so
  // Plan's Limit editor can show the SAME sentence for a percent-of-income
  // limit rather than a second, hand-written copy of it.

  // `value > 0` is 001_core.sql's own CHECK, and a percent with no income has
  // no base to measure against (`baseFor` returns null) — Plan's own editor
  // blocks the identical pair, so the two screens refuse the same saves.
  const canSave = !percentBlocked && value > 0 && !busy;

  return (
    <View className="gap-6">
      <Text
        testID="first-limit-form-intro"
        className="text-body font-medium text-fg-2 dark:text-fg-2-dark"
      >
        A spending Limit is the simplest guardrail — you can refine it any time in Plan.
      </Text>

      {/* THE CADENCE, ASKED RATHER THAN ASSUMED (owner, 2026-08-20). Monthly
          stays preselected — docs rule 14's default — but a user who thinks in
          weeks no longer has to enter a monthly figure and convert it in their
          head, then find they cannot change it afterwards. `LimitScope`'s own
          values ("daily"/"weekly"/"monthly"/"annual") already match this
          screen's pinned `first-limit-scope-*` testIDs, so this segment's
          value IS the domain type — no translation layer needed here, unlike
          the basis control below. */}
      <SegmentedControl
        testID="first-limit-scope"
        segments={SCOPES.map((option) => ({ value: option, label: SCOPE_CHIP[option] }))}
        value={scope}
        onChange={setScope}
      />

      {/* BOTH SEGMENTS, ALWAYS — see this file's header. Whether income is
          known changes what happens AFTER "% of income" is picked, never
          whether the choice is on the screen. */}
      <SegmentedControl
        testID="first-limit-basis"
        segments={BASIS_SEGMENTS}
        value={toBasisSegment(basis)}
        onChange={(segment) => setBasis(toLimitBasis(segment))}
      />

      {!percentAvailable ? (
        <Text
          testID="first-limit-no-income-note"
          className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
        >
          PeraPlano doesn&apos;t know your income yet. Pick &ldquo;% of income&rdquo; and you can
          set it right here, or keep a fixed peso amount and switch later.
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
          keystroke. A percent limit with no income has no sentence to show:
          `baseFor` returns null there, and "₱0.00 every month" would be a
          figure the app cannot stand behind, so the way out is shown instead —
          the same two exits Plan's editor offers (declare income, or switch
          back to a fixed amount). */}
      {percentBlocked ? (
        <Card variant="flat">
          <Text testID="first-limit-percent-blocked" className="text-fg dark:text-fg-dark">
            A percentage needs to know what you earn. Tell PeraPlano your income and this Limit
            follows your pay — or use a fixed peso amount instead. Either one is editable later in
            Plan.
          </Text>
          {onDeclareIncome ? (
            <View className="mt-3">
              <Button
                title="Set my income"
                variant="secondary"
                testID="first-limit-declare-income"
                onPress={onDeclareIncome}
              />
            </View>
          ) : null}
        </Card>
      ) : (
        <LimitPreview
          testID="first-limit-preview"
          basis={basis}
          value={value}
          scope={scope}
          monthlyIncome={monthlyIncome}
        />
      )}

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
