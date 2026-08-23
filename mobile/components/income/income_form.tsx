// components/income/income_form.tsx — m2-part2 Task 13, rule 3.
//
// Cadence, amount, source wallets — and one sentence saying plainly that saving
// this stops detection from changing it (income rule 14). That sentence is not
// decoration: the whole point of the override is that the user is taking over,
// and an app that quietly reverted their figure a week later would be worse
// than one that never offered the choice.
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b) to the shared field rhythm: a
// `text-micro font-semibold text-fg-2` label above each control, and the
// source-wallet picker as a `Chip` row — `income-wallet-${id}` presses are
// unchanged, since no test in this project reads `accessibilityState` off
// them (unlike the bill/loan reminder offsets, which stay hand-rolled for
// exactly that reason).
import { useState } from "react";
import { Text, View } from "react-native";

import { CadencePicker } from "@/components/income/cadence_picker";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type { Centavos, IncomeCadence, Wallet } from "@/types/domain";

/** Step 2's field rhythm: the label that sits above every control below. */
function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">{children}</Text>
  );
}

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
      <View className="gap-2">
        <FieldLabel>How often are you paid?</FieldLabel>
        <CadencePicker value={cadence} onChange={setCadence} />
      </View>

      <View className="gap-1">
        <FieldLabel>
          {cadence === "irregular" ? "Roughly how much a month?" : "How much each time?"}
        </FieldLabel>
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

      <View className="gap-1">
        <FieldLabel>Which account is it paid into?</FieldLabel>
        <Text className="text-fg-2 dark:text-fg-2-dark">
          Optional — it helps PeraPlano tell your pay apart from other money coming in.
        </Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {wallets.map((wallet) => (
            <Chip
              key={wallet.id}
              testID={`income-wallet-${wallet.id}`}
              label={wallet.name}
              fill={walletIds.includes(wallet.id) ? "solid" : "outline"}
              selected={walletIds.includes(wallet.id)}
              onPress={() => toggleWallet(wallet.id)}
            />
          ))}
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
        size="lg"
        disabled={!canSave}
        loading={busy}
        onPress={() => onSubmit({ cadence, averageAmount: amount, sourceWalletIds: walletIds })}
      />
    </View>
  );
}
