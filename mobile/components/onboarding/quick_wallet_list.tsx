// components/onboarding/quick_wallet_list.tsx — the onboarding wallet step's
// editable proposal list (m3c-onboarding-client plan Task 3, rule 2;
// docs/04-features/01-onboarding.md step 7).
//
// PURELY PRESENTATIONAL, same split every other onboarding step keeps
// (provider_picker.tsx is the model): the caller (app/(onboarding)/wallets.tsx)
// owns deriving the proposals and writing them to the database; this component
// only renders the list and reports edits. It never imports a repository.
//
// EVERY ROW STARTS EDITABLE, NOT JUST VISIBLE. Docs step 7: "The user can
// rename, change type, ... or remove any proposal" — so a row's name is a
// TextInput from the first frame, not a label that becomes one after a tap,
// and its type is a set of chips rather than a fixed badge. "Creating five
// wallets in five taps" (task-3-brief rule 2) is the one tap on the primary
// button once every row already looks right — never five separate edit flows.
//
// A ROW CAN BE EXCLUDED WITHOUT BEING REMOVED FROM THE LIST. Docs step 7 says
// "remove any proposal"; this keeps the row on screen, unchecked, rather than
// deleting it outright, so an accidental uncheck is a second tap away from
// undone instead of a re-add from scratch.
import { Pressable, Text, TextInput, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom } from "@/lib/money/peso_input";
import { WALLET_TYPE_LABELS, WALLET_TYPE_ORDER } from "@/lib/wallets/summary";
import type { PesoInput } from "@/lib/money/peso_input";
import type { WalletType } from "@/types/domain";

export type WalletProposal = {
  /** Stable across re-renders: the package name, or "cash" for the one cash row. */
  key: string;
  name: string;
  type: WalletType;
  /** `null` for the cash proposal — the only row with no matcher to attach. */
  packageName: string | null;
  /** Whether this proposal will actually be created when the step submits. */
  included: boolean;
  /**
   * What the user has KEYED for "what's already in it" (device-testing fix,
   * 2026-08-18, Task 4), as PESOS — "3000" is ₱3,000.00 and a fraction needs
   * an explicit "." (numeric-input-system Task 13; `lib/money/peso_input.ts`).
   *
   * RENAMED FROM `openingBalanceDigits`. The old name said centavo-digits and
   * it was true — the helper this field used to go through read "3000" as
   * ₱30.00. Under `centavosFrom` the identical string is ₱3,000.00, so a name
   * promising digits is now a standing invitation to seed this field with
   * `String(someCentavos)` and inflate it 100× — the exact bug already found
   * twice in this workstream. Seed it with `pesoInputFrom` or not at all.
   *
   * Blank is a real, optional answer: it means ₱0.00 and must never block
   * Continue.
   */
  openingBalanceText: PesoInput;
};

export type QuickWalletListProps = {
  proposals: WalletProposal[];
  onRename: (key: string, name: string) => void;
  onChangeType: (key: string, type: WalletType) => void;
  onToggleIncluded: (key: string) => void;
  onChangeOpeningBalance: (key: string, text: PesoInput) => void;
  testID?: string;
};

function ProposalRow({
  proposal,
  onRename,
  onChangeType,
  onToggleIncluded,
  onChangeOpeningBalance,
}: {
  proposal: WalletProposal;
  onRename: (key: string, name: string) => void;
  onChangeType: (key: string, type: WalletType) => void;
  onToggleIncluded: (key: string) => void;
  onChangeOpeningBalance: (key: string, text: PesoInput) => void;
}) {
  const { key, name, type, packageName, included, openingBalanceText } = proposal;

  return (
    <View testID={`wallet-proposal-${key}`} className="gap-2 rounded-2xl bg-surface p-4 dark:bg-surface-dark">
      <View className="flex-row items-center gap-3">
        <Pressable
          testID={`wallet-proposal-toggle-${key}`}
          onPress={() => onToggleIncluded(key)}
          accessibilityRole="checkbox"
          accessibilityLabel={`Include ${name || "this wallet"}`}
          accessibilityState={{ checked: included }}
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <View
            className={
              included
                ? "h-5 w-5 items-center justify-center rounded border-2 border-brand bg-brand dark:border-brand-dark dark:bg-brand-dark"
                : "h-5 w-5 rounded border-2 border-fg-2 dark:border-fg-2-dark"
            }
          >
            {included ? (
              <Text className="text-xs font-semibold text-surface dark:text-surface-dark">✓</Text>
            ) : null}
          </View>
        </Pressable>

        <TextInput
          testID={`wallet-proposal-name-${key}`}
          value={name}
          onChangeText={(text) => onRename(key, text)}
          editable={included}
          accessibilityLabel={`Wallet name${packageName ? ` for ${packageName}` : ""}`}
          className={`flex-1 rounded-lg border px-3 py-2 ${
            included
              ? "border-fg-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
              : "border-fg-2 text-fg-2 dark:border-fg-2-dark dark:text-fg-2-dark"
          }`}
        />
      </View>

      {packageName ? (
        <Text testID={`wallet-proposal-package-${key}`} className="text-xs text-fg-2 dark:text-fg-2-dark">
          {packageName}
        </Text>
      ) : (
        <Text testID={`wallet-proposal-cash-note-${key}`} className="text-xs text-fg-2 dark:text-fg-2-dark">
          For cash you spend by hand — jeepney fares, palengke runs.
        </Text>
      )}

      {/* Cash has exactly one type by definition (WalletForm's own rule); a
          chip row that let it become "bank" would be a wallet the matcher
          picker elsewhere assumes never has any matchers. */}
      {packageName ? (
        <View className="flex-row flex-wrap gap-2">
          {WALLET_TYPE_ORDER.filter((candidate) => candidate !== "cash").map((candidate) => (
            <Pressable
              key={candidate}
              testID={`wallet-proposal-type-${key}-${candidate}`}
              onPress={() => onChangeType(key, candidate)}
              disabled={!included}
              accessibilityRole="button"
              accessibilityState={{ selected: type === candidate, disabled: !included }}
              className={`rounded-full px-3 py-1 ${
                type === candidate
                  ? "bg-brand-soft dark:bg-brand-soft-dark"
                  : "bg-bg dark:bg-bg-dark"
              }`}
            >
              <Text
                className={
                  type === candidate
                    ? "text-sm text-brand dark:text-brand-dark"
                    : "text-sm text-fg-2 dark:text-fg-2-dark"
                }
              >
                {WALLET_TYPE_LABELS[candidate]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Task 4 rule 1: optional, blank by default. Blank means ₱0.00, a real
          answer, not a missing one, so it carries no error state and never
          blocks Continue.

          THE APP'S OWN KEYPAD, NOT THE OS NUMBER PAD (numeric-input-system
          Task 13). This is the field behind the owner's original report —
          100000 typed here used to read as 100000 CENTAVOS, ₱1,000.00. It now
          reads as pesos, and the field itself shows the grouped figure while
          it is being typed, so the reading is on screen before Continue.

          NumericField has no `editable`/`disabled` prop, so an excluded row is
          disabled the way components/goals/allocation_sheet.tsx disables a
          skipped one: pointerEvents on the wrapper, which leaves the amount
          visible but genuinely un-pressable. The dimming that
          `editable={included}` used to carry in text colour moves to the
          wrapper's opacity, since the field owns its own classes. */}
      <View className="gap-1">
        <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
          What&apos;s in it right now? (optional)
        </Text>
        <View pointerEvents={included ? "auto" : "none"} className={included ? "" : "opacity-50"}>
          <NumericField
            testID={`wallet-proposal-balance-${key}`}
            label={`Opening balance for ${name || "this wallet"}`}
            mode="peso"
            // "Optional", not the old "0". A keypad field cannot be typed
            // into directly, so its placeholder is the only thing standing in
            // for an empty value — and a "0" there reads as a figure already
            // entered rather than as a question not yet answered.
            placeholder="Optional"
            value={openingBalanceText}
            onChangeText={(text) => onChangeOpeningBalance(key, text)}
          />
        </View>
        <AmountText
          testID={`wallet-proposal-balance-preview-${key}`}
          amount={centavosFrom(openingBalanceText)}
          size="sm"
          showSign={false}
        />
      </View>
    </View>
  );
}

export function QuickWalletList({
  proposals,
  onRename,
  onChangeType,
  onToggleIncluded,
  onChangeOpeningBalance,
  testID = "quick-wallet-list",
}: QuickWalletListProps) {
  return (
    <View testID={testID} className="gap-3">
      {proposals.map((proposal) => (
        <ProposalRow
          key={proposal.key}
          proposal={proposal}
          onRename={onRename}
          onChangeType={onChangeType}
          onToggleIncluded={onToggleIncluded}
          onChangeOpeningBalance={onChangeOpeningBalance}
        />
      ))}
    </View>
  );
}
