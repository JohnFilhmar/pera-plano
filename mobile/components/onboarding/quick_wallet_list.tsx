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

import { WALLET_TYPE_LABELS, WALLET_TYPE_ORDER } from "@/lib/wallets/summary";
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
};

export type QuickWalletListProps = {
  proposals: WalletProposal[];
  onRename: (key: string, name: string) => void;
  onChangeType: (key: string, type: WalletType) => void;
  onToggleIncluded: (key: string) => void;
  testID?: string;
};

function ProposalRow({
  proposal,
  onRename,
  onChangeType,
  onToggleIncluded,
}: {
  proposal: WalletProposal;
  onRename: (key: string, name: string) => void;
  onChangeType: (key: string, type: WalletType) => void;
  onToggleIncluded: (key: string) => void;
}) {
  const { key, name, type, packageName, included } = proposal;

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
    </View>
  );
}

export function QuickWalletList({
  proposals,
  onRename,
  onChangeType,
  onToggleIncluded,
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
        />
      ))}
    </View>
  );
}
