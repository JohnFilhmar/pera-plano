// components/loans/record_payment_sheet.tsx — the spec's "Flow: manual payment
// recording" (docs/04-features/06-loans.md), which had no user interface at all
// until now: `recordManualPayment` and `useRecordPayment` both existed, both
// were tested, and nothing on any screen called either of them.
//
// WHAT THAT COST. The matching path (payment_match_sheet.tsx) can only offer
// transactions the ledger already holds, and the ledger only holds what a
// provider notification revealed. Cash reveals nothing. So the two situations
// this app was written for — a collector who shows up for ₱500 on a 5-6 loan,
// and a cousin who hands back ₱1,000 in person — were the exact two the loan
// screen could not record. The user story is in the spec verbatim: "As a cash
// payer, I want to record a payment by hand when there is no notification
// trail, so that my loan balance is right even for cash."
//
// THE DIRECTION IS NEVER A QUESTION ON THIS SHEET. Spec step 2 fixes it from
// the loan: `out` for I-owe, `in` for owed-to-me, and `recordManualPayment`
// derives it from the loan row itself. There is deliberately no control here
// that could disagree — `loans_repo.ts`'s `PaymentDirectionMismatchError` calls
// a payment pointing the wrong way "the same functions for what I owe" defect,
// and a direction toggle on this sheet would be a way to reintroduce it by
// hand. All this file does with the direction is CHOOSE ITS WORDS: a borrower
// pays, a lender is paid, and one sheet reading "Record a payment" for both
// would be telling half its users the opposite of what happened.
//
// BOTH WRITES OR NEITHER is settled in the service, not here — see
// `recordManualPayment`'s own header for why a transaction without its loan
// link is worse than no transaction at all.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date_field";
import { NumericField } from "@/components/ui/numeric_field";
import { useRecordPayment } from "@/hooks/mutations/use_record_payment";
import { toDateIso } from "@/lib/dates";
import { centavosFrom } from "@/lib/money/peso_input";
import { occurredAtFor } from "@/lib/transactions/manual_entry";
import type { EpochMs, Loan, Wallet } from "@/types/domain";
import { isManualOnly } from "@/lib/wallets/summary";

export type RecordPaymentSheetProps = {
  loan: Loan;
  /** Every wallet the app knows about; archived ones are filtered out here. */
  wallets: Wallet[];
  visible: boolean;
  onDismiss: () => void;
  /** Fires once the payment and its link are both written. */
  onDone?: () => void;
  /**
   * Injected, never `Date.now()`. Both the default date and the picker's upper
   * bound are derived from it, so a test can record a back-dated collector
   * visit without depending on when it ran — the same reasoning
   * `manual_entry_form.tsx` gives for its own `now`.
   */
  now: EpochMs;
  testID?: string;
};

export function RecordPaymentSheet({
  loan,
  wallets,
  visible,
  onDismiss,
  onDone,
  now,
  testID = "record-payment-sheet",
}: RecordPaymentSheetProps) {
  const iOwe = loan.direction === "i-owe";

  // Archived wallets are hidden from every picker (wallets spec), and cash is
  // listed first because cash is what this sheet is FOR: if there were a
  // notification, matching would already have offered the transaction and the
  // user would never have opened this.
  const selectable = [
    ...wallets.filter((wallet) => !wallet.isArchived && isManualOnly(wallet)),
    ...wallets.filter((wallet) => !wallet.isArchived && !isManualOnly(wallet)),
  ];

  // THE LOAN'S LINKED WALLET IS A DEFAULT, NOT AN ANSWER. `linkedWalletId` is
  // matching signal 8(f) — where payments on this loan usually come from — so
  // pre-selecting it saves the common tap. It is still overridable and still
  // shown as a selected row rather than assumed silently, because the one wallet
  // a cash payment most often does NOT come from is the bank account the loan is
  // linked to. Falls back to nothing rather than to "the first wallet": a
  // payment written into the wrong wallet corrupts that wallet's balance as well
  // as the ledger, and the user has no way to notice it happened.
  const linkedDefault =
    selectable.find((wallet) => wallet.id === loan.linkedWalletId)?.id ?? null;

  const [amountText, setAmountText] = useState("");
  const [day, setDay] = useState(toDateIso(new Date(now)));
  const [chosenWalletId, setChosenWalletId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const record = useRecordPayment();

  const walletId = chosenWalletId ?? linkedDefault;
  const amount = centavosFrom(amountText);
  const occurredAt = occurredAtFor(day, now);

  const amountMissing = amount <= 0;
  const walletMissing = walletId === null;
  const dateInvalid = occurredAt === null;

  function reset(): void {
    setAmountText("");
    setDay(toDateIso(new Date(now)));
    setChosenWalletId(null);
    setShowErrors(false);
  }

  function confirm(): void {
    // The three conditions are re-stated rather than read off `amountMissing` /
    // `walletMissing` / `dateInvalid` above ON PURPOSE: a derived boolean does
    // not narrow `walletId` or `occurredAt` out of `null`, so the shorter guard
    // compiles only with a non-null assertion on each — and an assertion is
    // exactly the thing that would keep compiling on the day one of these
    // becomes reachable while null. The booleans stay for the error messages.
    if (amount <= 0 || walletId === null || occurredAt === null) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    record.mutate(
      { loanId: loan.id, amount, walletId, occurredAt },
      {
        onSuccess: () => {
          reset();
          onDone?.();
          onDismiss();
        },
      },
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      // The borrower's sentence and the lender's are different sentences. On an
      // owed-to-me loan the user did not pay anything — somebody paid THEM —
      // and a sheet titled "Record a payment" over a form that will write money
      // INTO their wallet is the app describing the wrong side of the
      // transaction to the person who lived it.
      title={iOwe ? "Record a payment" : `Record what ${loan.counterparty} paid`}
    >
      <View testID={testID} className="gap-3">
        {/* SAY WHICH WAY THE MONEY WILL BE WRITTEN BEFORE THE BUTTON IS
            PRESSED. The user cannot choose the direction, so the least this
            sheet can do is state it — the same "say what the button will DO"
            convention cash_reconcile_sheet.tsx's plan line follows. A user who
            is told this will be logged as money going out can catch a loan they
            opened by mistake; one who finds out afterwards has to go and delete
            a transaction. */}
        <Text testID="loan-payment-explainer" className="text-body text-fg dark:text-fg-dark">
          {iOwe
            ? `Money you paid ${loan.counterparty}. It goes in your ledger as money out of the wallet you pick.`
            : `Money ${loan.counterparty} paid you. It goes in your ledger as money in to the wallet you pick.`}
        </Text>

        <View className="gap-1">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
            How much?
          </Text>
          <NumericField
            testID="loan-payment-amount"
            label={iOwe ? "How much did you pay?" : `How much did ${loan.counterparty} pay?`}
            mode="peso"
            placeholder="Type the amount"
            value={amountText}
            onChangeText={setAmountText}
          />
          <Text
            testID="loan-payment-preview"
            style={{ fontVariant: ["tabular-nums"] }}
            className="text-title font-bold text-fg dark:text-fg-dark"
          >
            {formatCentavos(amount)}
          </Text>
          {showErrors && amountMissing ? (
            <Text
              testID="loan-payment-amount-error"
              className="text-sm text-danger dark:text-danger-dark"
            >
              Enter how much was paid.
            </Text>
          ) : null}
        </View>

        <View className="gap-1">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">When?</Text>
          <DateField
            testID="loan-payment-date"
            label="When was it paid?"
            placeholder="Pick a date"
            value={day}
            onChange={setDay}
            // A recorded payment is money that ALREADY moved. `now`, not the
            // wall clock, so the bound agrees with `occurredAtFor` above rather
            // than being a second, independent read of "today".
            maximumDate={new Date(now)}
          />
          {showErrors && dateInvalid ? (
            <Text
              testID="loan-payment-date-error"
              className="text-sm text-danger dark:text-danger-dark"
            >
              Pick today or a day already past — a payment can&apos;t be dated in the future.
            </Text>
          ) : null}
        </View>

        <View className="gap-2">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
            {iOwe ? "Which wallet did it come out of?" : "Which wallet did it land in?"}
          </Text>
          {selectable.map((wallet) => (
            <Pressable
              key={wallet.id}
              testID={`loan-payment-wallet-${wallet.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: walletId === wallet.id }}
              accessibilityLabel={wallet.name}
              onPress={() => setChosenWalletId(wallet.id)}
              className={`min-h-[44px] justify-center rounded-xl px-4 py-3 ${
                walletId === wallet.id
                  ? "bg-brand-soft dark:bg-brand-soft-dark"
                  : "bg-chip dark:bg-chip-dark"
              }`}
            >
              <Text className="text-fg dark:text-fg-dark">{wallet.name}</Text>
            </Pressable>
          ))}
          {showErrors && walletMissing ? (
            <Text
              testID="loan-payment-wallet-error"
              className="text-sm text-danger dark:text-danger-dark"
            >
              {iOwe
                ? "Choose which wallet the money came out of."
                : "Choose which wallet the money landed in."}
            </Text>
          ) : null}
        </View>

        {/* THE WAY OUT WHEN NO WALLET FITS. A relative paying the collector
            directly never touched a wallet the app tracks, and forcing that
            through this sheet would invent a transaction in a wallet whose
            balance is then wrong by exactly the amount. Rule 13 has its own
            answer for it, and this is the pointer to it — put in front of the
            user at the moment they are about to pick the wrong wallet, not
            buried on a screen they would have to know to look for. */}
        <Text testID="loan-payment-adjustment-hint" className="text-secondary text-fg-2 dark:text-fg-2-dark">
          Money that never touched a wallet the app tracks belongs in a balance
          adjustment instead — that changes the balance without inventing a
          transaction.
        </Text>

        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              testID="loan-payment-cancel"
              title="Cancel"
              variant="secondary"
              onPress={() => {
                reset();
                onDismiss();
              }}
            />
          </View>
          <View className="flex-1">
            <Button
              testID="loan-payment-confirm"
              title="Record payment"
              onPress={confirm}
              loading={record.isPending}
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
