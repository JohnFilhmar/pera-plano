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
import { AmountNumpad } from "@/components/transactions/amount_numpad";
import { centavosFromDigits } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
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
  const [digits, setDigits] = useState("");
  const [walletIds, setWalletIds] = useState<string[]>([]);

  const amount = centavosFromDigits(digits);
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
        {/* DEVICE-TESTING FIX (2026-08-18, Task 5): this used to be a bare
            TextInput behind a placeholder reading "Amount, e.g. 18500", which
            reads as ₱18,500 but — because the field takes DIGITS, not pesos —
            actually produced ₱185.00. AmountNumpad replaces both the input and
            the static claim with one live display: the peso string is
            rendered FROM the digits on every keystroke, so there is no
            separate "e.g." text left to disagree with what typing does. */}
        <View testID="income-quick-amount" className="mt-2">
          <AmountNumpad digits={digits} onDigitsChange={setDigits} />
        </View>
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
