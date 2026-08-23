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
import { Text, View } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list_row";
import { NumericField } from "@/components/ui/numeric_field";
import { useReconcileCash } from "@/hooks/mutations/use_reconcile_cash";
import { centavosFrom } from "@/lib/money/peso_input";
import { cashAdjustment, RECONCILE_NOTE } from "@/lib/wallets/reconcile";
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
  // WHAT THE USER KEYED, so "nothing typed" and "typed zero" stay different
  // answers. An empty pocket is a real thing to report; an untouched field is
  // not, and both parse to 0.
  //
  // NEVER SEEDED FROM `wallet.balance` (numeric-input-system Task 13's seeding
  // audit). Pre-filling the recorded figure would look helpful on a sheet
  // whose whole subject is a balance, and it would destroy the distinction
  // above — a pre-filled field is already a typed answer, so a mis-tapped Save
  // would confirm the recorded figure on the user's behalf. Any seed would
  // also have to be `pesoInputFrom(wallet.balance)`, never
  // `String(wallet.balance)`: the latter reads as pesos and inflates 100×.
  const [text, setText] = useState("");
  const [showError, setShowError] = useState(false);
  const [result, setResult] = useState<Transaction | null | undefined>(undefined);

  const reconcile = useReconcileCash();

  // Rule 6, enforced here as well as at the detail screen's action. Two guards
  // for one rule is cheap; a reconciliation adjustment landing in a bank wallet
  // is not.
  if (wallet.type !== "cash") return null;

  const physical = centavosFrom(text);
  const preview = cashAdjustment(wallet.balance, physical);

  function confirm(): void {
    if (text === "") {
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
            disagree, the spec wins — and task-5b's design board draws a THIRD
            wording again ("Count what's in your wallet right now..."); the
            same rule keeps the spec's question here rather than a fourth
            rewrite of prose that is not itself under test. */}
        <Text className="text-body text-fg dark:text-fg-dark">
          How much cash do you have right now?
        </Text>

        <ListRow
          title="PeraPlano thinks you have"
          right={
            <AmountText testID="reconcile-recorded" amount={wallet.balance} size="md" showSign={false} />
          }
        />

        {/* THE APP'S OWN KEYPAD (numeric-input-system Task 13), and inside a
            Modal the panel comes from bottom_sheet.tsx's nested KeypadHost —
            the root one would paint behind this dialog.

            NO "0" PLACEHOLDER any more. A typed 0 here is a real and
            consequential answer ("my pocket is empty", which writes off the
            whole recorded balance), and an empty field is refused — so a
            placeholder that LOOKS like a zero blurs the one distinction the
            refusal below depends on.

            THE BORDER IS PERMANENT, NOT NumericField's OWN focus-only ring
            (numeric_field.tsx:147-149 adds `border-brand` only while
            `focused`). This wraps it in a matching, always-on `border-brand`
            ring instead of editing that shared field for one caller's
            emphasis — the design board's "Actual count" box is drawn with a
            constant coloured border, unlike the plain "PeraPlano thinks you
            have" row above it. */}
        <View className="gap-1">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
            Actual count
          </Text>
          <View className="rounded-xl border border-brand dark:border-brand-dark">
            <NumericField
              testID="reconcile-amount"
              label="Cash you have right now"
              mode="peso"
              placeholder="Type the amount"
              value={text}
              onChangeText={setText}
            />
          </View>
          {/* `formatCentavos` directly, not `AmountText` — `AmountText`'s
              `lg` size is `font-semibold`, and the design calls for
              `font-bold` specifically at `text-title` here; nesting it
              inside a styled Text would also silently lose that weight (the
              AmountText-nesting trap this project has shipped twice). */}
          <Text
            testID="reconcile-preview"
            style={{ fontVariant: ["tabular-nums"] }}
            className="text-title font-bold text-fg dark:text-fg-dark"
          >
            {formatCentavos(physical)}
          </Text>
        </View>

        {showError ? (
          <Text testID="reconcile-amount-error" className="text-sm text-danger dark:text-danger-dark">
            Enter what is in your wallet. Type 0 if it is empty.
          </Text>
        ) : null}

        {/* "Difference", inked by sign — danger for a shortfall (spend the app
            never saw), brand for a surplus (money that arrived unseen). Absent
            entirely when the two already agree: a "Difference ₱0.00" row has
            no sign to ink it by, and `reconcile-plan` below already says
            plainly that nothing will be recorded. */}
        {preview ? (
          <View testID="reconcile-difference" className="flex-row items-center justify-between">
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
              {/* U+2212 MINUS SIGN — components/ui/amount_text.tsx's own
                  convention, matched here rather than a hyphen. */}
              {`${preview.direction === "out" ? "−" : "+"}${formatCentavos(preview.amount)}`}
            </Text>
          </View>
        ) : null}

        {/* Say what the button will DO before it is pressed, AND say what it
            will be logged as — `RECONCILE_NOTE`, the actual string this
            write uses (lib/wallets/reconcile.ts), not the design board's own
            illustrative "Cash adjustment · untracked spending" (which names
            no real constant in this codebase). A user who is told "we will
            record ₱300.00 as money spent" can catch their own typo; one who
            finds out afterwards has to go and delete a transaction. */}
        {preview === null ? (
          <Text testID="reconcile-plan" className="text-secondary text-fg-2 dark:text-fg-2-dark">
            That matches what this wallet already says — nothing will be recorded.
          </Text>
        ) : (
          <Text testID="reconcile-plan" className="text-secondary text-fg-2 dark:text-fg-2-dark">
            {preview.direction === "out"
              ? `Logged as "${RECONCILE_NOTE}" — money spent, so your totals stay honest. Nothing already in your ledger changes.`
              : `Logged as "${RECONCILE_NOTE}" — money received. Nothing already in your ledger changes.`}
          </Text>
        )}

        {result !== undefined ? (
          <Text testID="reconcile-result" className="text-sm text-brand dark:text-brand-dark">
            {result === null
              ? "All matched — nothing recorded."
              : "Recorded. You can recategorize it from your transactions like any other entry."}
          </Text>
        ) : null}

        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button testID="reconcile-cancel" title="Cancel" variant="secondary" onPress={onDismiss} />
          </View>
          <View className="flex-1">
            <Button
              testID="reconcile-confirm"
              title="Save count"
              onPress={confirm}
              loading={reconcile.isPending}
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
