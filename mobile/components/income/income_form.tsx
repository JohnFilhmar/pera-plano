// components/income/income_form.tsx — m2-part2 Task 13, rule 3.
//
// Cadence, amount, source wallets — and one sentence saying plainly that saving
// this stops detection from changing it (income rule 14). That sentence is not
// decoration: the whole point of the override is that the user is taking over,
// and an app that quietly reverted their figure a week later would be worse
// than one that never offered the choice.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CadencePicker } from "@/components/income/cadence_picker";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type { Centavos, IncomeCadence, Wallet } from "@/types/domain";

export type IncomeFormValues = {
  cadence: IncomeCadence;
  averageAmount: Centavos;
  sourceWalletIds: string[];
};

export type IncomeFormProps = {
  wallets: Wallet[];
  initial?: Partial<IncomeFormValues>;
  onSubmit: (values: IncomeFormValues) => void;
  busy?: boolean;
};

export function IncomeForm({ wallets, initial, onSubmit, busy = false }: IncomeFormProps) {
  const [cadence, setCadence] = useState<IncomeCadence>(initial?.cadence ?? "kinsenas");
  // pesoInputFrom, NOT String() — A LATENT 100× BUG, FIXED
  // (numeric-input-system Task 12). `averageAmount` is Centavos. Seeding the
  // field with `String(initial.averageAmount)` was correct only for as long as
  // the field read its own text back as centavo digits; the moment W1 made
  // that text PESOS, a stored ₱2,000.00 (200000) would have seeded as
  // ₱200,000.00 — a hundredfold inflation nobody typed, sitting in the box
  // of the one screen whose entire subject is a figure the user told the app.
  // lib/money/peso_input.ts exports this direction for exactly this use.
  const [amountText, setAmountText] = useState(
    initial?.averageAmount === undefined ? "" : pesoInputFrom(initial.averageAmount),
  );
  const [walletIds, setWalletIds] = useState<string[]>(initial?.sourceWalletIds ?? []);

  const amount = centavosFrom(amountText);
  const canSave = amount > 0 && !busy;

  const toggleWallet = (id: string) =>
    setWalletIds((current) =>
      current.includes(id) ? current.filter((walletId) => walletId !== id) : [...current, id],
    );

  return (
    <View className="gap-6">
      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">How often are you paid?</Text>
        <View className="mt-2">
          <CadencePicker value={cadence} onChange={setCadence} />
        </View>
      </View>

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">
          {cadence === "irregular" ? "Roughly how much a month?" : "How much each time?"}
        </Text>
        <NumericField
          testID="income-amount"
          label={cadence === "irregular" ? "Roughly how much a month?" : "How much each time?"}
          mode="peso"
          placeholder="Amount, e.g. 18500"
          value={amountText}
          onChangeText={setAmountText}
        />
        {/* Typing 18500 means ₱18,500.00 now (numeric-input-system Task 12),
            so the example above finally agrees with the field. The preview
            stays: it states the figure the way the ledger will hold it,
            centavos included, before anything is saved — the same echo the
            limit amount field keeps. */}
        <Text testID="income-amount-preview" className="mt-2 text-fg-2 dark:text-fg-2-dark">
          {formatCentavos(amount)}
        </Text>
      </View>

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">Which account is it paid into?</Text>
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
          Optional — it helps PeraPlano tell your pay apart from other money coming in.
        </Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {wallets.map((wallet) => {
            const selected = walletIds.includes(wallet.id);
            return (
              <Pressable
                key={wallet.id}
                testID={`income-wallet-${wallet.id}`}
                accessibilityState={{ selected }}
                onPress={() => toggleWallet(wallet.id)}
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
                  {wallet.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Rule 3's required sentence. */}
      <Text testID="income-override-note" className="text-fg-2 dark:text-fg-2-dark">
        Saving this overrides what PeraPlano detects. It will keep watching in the background, but
        it won&apos;t change your figures.
      </Text>

      <Button
        title="Save my income"
        testID="income-save"
        disabled={!canSave}
        loading={busy}
        onPress={() => onSubmit({ cadence, averageAmount: amount, sourceWalletIds: walletIds })}
      />
    </View>
  );
}
