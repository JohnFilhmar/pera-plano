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
//
// RESTYLE (mobile-ui-revamp Part 3 Task 6). Every row now carries a
// `ProviderBadge` (or, for the one proposal with no provider — cash —
// `WalletTypeIcon`) so the row reads as "which app/wallet is this" at a
// glance instead of a bare checkbox. `proposal.name` was already routed
// through `providerLabel()` at the call site (app/(onboarding)/wallets.tsx's
// `defaultNameFor`, since commit 9d36c05) — the badge is what was actually
// missing, not the label. The wallet-type row becomes a row of `Chip`s
// (soft brand fill when selected) rather than hand-rolled pills, and the
// balance preview moves beside the name so "the balance" reads on the right
// of the row the way the design draws it, while the editable field itself
// (the actual keypad trigger) stays where it was, below.
import { Pressable, Text, TextInput, View } from "react-native";
import { Check } from "lucide-react-native";

import { AmountText } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { NumericField } from "@/components/ui/numeric_field";
import { ProviderBadge } from "@/components/ui/provider_badge";
import { WalletTypeIcon } from "@/components/wallets/wallet_type_icon";
import { centavosFrom } from "@/lib/money/peso_input";
import { WALLET_TYPE_LABELS, WALLET_TYPE_ORDER } from "@/lib/wallets/summary";
import type { PesoInput } from "@/lib/money/peso_input";
import type { WalletType } from "@/types/domain";

const CheckGlyph = registerIcon(Check);

export type WalletProposal = {
  /** Stable across re-renders: the package name, or "cash" for the one cash row. */
  key: string;
  name: string;
  type: WalletType;
  /** `null` for the cash proposal — the only row with no matcher to attach. */
  packageName: string | null;
  /**
   * The ruleset's `providerKey` (e.g. `"gcash"`) this proposal was built
   * from — absent or `null` for the cash proposal, which has no provider at
   * all. `components/ui/provider_badge.tsx` is keyed on this, not on
   * `packageName`: a badge looked up by Android package id (e.g.
   * `"com.globe.gcash.android"`) would miss `PROVIDER_BADGE`'s table
   * entirely and fall back to a grey square with a "c" on it.
   *
   * OPTIONAL, NOT REQUIRED — deliberately, so a fixture built before this
   * field existed (components/onboarding/__tests__/quick_wallet_list.test.tsx's
   * own `makeProposal()`, out of this task's file list) keeps compiling
   * unmodified. A proposal with no `providerKey` at all renders the same
   * `WalletTypeIcon` fallback cash gets — the answer this file already had
   * for "no provider to badge" before this field existed.
   */
  providerKey?: string | null;
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
  const { key, name, type, packageName, providerKey, included, openingBalanceText } = proposal;

  return (
    <View
      testID={`wallet-proposal-${key}`}
      className={`gap-3 rounded-2xl border p-4 ${
        included
          ? "border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
          : "border-line bg-bg dark:border-line-dark dark:bg-bg-dark"
      }`}
    >
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
                ? "h-5 w-5 items-center justify-center rounded-full bg-brand dark:bg-brand-dark"
                : "h-5 w-5 rounded-full border border-line dark:border-line-dark"
            }
          >
            {included ? <CheckGlyph size={12} className="text-on-brand dark:text-on-brand-dark" /> : null}
          </View>
        </Pressable>

        {/* The identity glyph: a real ProviderBadge for every provider-linked
            proposal, and the matching WalletTypeIcon for the one proposal
            that has no provider at all — cash. */}
        {providerKey ? (
          <ProviderBadge providerKey={providerKey} size={20} />
        ) : (
          <WalletTypeIcon type={type} size={20} className="text-fg-2 dark:text-fg-2-dark" />
        )}

        <TextInput
          testID={`wallet-proposal-name-${key}`}
          value={name}
          onChangeText={(text) => onRename(key, text)}
          editable={included}
          accessibilityLabel={`Wallet name${packageName ? ` for ${packageName}` : ""}`}
          className={`flex-1 rounded-lg border px-3 py-2 text-row font-semibold ${
            included
              ? "border-line text-fg dark:border-line-dark dark:text-fg-dark"
              : "border-line text-fg-2 dark:border-line-dark dark:text-fg-2-dark"
          }`}
        />

        {/* "Balance on the right" — the same figure the keypad field below
            edits, read at a glance without opening it. */}
        <AmountText
          testID={`wallet-proposal-balance-preview-${key}`}
          amount={centavosFrom(openingBalanceText)}
          size="sm"
          showSign={false}
        />
      </View>

      {packageName ? (
        <Text
          testID={`wallet-proposal-package-${key}`}
          className="text-micro font-medium text-fg-2 dark:text-fg-2-dark"
        >
          {packageName}
        </Text>
      ) : (
        <Text
          testID={`wallet-proposal-cash-note-${key}`}
          className="text-micro font-medium text-fg-2 dark:text-fg-2-dark"
        >
          For cash you spend by hand — jeepney fares, palengke runs.
        </Text>
      )}

      {/* Cash has exactly one type by definition (WalletForm's own rule); a
          chip row that let it become "bank" would be a wallet the matcher
          picker elsewhere assumes never has any matchers. */}
      {packageName ? (
        <View className="flex-row flex-wrap gap-2">
          {WALLET_TYPE_ORDER.filter((candidate) => candidate !== "cash").map((candidate) => (
            <Chip
              key={candidate}
              testID={`wallet-proposal-type-${key}-${candidate}`}
              label={WALLET_TYPE_LABELS[candidate]}
              tone="brand"
              fill={type === candidate ? "soft" : "outline"}
              // A Chip with no `onPress` renders as an inert label rather
              // than a disabled Pressable (its own header explains why) —
              // the right shape for a row the user unchecked: nothing left
              // here to edit until it is checked again.
              onPress={included ? () => onChangeType(key, candidate) : undefined}
            />
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

          An excluded row uses NumericField's own `disabled`, the direct
          replacement for the old `editable={included}` — it carries the
          dimming and the disabled accessibility state that a
          pointerEvents wrapper could not. */}
      <View className="gap-1">
        <Text className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
          What&apos;s in it right now? (optional)
        </Text>
        <NumericField
          testID={`wallet-proposal-balance-${key}`}
          label={`Opening balance for ${name || "this wallet"}`}
          mode="peso"
          disabled={!included}
          // "Optional", not the old "0". A keypad field cannot be typed
          // into directly, so its placeholder is the only thing standing in
          // for an empty value — and a "0" there reads as a figure already
          // entered rather than as a question not yet answered.
          placeholder="Optional"
          value={openingBalanceText}
          onChangeText={(text) => onChangeOpeningBalance(key, text)}
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
