// components/wallets/balance_correction_sheet.tsx — device-testing fix
// (2026-08-18, Task 4). The non-cash counterpart of cash_reconcile_sheet.tsx:
// otherwise there is no way to tell PeraPlano "this wallet already has
// ₱3,000 in it" after creation, because every wallet starts at ₱0.00 and only
// moves when a notification arrives.
//
// SAME SHAPE, NOT THE SAME SHEET. cash_reconcile_sheet.tsx stays cash-only and
// unmodified on purpose (its own header): a bank or e-wallet re-anchors
// itself from the PROVIDER's reported balance-after the moment a notification
// carrying one arrives, and a typed correction here would fight that snap and
// lose — leaving a transaction explaining a balance change that never
// happened. Nothing short of not writing anything could make that conflict
// disappear, so instead of hiding it this sheet SAYS SO on screen (rule 3)
// and labels the write a STARTING BALANCE / MANUAL CORRECTION rather than a
// reconciliation, so nobody reads the ledger row as a bank-confirmed figure.
//
// THE GAP, NOT THE TOTAL. Same reasoning as lib/wallets/reconcile.ts: this
// writes the DIFFERENCE between what the ledger already believes and what the
// user just typed, through `useCorrectWalletBalance`, which reuses
// `cashAdjustment` — the identical arithmetic cash reconciliation uses —
// rather than re-deriving it.
//
// NEVER WRITES `wallets.balance` DIRECTLY. wallet_form.tsx:11-13 is explicit
// about why: balance is the ledger's running total, moved only by the
// transaction that explains the move. This sheet's one write is an
// `insertTransaction` call, exactly like cash reconciliation's.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { AmountText, centavosFromDigits } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { useCorrectWalletBalance } from "@/hooks/mutations/use_correct_wallet_balance";
import { cashAdjustment } from "@/lib/wallets/reconcile";
import type { Transaction, Wallet } from "@/types/domain";

export type BalanceCorrectionSheetProps = {
  wallet: Wallet;
  visible: boolean;
  onDismiss: () => void;
  /** Fires with the correction written, or `null` when the figures agreed. */
  onDone?: (written: Transaction | null) => void;
  testID?: string;
};

export function BalanceCorrectionSheet({
  wallet,
  visible,
  onDismiss,
  onDone,
  testID = "balance-correction-sheet",
}: BalanceCorrectionSheetProps) {
  // The RAW DIGITS, so "nothing typed" and "typed zero" stay different
  // answers — the same reasoning cash_reconcile_sheet.tsx gives.
  const [digits, setDigits] = useState("");
  const [showError, setShowError] = useState(false);
  const [result, setResult] = useState<Transaction | null | undefined>(undefined);

  const correct = useCorrectWalletBalance();

  // Rule 3's mirror of cash_reconcile_sheet.tsx's own guard: this path is for
  // every OTHER wallet type. Cash keeps its own sheet, unmodified.
  if (wallet.type === "cash") return null;

  const stated = centavosFromDigits(digits);
  const preview = cashAdjustment(wallet.balance, stated);

  function confirm(): void {
    if (digits === "") {
      setShowError(true);
      return;
    }
    setShowError(false);
    correct.mutate(
      { walletId: wallet.id, statedBalance: stated },
      {
        onSuccess: (written) => {
          setResult(written);
          onDone?.(written);
        },
      },
    );
  }

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Starting balance / manual correction">
      <View testID={testID} className="gap-3">
        <Text className="text-base text-fg dark:text-fg-dark">
          What does this wallet actually have right now?
        </Text>

        <View className="gap-1">
          <Text className="text-sm text-fg-2 dark:text-fg-2-dark">This wallet currently says</Text>
          <AmountText
            testID="balance-correction-recorded"
            amount={wallet.balance}
            size="lg"
            showSign={false}
          />
        </View>

        <TextInput
          testID="balance-correction-amount"
          value={digits}
          onChangeText={setDigits}
          keyboardType="number-pad"
          placeholder="0"
          accessibilityLabel="This wallet's actual balance"
          className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
        />
        <AmountText testID="balance-correction-preview" amount={stated} size="lg" showSign={false} />

        {/* Rule 3's required disclosure. Not a workaround — the honest limit
            of what a typed figure can promise on a wallet a provider ALSO
            reports to. A notification that arrives after this and carries a
            reported balance re-anchors the wallet from that report, the same
            way it always has; this correction does not and cannot stop it. */}
        <Text testID="balance-correction-warning" className="text-sm text-warn dark:text-warn-dark">
          This is a starting point, not a bank-confirmed figure. If a notification later reports
          this wallet&apos;s balance directly, that report will replace this correction.
        </Text>

        {showError ? (
          <Text
            testID="balance-correction-error"
            className="text-sm text-danger dark:text-danger-dark"
          >
            Enter what this wallet actually has. Type 0 if it is empty.
          </Text>
        ) : null}

        {preview === null ? (
          <Text testID="balance-correction-plan" className="text-sm text-fg-2 dark:text-fg-2-dark">
            That matches what this wallet already says — nothing will be recorded.
          </Text>
        ) : (
          <Text testID="balance-correction-plan" className="text-sm text-fg-2 dark:text-fg-2-dark">
            {preview.direction === "out"
              ? "We will record the difference as money spent, so your totals stay honest. Nothing already in your ledger changes."
              : "We will record the difference as money received. Nothing already in your ledger changes."}
          </Text>
        )}

        {result !== undefined ? (
          <Text testID="balance-correction-result" className="text-sm text-brand dark:text-brand-dark">
            {result === null
              ? "All matched — nothing recorded."
              : "Recorded. You can recategorize it from your transactions like any other entry."}
          </Text>
        ) : null}

        <Button
          testID="balance-correction-confirm"
          title="Save this amount"
          onPress={confirm}
          loading={correct.isPending}
        />
      </View>
    </BottomSheet>
  );
}
