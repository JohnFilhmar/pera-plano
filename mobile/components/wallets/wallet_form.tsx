// components/wallets/wallet_form.tsx — m1c plan Task 5. One form, two routes:
// app/wallet/new.tsx and app/wallet/[id]/edit.tsx.
//
// THE TYPE QUESTION IS GONE, AND WITH IT THE ONLY REQUIRED FIELD BESIDES THE
// NAME. This form used to demand one of bank / e-wallet / savings / credit /
// cash before it would submit. That was a taxonomy the user did not think in,
// forced to one answer when a provider app commonly fronts several kinds of
// account, and asked before a single transaction existed to judge it by.
//
// WHAT THE FIVE VALUES ACTUALLY DID, AND WHERE THEY WENT. "credit" decided
// whether the balance counted as money owed — now inferred and correctable
// (lib/wallets/classification.ts). "cash" decided whether the matcher picker
// appeared — now simply whether the user picks any matchers, which is the same
// fact stated by the control they were already using. The other three chose an
// icon. So the picker below is a matcher picker and nothing else: choosing no
// notification source is what makes a wallet manual.
//
// THE OPENING BALANCE IS A CREATE-ONLY FIELD. `updateWallet` refuses to patch
// `balance` on purpose — it is the ledger's running total, moved only by the
// transaction that explains the move — so an edit form offering it would be a
// back door into a number no transaction accounts for. Adjusting a real balance
// goes through cash reconciliation, which writes that explaining transaction.
//
// Presentational: it validates and reports, and the routes own every read and
// write (Global Constraints: no repository import inside a component).
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { NumericField } from "@/components/ui/numeric_field";
import { SectionHeader } from "@/components/ui/section_header";
import { centavosFrom } from "@/lib/money/peso_input";
import type { MatcherOwner } from "@/lib/wallets/matchers";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { Centavos, NewWalletMatcher } from "@/types/domain";

import { MatcherPicker } from "./matcher_picker";

export type WalletFormValues = {
  name: string;
  openingBalance: Centavos;
  matchers: NewWalletMatcher[];
};

export type WalletFormProps = {
  initial?: Partial<WalletFormValues>;
  submitLabel: string;
  onSubmit: (values: WalletFormValues) => void;
  submitting?: boolean;
  /** A failed save, in the user's words — a duplicate name, most often. */
  errorMessage?: string | null;
  providers?: readonly ProviderRuleset[];
  owners?: readonly MatcherOwner[];
  /** The wallet being edited, so the picker does not warn it about itself. */
  walletId?: string;
  /** Create only. See the file header for why editing cannot offer it. */
  showOpeningBalance?: boolean;
  testID?: string;
};

export function WalletForm({
  initial,
  submitLabel,
  onSubmit,
  submitting = false,
  errorMessage,
  providers = [],
  owners = [],
  walletId,
  showOpeningBalance = false,
  testID = "wallet-form",
}: WalletFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  // WHAT THE USER KEYED, not a parsed number — centavos are derived from it on
  // submit and a formatted string is never parsed back (lib/money/peso_input.ts).
  //
  // ALWAYS "", NEVER SEEDED FROM `initial` (numeric-input-system Task 13's
  // seeding audit). `initial.openingBalance` is Centavos and the field is
  // PESO TEXT, so a future `String(initial.openingBalance)` here would be a
  // silent 100× — the bug already found twice in this workstream. There is
  // nothing to seed anyway: the field is create-only (file header), and a
  // brand-new wallet has no balance yet. Should a seeded default ever be
  // wanted, it is `pesoInputFrom(initial.openingBalance)` and nothing else.
  const [balanceText, setBalanceText] = useState("");
  const [matchers, setMatchers] = useState<NewWalletMatcher[]>(initial?.matchers ?? []);
  const [showErrors, setShowErrors] = useState(false);

  const trimmedName = name.trim();
  const nameMissing = trimmedName === "";

  function submit(): void {
    if (submitting) return;
    if (nameMissing) {
      setShowErrors(true);
      return;
    }
    onSubmit({
      name: trimmedName,
      openingBalance: centavosFrom(balanceText),
      // Whatever the user picked, including nothing. An empty list is not a
      // missing answer here — it is the answer that makes this a wallet the
      // app cannot track for them.
      matchers,
    });
  }

  return (
    // No `pb-8` any more (numeric-input-system Task 13). Both routes wrap this
    // form in FormScreen, whose contentContainerStyle already reserves
    // Math.max(keypadHeight, 0) + 24 at the bottom; a second bottom padding
    // here would double-count that edge — the defect Task 9's fix round
    // removed from the manual-entry form.
    <View testID={testID} className="gap-2">
      {/* task-5b field rhythm: a `text-micro font-semibold text-fg-2` label
          above every control, the control itself on `bg-chip rounded-xl
          min-h-[44px]` — filled, not outlined, matching the design's chip-
          background inputs rather than the old bordered box. */}
      <View className="gap-1 px-4 pt-4">
        <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">Name</Text>
        <TextInput
          testID="wallet-form-name"
          value={name}
          onChangeText={setName}
          autoCorrect={false}
          placeholder="GCash, BPI, Pocket money…"
          accessibilityLabel="Wallet name"
          className="min-h-[44px] rounded-xl bg-chip px-3 py-2 text-fg dark:bg-chip-dark dark:text-fg-dark"
        />
        {showErrors && nameMissing ? (
          <Text testID="wallet-form-name-error" className="text-sm text-danger dark:text-danger-dark">
            Give this wallet a name — you will pick it from lists later.
          </Text>
        ) : null}
      </View>

      {showOpeningBalance ? (
        <View className="gap-1 px-4 pt-4">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
            What is in it right now? (optional)
          </Text>
          {/* THE APP'S OWN KEYPAD, NOT THE OS NUMBER PAD (numeric-input-system
              Task 13). "1000" here is ₱1,000.00 now; it used to be ₱10.00,
              and the same field in onboarding is where the owner typed 100000
              and was shown ₱1,000.00.

              "Optional", not the old "0", as the empty-state text: a keypad
              field cannot be typed into directly, so its placeholder is the
              only thing standing in for an empty value, and a "0" there reads
              as a figure already entered rather than a question unanswered. */}
          <NumericField
            testID="wallet-form-opening-balance"
            label="Opening balance"
            mode="peso"
            placeholder="Optional"
            value={balanceText}
            onChangeText={setBalanceText}
          />
          {/* The field shows what is being typed; this states the figure the
              way the ledger will hold it, centavos included — the same echo
              the income and limit amount fields keep. */}
          <AmountText
            testID="wallet-form-opening-balance-preview"
            amount={centavosFrom(balanceText)}
            size="lg"
            showSign={false}
          />
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
            This is a starting point, not a transaction — nothing is added to your ledger.
          </Text>
        </View>
      ) : null}

      {/* ALWAYS SHOWN NOW, AND IT IS THE ONLY PLACE "cash" ever lived. A user
          who picks nothing here has made a manual wallet — the app will not
          pretend it can track it, and the reconcile sheet becomes available on
          the detail screen. The section used to be hidden entirely for a wallet
          typed as cash; there is no type to hide it by any more, and hiding it
          by "no matchers yet" would remove the very control needed to add one. */}
      <View>
        <SectionHeader title="Which notifications land here?" />
        <MatcherPicker
          providers={providers}
          value={matchers}
          onChange={setMatchers}
          owners={owners}
          walletId={walletId}
        />
      </View>

      {errorMessage ? (
        <Text testID="wallet-form-error" className="px-4 text-danger dark:text-danger-dark">
          {errorMessage}
        </Text>
      ) : null}

      <View className="px-4 pt-4">
        <Button
          testID="wallet-form-submit"
          title={submitLabel}
          onPress={submit}
          loading={submitting}
        />
      </View>
    </View>
  );
}
