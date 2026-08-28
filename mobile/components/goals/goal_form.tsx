// components/goals/goal_form.tsx — m2b Task 4, rules 3 and 5.
//
// INLINE SAVINGS-WALLET CREATION IS THE POINT OF RULE 3. A first-time user has
// no savings wallet, and a goal cannot exist without one (invariant I10) — so a
// picker that simply shows nothing is a dead end at the exact moment the user
// decided to start saving. The form offers to make one here.
//
// THE CONTRIBUTION RULE IS PlusGated (rule 5): visible and explained on free,
// active on Plus. Free keeps the goal and its live progress; only the payday
// prompt is a paid capability (docs/05-monetization.md §3.2).
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b) to the field rhythm every plan
// form now shares: a `text-micro font-semibold text-fg-2` label above each
// control, controls on `bg-chip rounded-xl min-h-[44px]`, and the savings
// wallet picker as a `Chip` row rather than hand-rolled pills — the same
// option-group treatment `goal_routes.test.tsx`'s `goal-wallet-${id}` presses
// already exercised and still exercise, unchanged.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DateField } from "@/components/ui/date_field";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type { ContributionRule, IsoDate, Wallet } from "@/types/domain";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

/** Step 2's field rhythm: the label that sits above every control below. */
function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">{children}</Text>
  );
}

export type GoalFormValues = {
  name: string;
  targetAmount: number;
  targetDate: IsoDate | null;
  linkedWalletId: string;
  contributionRule: ContributionRule | null;
};

export type GoalFormProps = {
  /**
   * Savings wallets with no goal yet — the only ones a goal may bind (I10).
   *
   * ON THE EDIT SCREEN THIS MUST ALSO INCLUDE THE GOAL'S OWN WALLET. It is not
   * "free" by that query's definition — this goal is what claims it — but a
   * picker that omits it would show the goal's account as unselected and give
   * the user no way to put it back. `updateGoal` already handles re-saving a
   * goal onto its own wallet without reading it as a collision (see
   * `assertWalletIsFree`'s `exceptGoalId`).
   */
  availableWallets: Wallet[];
  onSubmit: (values: GoalFormValues) => void;
  /** Opens the inline savings-wallet flow (rule 3). */
  onCreateWallet: () => void;
  busy?: boolean;
  /** Seeds every field for the edit screen. Absent means a blank create form. */
  initial?: GoalFormValues;
  submitLabel?: string;
};

export function GoalForm({
  availableWallets,
  onSubmit,
  onCreateWallet,
  busy = false,
  initial,
  submitLabel = "Create goal",
}: GoalFormProps) {
  const placeholderColor = usePlaceholderColor();
  const [name, setName] = useState(initial?.name ?? "");
  // pesoInputFrom, NEVER String() — `targetAmount` is Centavos and this field
  // holds PESO TEXT, so `String(initial.targetAmount)` would seed ₱50,000 as
  // "5000000", a silent 100×. The same note bill_form.tsx and wallet_form.tsx
  // both carry, because the bug has been found more than once in this codebase.
  const [targetText, setTargetText] = useState(
    initial?.targetAmount !== undefined ? pesoInputFrom(initial.targetAmount) : "",
  );
  const [targetDate, setTargetDate] = useState<IsoDate | null>(initial?.targetDate ?? null);
  const [walletId, setWalletId] = useState<string | null>(initial?.linkedWalletId ?? null);
  const [ruleText, setRuleText] = useState(
    initial?.contributionRule?.kind === "fixed" ? pesoInputFrom(initial.contributionRule.amount) : "",
  );

  const targetAmount = centavosFrom(targetText);
  // Rule 3's three requirements, and 001_core.sql's `CHECK (target_amount > 0)`.
  // A disabled button beats a constraint violation surfacing as a crash.
  const canSave = name.trim() !== "" && targetAmount > 0 && walletId !== null && !busy;

  return (
    // bg-bg/px-4/pt-4 move in from the route (numeric-input-system Task 11)
    // now that FormScreen wraps this form there instead of a plain
    // ScrollView. pt-4 is a bare utility, not insets.top: this screen lives
    // inside (tabs)/_layout.tsx's <Tabs>, which already pads every tab
    // screen's top edge for the status bar in one place — pt-4 only restores
    // the 16px breathing room the removed wrapper's p-4 gave on top of that
    // inset. No bottom padding here: FormScreen's contentContainerStyle owns
    // that edge, so a symmetric p-4 would double-count it (Task 9's fix).
    <View className="gap-6 bg-bg px-4 pt-4 dark:bg-bg-dark">
      <View className="gap-1">
        <FieldLabel>What are you saving for?</FieldLabel>
        <TextInput
          placeholderTextColor={placeholderColor}
          testID="goal-name"
          className="min-h-[44px] rounded-xl bg-chip px-3 py-3 text-fg dark:bg-chip-dark dark:text-fg-dark"
          placeholder="Emergency fund"
          value={name}
          onChangeText={setName}
        />
      </View>

      <View className="gap-1">
        <FieldLabel>How much?</FieldLabel>
        <NumericField
          testID="goal-target"
          label="How much?"
          mode="peso"
          placeholder="Amount, e.g. 50000"
          value={targetText}
          onChangeText={setTargetText}
        />
        <Text testID="goal-target-preview" className="mt-2 text-fg-2 dark:text-fg-2-dark">
          {formatCentavos(targetAmount)}
        </Text>
      </View>

      <View className="gap-1">
        <FieldLabel>By when? (optional)</FieldLabel>
        <Text className="text-fg-2 dark:text-fg-2-dark">
          A deadline turns on the pace chip. Without one the goal just tracks progress.
        </Text>
        <DateField
          testID="goal-target-date"
          label="By when? (optional)"
          placeholder="Pick a date"
          value={targetDate}
          onChange={setTargetDate}
          // A goal deadline is always in the future — GoalForm has no
          // injected clock (no `now` prop), so `new Date()` is the read.
          minimumDate={new Date()}
        />
      </View>

      <View className="gap-1">
        <FieldLabel>Which savings account?</FieldLabel>
        <Text className="text-fg-2 dark:text-fg-2-dark">
          Progress is this account&apos;s balance, so whatever is already in it counts toward the
          goal.
        </Text>

        {availableWallets.length === 0 ? (
          // Rule 3's dead end, avoided. Not an error message — an offer.
          <Card variant="flat">
            <Text testID="goal-no-wallets" className="text-fg dark:text-fg-dark">
              You don&apos;t have a savings account set up yet.
            </Text>
            <View className="mt-3">
              <Button
                title="Create a savings wallet"
                variant="secondary"
                testID="goal-create-wallet"
                onPress={onCreateWallet}
              />
            </View>
          </Card>
        ) : (
          <View className="mt-2 flex-row flex-wrap gap-2">
            {availableWallets.map((wallet) => (
              <Chip
                key={wallet.id}
                testID={`goal-wallet-${wallet.id}`}
                label={`${wallet.name} · ${formatCentavos(wallet.balance)}`}
                tone={wallet.id === walletId ? "brand" : "neutral"}
                fill={wallet.id === walletId ? "solid" : "outline"}
                selected={wallet.id === walletId}
                onPress={() => setWalletId(wallet.id)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Rule 5. `PlusGate` renders the children in normal colours with a badge
          on free — never desaturated, which is SoonGate's meaning — and opens
          the upgrade sheet on press. */}
      <PlusGate capability="goals">
        <View className="gap-1">
          <FieldLabel>Move money automatically on payday</FieldLabel>
          <Text className="text-fg-2 dark:text-fg-2-dark">
            PeraPlano will remind you to move this amount each payday. It never moves money on its
            own — you do it in your banking app and it records the transfer.
          </Text>
          <NumericField
            testID="goal-rule-amount"
            label="Move money automatically on payday"
            mode="peso"
            placeholder="Amount each payday, e.g. 2000"
            value={ruleText}
            onChangeText={setRuleText}
          />
        </View>
      </PlusGate>

      <Button
        title={submitLabel}
        testID="goal-save"
        size="lg"
        disabled={!canSave}
        loading={busy}
        onPress={() => {
          if (!canSave || walletId === null) return;
          const ruleAmount = centavosFrom(ruleText);
          onSubmit({
            name: name.trim(),
            targetAmount,
            // No deadline picked is no deadline, not an invalid one (rule 4)
            // — DateField's value is already IsoDate | null, null while
            // untouched.
            targetDate,
            linkedWalletId: walletId,
            contributionRule: ruleAmount > 0 ? { kind: "fixed", amount: ruleAmount } : null,
          });
        }}
      />
    </View>
  );
}
