// components/onboarding/income_quick_form.tsx — the onboarding income step's
// content (m3c-onboarding-client plan Task 3, rule 3;
// docs/04-features/01-onboarding.md step 8).
//
// KINSENAS FIRST, NOT AN AFTERTHOUGHT. Reuses components/income/cadence_picker.tsx
// verbatim rather than re-listing the four cadences here — that component
// already orders kinsenas ahead of weekly/monthly/irregular (its own header:
// "the PH payroll norm of the 15th and 30th") and glosses it for a user who
// may not know the word. A second, hand-rolled cadence list in this file
// would be the two ever disagreeing about the order the moment either one is
// edited.
//
// "LET PERAPLANO FIGURE IT OUT" LIVES ON THE FRAME, NOT IN THIS FORM. It is
// not a fifth cadence and it does not set `IncomeProfile.isManualOverride` —
// choosing it sets nothing at all and simply skips this step, exactly like
// task-3-brief rule 3 describes ("skips to automatic detection"). Detection
// already runs on bootstrap and every ledger commit
// (income_ledger_subscriber.ts). OnboardingFrame already mandates one primary
// action and one skip affordance per step; app/(onboarding)/income.tsx wires
// BOTH of those to "figure it out", so this form owns exactly one button —
// "Save my income" — rather than duplicating a second exit here.
//
// PURELY PRESENTATIONAL, same split every onboarding step keeps: the caller
// (app/(onboarding)/income.tsx) owns the wallet list, the mutation and the
// clock; this component only collects the answer.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CadencePicker } from "@/components/income/cadence_picker";
import { Button } from "@/components/ui/button";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom } from "@/lib/money/peso_input";
import type { Centavos, IncomeCadence, Wallet } from "@/types/domain";

export type IncomeQuickFormValues = {
  cadence: IncomeCadence;
  averageAmount: Centavos;
  sourceWalletIds: string[];
};

export type IncomeQuickFormProps = {
  wallets: Wallet[];
  busy?: boolean;
  onSubmit: (values: IncomeQuickFormValues) => void;
};

export function IncomeQuickForm({ wallets, busy = false, onSubmit }: IncomeQuickFormProps) {
  const [cadence, setCadence] = useState<IncomeCadence>("kinsenas");
  const [amountText, setAmountText] = useState("");
  const [walletIds, setWalletIds] = useState<string[]>([]);

  const amount = centavosFrom(amountText);
  const canSave = amount > 0 && !busy;

  const toggleWallet = (id: string) =>
    setWalletIds((current) =>
      current.includes(id) ? current.filter((walletId) => walletId !== id) : [...current, id],
    );

  return (
    <View className="gap-6">
      <Text testID="income-quick-form-intro" className="text-fg-2 dark:text-fg-2-dark">
        When does money usually come in?
      </Text>

      <CadencePicker value={cadence} onChange={setCadence} />

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">
          {cadence === "irregular" ? "Roughly how much a month?" : "How much each time?"}
        </Text>
        {/* THE FIELD FINALLY MEANS WHAT ITS EXAMPLE SAYS (numeric-input-system
            Task 12). Two rounds of this bug: the original was a TextInput
            behind "Amount, e.g. 18500" that read those digits as CENTAVOS and
            produced ₱185.00; Task 5 swapped in an inline AmountNumpad so at
            least the live read-out could not lie about what had been keyed.
            The cause is gone now rather than annotated — lib/money/peso_input.ts
            reads keystrokes as PESOS, so 18500 is the ₱18,500.00 the reporter
            meant — and the keys themselves moved to the shared panel
            (components/ui/keypad_host.tsx), which is what lets the frame
            around this form lift its Save button clear of them. */}
        <NumericField
          testID="income-quick-amount"
          label={cadence === "irregular" ? "Roughly how much a month?" : "How much each time?"}
          mode="peso"
          placeholder="Amount, e.g. 18500"
          value={amountText}
          onChangeText={setAmountText}
        />
      </View>

      {wallets.length > 0 ? (
        <View>
          <Text className="font-semibold text-fg dark:text-fg-dark">
            Which wallet does it land in?
          </Text>
          <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
            Optional — it helps PeraPlano tell your pay apart from other money coming in.
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {wallets.map((wallet) => {
              const selected = walletIds.includes(wallet.id);
              return (
                <Pressable
                  key={wallet.id}
                  testID={`income-quick-wallet-${wallet.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => toggleWallet(wallet.id)}
                  className={`rounded-full px-4 py-2 ${
                    selected ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"
                  }`}
                >
                  <Text
                    className={
                      selected ? "text-on-brand dark:text-on-brand-dark" : "text-fg dark:text-fg-dark"
                    }
                  >
                    {wallet.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <Button
        title="Save my income"
        testID="income-quick-save"
        disabled={!canSave}
        loading={busy}
        onPress={() => onSubmit({ cadence, averageAmount: amount, sourceWalletIds: walletIds })}
      />
    </View>
  );
}
