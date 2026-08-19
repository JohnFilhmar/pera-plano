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

import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import { NumericField } from "@/components/ui/numeric_field";
import { SectionHeader } from "@/components/ui/section_header";
import { centavosFrom } from "@/lib/money/peso_input";
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
      openingBalance: centavosFrom(balanceText),
      matchers: type === "cash" ? [] : matchers,
    });
  }

  return (
    // No `pb-8` any more (numeric-input-system Task 13). Both routes wrap this
    // form in FormScreen, whose contentContainerStyle already reserves
    // Math.max(keypadHeight, 0) + 24 at the bottom; a second bottom padding
    // here would double-count that edge — the defect Task 9's fix round
    // removed from the manual-entry form.
    <View testID={testID} className="gap-2">
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
