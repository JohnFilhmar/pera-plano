// components/wallets/cash_reconcile_sheet.tsx — m1c plan Task 5, rules 5 and 6.
//
// Cash cannot send a notification, so a cash wallet's balance is only ever as
// good as what the user remembered to enter — and jeepney fares, palengke runs
// and a round of drinks are exactly what nobody remembers to enter. This sheet
// is the repair: it asks what is actually in their pocket and records the gap.
//
// THE GAP, NOT THE TOTAL. `cashAdjustment` computes it and this file never
// re-derives it; see lib/wallets/reconcile.ts for why the difference is the
// only honest thing to write.
//
// IT NEVER EDITS PAST TRANSACTIONS. There is one write, it is an insert, and
// the wallet lands on the typed figure because that insert moves the balance by
// exactly the difference. The ledger stays a history a user can check.
//
// CASH ONLY (rule 6). A bank wallet re-anchors itself from the provider's own
// reported balance-after; a typed adjustment there would fight the next snap
// and lose, leaving a transaction explaining a balance change that never
// happened.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { AmountText, centavosFromDigits } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { useReconcileCash } from "@/hooks/mutations/use_reconcile_cash";
import { cashAdjustment } from "@/lib/wallets/reconcile";
import type { Transaction, Wallet } from "@/types/domain";

export type CashReconcileSheetProps = {
  wallet: Wallet;
  visible: boolean;
  onDismiss: () => void;
  /** Fires with the adjustment written, or `null` when the figures agreed. */
  onDone?: (written: Transaction | null) => void;
  testID?: string;
};

export function CashReconcileSheet({
  wallet,
  visible,
  onDismiss,
  onDone,
  testID = "cash-reconcile-sheet",
}: CashReconcileSheetProps) {
  // The RAW DIGITS, so "nothing typed" and "typed zero" stay different answers.
  // An empty pocket is a real thing to report; an untouched field is not, and
  // both parse to 0.
  const [digits, setDigits] = useState("");
  const [showError, setShowError] = useState(false);
  const [result, setResult] = useState<Transaction | null | undefined>(undefined);

  const reconcile = useReconcileCash();

  // Rule 6, enforced here as well as at the detail screen's action. Two guards
  // for one rule is cheap; a reconciliation adjustment landing in a bank wallet
  // is not.
  if (wallet.type !== "cash") return null;

  const physical = centavosFromDigits(digits);
  const preview = cashAdjustment(wallet.balance, physical);

  function confirm(): void {
    if (digits === "") {
      setShowError(true);
      return;
    }
    setShowError(false);
    reconcile.mutate(
      { walletId: wallet.id, physicalBalance: physical },
      {
        onSuccess: (written) => {
          setResult(written);
          onDone?.(written);
        },
      },
    );
  }

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Reconcile cash">
      <View testID={testID} className="gap-3">
        {/* The SPEC's question (docs/04-features/02-wallets.md §cash Wallet
            reconciliation rule 2), not the plan's "How much is in your physical
            wallet right now?". Global Constraints: where the plan and a spec
            disagree, the spec wins. */}
        <Text className="text-base text-fg dark:text-fg-dark">
          How much cash do you have right now?
        </Text>

        <View className="gap-1">
          <Text className="text-sm text-fg-2 dark:text-fg-2-dark">This wallet currently says</Text>
          <AmountText
            testID="reconcile-recorded"
            amount={wallet.balance}
            size="lg"
            showSign={false}
          />
        </View>

        <TextInput
          testID="reconcile-amount"
          value={digits}
          onChangeText={setDigits}
          keyboardType="number-pad"
          placeholder="0"
          accessibilityLabel="Cash you have right now"
          className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
        />
        <AmountText testID="reconcile-preview" amount={physical} size="lg" showSign={false} />

        {showError ? (
          <Text testID="reconcile-amount-error" className="text-sm text-danger dark:text-danger-dark">
            Enter what is in your wallet. Type 0 if it is empty.
          </Text>
        ) : null}

        {/* Say what the button will DO before it is pressed. A user who is told
            "we will record ₱300.00 as money spent" can catch their own typo;
            one who finds out afterwards has to go and delete a transaction. */}
        {preview === null ? (
          <Text testID="reconcile-plan" className="text-sm text-fg-2 dark:text-fg-2-dark">
            That matches what this wallet already says — nothing will be recorded.
          </Text>
        ) : (
          <Text testID="reconcile-plan" className="text-sm text-fg-2 dark:text-fg-2-dark">
            {preview.direction === "out"
              ? "We will record the difference as money spent, so your totals stay honest. Nothing already in your ledger changes."
              : "We will record the difference as money received. Nothing already in your ledger changes."}
          </Text>
        )}

        {result !== undefined ? (
          <Text testID="reconcile-result" className="text-sm text-brand dark:text-brand-dark">
            {result === null
              ? "All matched — nothing recorded."
              : "Recorded. You can recategorize it from your transactions like any other entry."}
          </Text>
        ) : null}

        <Button
          testID="reconcile-confirm"
          title="Save this amount"
          onPress={confirm}
          loading={reconcile.isPending}
        />
      </View>
    </BottomSheet>
  );
}
