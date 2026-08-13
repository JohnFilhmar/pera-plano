// components/wallets/wallet_form.tsx — m1c plan Task 5. One form, two routes:
// app/wallet/new.tsx and app/wallet/[id]/edit.tsx.
//
// NAME AND TYPE ARE BOTH REQUIRED, AND TYPE HAS NO DEFAULT. A pre-selected
// "bank" would make every wallet a bank for anyone who tapped past the field,
// and `type` is not cosmetic: it decides whether the matcher UI appears at all
// (cash has none), whether reconciliation is offered, and whether the balance
// counts as money owed rather than money held (credit, spec rule 23).
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

import { AmountText, centavosFromDigits } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import { SectionHeader } from "@/components/ui/section_header";
import { WALLET_TYPE_LABELS, WALLET_TYPE_ORDER } from "@/lib/wallets/summary";
import type { MatcherOwner } from "@/lib/wallets/matchers";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { Centavos, NewWalletMatcher, WalletType } from "@/types/domain";

import { MatcherPicker } from "./matcher_picker";
import { WalletTypeIcon } from "./wallet_type_icon";

export type WalletFormValues = {
  name: string;
  type: WalletType;
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
  const [type, setType] = useState<WalletType | null>(initial?.type ?? null);
  // The RAW DIGITS, not a parsed number: centavos are built from keystrokes and
  // a formatted string is never parsed back (see `centavosFromDigits`).
  const [balanceDigits, setBalanceDigits] = useState("");
  const [matchers, setMatchers] = useState<NewWalletMatcher[]>(initial?.matchers ?? []);
  const [showErrors, setShowErrors] = useState(false);

  const trimmedName = name.trim();
  const nameMissing = trimmedName === "";
  const typeMissing = type === null;
  const isCash = type === "cash";

  function chooseType(next: WalletType): void {
    setType(next);
    // Spec rule 4: cash wallets have empty `matchers[]` and the matcher UI is
    // hidden for them. Merely HIDING the picker while keeping what it held
    // would leave a cash wallet catching GCash with nothing on screen that says
    // so — a route the user can neither see nor remove.
    if (next === "cash") setMatchers([]);
  }

  function submit(): void {
    if (submitting) return;
    if (nameMissing || type === null) {
      setShowErrors(true);
      return;
    }
    onSubmit({
      name: trimmedName,
      type,
      openingBalance: centavosFromDigits(balanceDigits),
      matchers: type === "cash" ? [] : matchers,
    });
  }

  return (
    <View testID={testID} className="gap-2 pb-8">
      <View className="gap-1 px-4 pt-4">
        <Text className="text-sm text-fg-2 dark:text-fg-2-dark">Name</Text>
        <TextInput
          testID="wallet-form-name"
          value={name}
          onChangeText={setName}
          autoCorrect={false}
          placeholder="GCash, BPI, Pocket money…"
          accessibilityLabel="Wallet name"
          className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
        />
        {showErrors && nameMissing ? (
          <Text testID="wallet-form-name-error" className="text-sm text-danger dark:text-danger-dark">
            Give this wallet a name — you will pick it from lists later.
          </Text>
        ) : null}
      </View>

      <SectionHeader title="What kind of money location is this?" />
      {WALLET_TYPE_ORDER.map((candidate) => (
        <ListRow
          key={candidate}
          testID={`wallet-form-type-${candidate}`}
          title={WALLET_TYPE_LABELS[candidate]}
          left={<WalletTypeIcon type={candidate} />}
          onPress={() => chooseType(candidate)}
          right={type === candidate ? <Chip label="Selected" tone="brand" /> : undefined}
        />
      ))}
      {showErrors && typeMissing ? (
        <Text
          testID="wallet-form-type-error"
          className="px-4 text-sm text-danger dark:text-danger-dark"
        >
          Pick what kind of money location this is — it decides how the wallet is tracked.
        </Text>
      ) : null}

      {showOpeningBalance ? (
        <View className="gap-1 px-4 pt-4">
          <Text className="text-sm text-fg-2 dark:text-fg-2-dark">
            What is in it right now? (optional)
          </Text>
          <TextInput
            testID="wallet-form-opening-balance"
            value={balanceDigits}
            onChangeText={setBalanceDigits}
            keyboardType="number-pad"
            placeholder="0"
            accessibilityLabel="Opening balance"
            className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
          />
          <AmountText
            testID="wallet-form-opening-balance-preview"
            amount={centavosFromDigits(balanceDigits)}
            size="lg"
            showSign={false}
          />
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
            This is a starting point, not a transaction — nothing is added to your ledger.
          </Text>
        </View>
      ) : null}

      {/* Rule 4 again: nothing at all for cash, not a disabled section. An
          empty "Notifications" heading on a cash wallet reads as a feature that
          failed to load rather than as one that cannot apply. */}
      {!isCash && type !== null ? (
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
      ) : null}

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
