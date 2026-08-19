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
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateField } from "@/components/ui/date_field";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom } from "@/lib/money/peso_input";
import type { ContributionRule, IsoDate, Wallet } from "@/types/domain";

export type GoalFormValues = {
  name: string;
  targetAmount: number;
  targetDate: IsoDate | null;
  linkedWalletId: string;
  contributionRule: ContributionRule | null;
};

export type GoalFormProps = {
  /** Savings wallets with no goal yet — the only ones a goal may bind (I10). */
  availableWallets: Wallet[];
  onSubmit: (values: GoalFormValues) => void;
  /** Opens the inline savings-wallet flow (rule 3). */
  onCreateWallet: () => void;
  busy?: boolean;
};

export function GoalForm({
  availableWallets,
  onSubmit,
  onCreateWallet,
  busy = false,
}: GoalFormProps) {
  const [name, setName] = useState("");
  const [targetText, setTargetText] = useState("");
  const [targetDate, setTargetDate] = useState<IsoDate | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [ruleText, setRuleText] = useState("");

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
      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">
          What are you saving for?
        </Text>
        <TextInput
          testID="goal-name"
          className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
          placeholder="Emergency fund"
          value={name}
          onChangeText={setName}
        />
      </View>

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">How much?</Text>
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

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">By when? (optional)</Text>
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
          A deadline turns on the pace chip. Without one the goal just tracks progress.
        </Text>
        <DateField
          testID="goal-target-date"
          label="By when? (optional)"
          placeholder="YYYY-MM-DD"
          value={targetDate}
          onChange={setTargetDate}
          // A goal deadline is always in the future — GoalForm has no
          // injected clock (no `now` prop), so `new Date()` is the read.
          minimumDate={new Date()}
        />
      </View>

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">Which savings account?</Text>
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
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
            {availableWallets.map((wallet) => {
              const selected = wallet.id === walletId;
              return (
                <Pressable
                  key={wallet.id}
                  testID={`goal-wallet-${wallet.id}`}
                  accessibilityState={{ selected }}
                  onPress={() => setWalletId(wallet.id)}
                  className={`rounded-full px-4 py-2 ${
                    selected
                      ? "bg-brand dark:bg-brand-dark"
                      : "bg-surface dark:bg-surface-dark"
                  }`}
                >
                  <Text
                    className={
                      selected
                        ? "text-surface dark:text-surface-dark"
                        : "text-fg dark:text-fg-dark"
                    }
                  >
                    {`${wallet.name} · ${formatCentavos(wallet.balance)}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* Rule 5. `PlusGate` renders the children in normal colours with a badge
          on free — never desaturated, which is SoonGate's meaning — and opens
          the upgrade sheet on press. */}
      <PlusGate capability="goals">
        <View>
          <Text className="font-semibold text-fg dark:text-fg-dark">
            Move money automatically on payday
          </Text>
          <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
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
        title="Create goal"
        testID="goal-save"
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
