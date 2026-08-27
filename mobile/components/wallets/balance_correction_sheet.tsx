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
//
// CREDIT IS EXCLUDED TOO (review fix, 2026-08-18), for a reason that is NOT
// the same as cash's. A credit wallet's balance is the amount OWED
// (lib/wallets/summary.ts's rule 23; app/wallet/[id].tsx labels it "Owed"),
// and this sheet's question — "what does this wallet actually have?" — plus
// its in/out mapping are written for a HELD balance. On a credit card that
// question is ambiguous between owed and available credit, and answering it
// wrong would record TAKING ON DEBT as money received, which is not a
// currency-formatting bug — it is the app lying about which direction money
// moved. Getting the wording and sign right for credit needs its own design
// pass; shipping the wrong answer is worse than shipping none, so this stays
// disabled here as belt-and-braces with app/wallet/[id].tsx's own guard.
import { useState } from "react";
import { Text, View } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list_row";
import { NumericField } from "@/components/ui/numeric_field";
import {
  BALANCE_CORRECTION_NOTE,
  useCorrectWalletBalance,
} from "@/hooks/mutations/use_correct_wallet_balance";
import { centavosFrom } from "@/lib/money/peso_input";
import { cashAdjustment } from "@/lib/wallets/reconcile";
import type { Transaction, Wallet } from "@/types/domain";
import { isManualOnly } from "@/lib/wallets/summary";

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
  // WHAT THE USER KEYED, so "nothing typed" and "typed zero" stay different
  // answers — the same reasoning cash_reconcile_sheet.tsx gives, and the
  // reason `confirm` below refuses "" rather than treating it as 0.
  //
  // NEVER SEEDED FROM `wallet.balance` (numeric-input-system Task 13's seeding
  // audit), and this sheet is exactly where that temptation lives: it is ABOUT
  // entering a corrected balance, so pre-filling it with the recorded one
  // looks helpful. Two reasons it stays "". First, the empty/zero distinction
  // above is the whole refusal: a pre-filled field is already a typed answer,
  // and a mis-tapped Save would commit the recorded figure as if the user had
  // confirmed it. Second, a seed must go through `pesoInputFrom` and NOT
  // `String(wallet.balance)` — the latter reads as pesos and inflates 100×,
  // the bug already found twice in this workstream.
  const [text, setText] = useState("");
  const [showError, setShowError] = useState(false);
  const [result, setResult] = useState<Transaction | null | undefined>(undefined);

  const correct = useCorrectWalletBalance();

  // Rule 3's mirror of cash_reconcile_sheet.tsx's own guard: this path is for
  // wallets a provider reports on. A MANUAL wallet keeps its own sheet,
  // unmodified — there is no reported figure to correct against, only the
  // user's own count. An OWED wallet is excluded too, for the different reason
  // in the file header.
  if (isManualOnly(wallet) || wallet.owedBalance) return null;

  const stated = centavosFrom(text);
  const preview = cashAdjustment(wallet.balance, stated);

  function confirm(): void {
    if (text === "") {
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
        {/* Unchanged question — not pinned to a spec citation the way the cash
            sheet's is, but this file's own header already settled its wording
            once and re-litigating it against the design board's flavour text
            is exactly what task-5b's own trap warning is about. */}
        <Text className="text-body text-fg dark:text-fg-dark">
          What does this wallet actually have right now?
        </Text>

        {/* Same rhythm as cash_reconcile_sheet.tsx's ListRow, same wording —
            one voice across both sheets rather than two that happen to mean
            the same thing. */}
        <ListRow
          title="PeraPlano thinks you have"
          right={
            <AmountText
              testID="balance-correction-recorded"
              amount={wallet.balance}
              size="md"
              showSign={false}
            />
          }
        />

        {/* THE APP'S OWN KEYPAD (numeric-input-system Task 13), and inside a
            Modal the panel comes from bottom_sheet.tsx's nested KeypadHost —
            the root one would paint behind this dialog.

            NO "0" PLACEHOLDER any more. On this sheet a typed 0 is a real and
            consequential answer ("this wallet is empty", which writes off the
            whole recorded balance), and an empty field is refused — so a
            placeholder that LOOKS like a zero blurs the one distinction the
            refusal below depends on.

            THE BORDER IS A PERMANENT WRAPPER, NOT NumericField's OWN
            focus-only ring — see cash_reconcile_sheet.tsx's identical note;
            this sheet keeps the same rhythm rather than a second, drifting
            copy of that reasoning. */}
        <View className="gap-1">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
            Actual balance
          </Text>
          <View className="rounded-xl border border-brand dark:border-brand-dark">
            <NumericField
              testID="balance-correction-amount"
              label="This wallet's actual balance"
              mode="peso"
              placeholder="Type the amount"
              value={text}
              onChangeText={setText}
            />
          </View>
          {/* `formatCentavos` directly — see cash_reconcile_sheet.tsx's note
              on why `AmountText`'s `lg` (font-semibold) cannot reach the
              `text-title font-bold` this design calls for. */}
          <Text
            testID="balance-correction-preview"
            style={{ fontVariant: ["tabular-nums"] }}
            className="text-title font-bold text-fg dark:text-fg-dark"
          >
            {formatCentavos(stated)}
          </Text>
        </View>

        {/* Rule 3's required disclosure. Not a workaround — the honest limit
            of what a typed figure can promise on a wallet a provider ALSO
            reports to. A notification that arrives after this and carries a
            reported balance re-anchors the wallet from that report, the same
            way it always has; this correction does not and cannot stop it.
            Second clause (review fix, 2026-08-18): the correction transaction
            ITSELF is not touched by that re-anchor — the balance moves on,
            but the row stays in the ledger and keeps counting toward
            money-in/spend totals for whatever period it falls in. That is by
            design (rule 3 asks for an honest ledger entry, not a balance
            patch that vanishes later), but it is a real second-order effect
            worth saying plainly rather than leaving the user to discover it
            in a report.

            STILL UNCONDITIONAL — present before any input, exactly as before
            this restyle. components/wallets/__tests__/balance_correction_sheet.test.tsx
            asserts this by name ("shown before any input, not just after
            confirming"), and content is verbatim: the three phrases it
            regex-matches are untouched. */}
        <Text testID="balance-correction-warning" className="text-secondary text-warn dark:text-warn-dark">
          This is a starting point, not a bank-confirmed figure. If a notification later reports
          this wallet&apos;s balance directly, that report will replace this correction. The entry
          itself stays in your ledger and still counts toward your totals, even after that happens.
        </Text>

        {showError ? (
          <Text
            testID="balance-correction-error"
            className="text-sm text-danger dark:text-danger-dark"
          >
            Enter what this wallet actually has. Type 0 if it is empty.
          </Text>
        ) : null}

        {/* "Difference" — same danger/brand convention as
            cash_reconcile_sheet.tsx's. Absent when the two figures already
            agree, for the identical reason: no sign to ink it by, and
            `balance-correction-plan` below already says nothing will be
            recorded. */}
        {preview ? (
          <View testID="balance-correction-difference" className="flex-row items-center justify-between">
            <Text className="text-secondary font-semibold text-fg-2 dark:text-fg-2-dark">
              Difference
            </Text>
            <Text
              style={{ fontVariant: ["tabular-nums"] }}
              className={`text-secondary font-bold ${
                preview.direction === "out"
                  ? "text-danger dark:text-danger-dark"
                  : "text-brand dark:text-brand-dark"
              }`}
            >
              {`${preview.direction === "out" ? "−" : "+"}${formatCentavos(preview.amount)}`}
            </Text>
          </View>
        ) : null}

        {/* The null branch's copy is pinned VERBATIM
            (components/wallets/__tests__/balance_correction_sheet.test.tsx:
            "matches what this wallet already says"). The non-null branch
            names the real write, `BALANCE_CORRECTION_NOTE`
            (hooks/mutations/use_correct_wallet_balance.ts) — not the design
            board's own illustrative copy, which names no constant this
            codebase actually has. */}
        {preview === null ? (
          <Text testID="balance-correction-plan" className="text-secondary text-fg-2 dark:text-fg-2-dark">
            That matches what this wallet already says — nothing will be recorded.
          </Text>
        ) : (
          <Text testID="balance-correction-plan" className="text-secondary text-fg-2 dark:text-fg-2-dark">
            {preview.direction === "out"
              ? `Logged as "${BALANCE_CORRECTION_NOTE}" — money spent, so your totals stay honest. Nothing already in your ledger changes.`
              : `Logged as "${BALANCE_CORRECTION_NOTE}" — money received. Nothing already in your ledger changes.`}
          </Text>
        )}

        {result !== undefined ? (
          <Text testID="balance-correction-result" className="text-sm text-brand dark:text-brand-dark">
            {result === null
              ? "All matched — nothing recorded."
              : "Recorded. You can recategorize it from your transactions like any other entry."}
          </Text>
        ) : null}

        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              testID="balance-correction-cancel"
              title="Cancel"
              variant="secondary"
              onPress={onDismiss}
            />
          </View>
          <View className="flex-1">
            <Button
              testID="balance-correction-confirm"
              title="Save correction"
              onPress={confirm}
              loading={correct.isPending}
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
