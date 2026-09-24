// components/transactions/transaction_edit_form.tsx — editing a COMMITTED
// transaction's parsed fields (GAP-061; docs/07-privacy-and-compliance.md's
// right-to-rectification row and its "Edit anything" table row).
//
// WHY THIS IS NOT `CorrectSheet` AND NOT `ManualEntryForm`, both of which edit
// the same five fields. `CorrectSheet` takes a `ReviewQueueItem` and exists to
// report a diff that decides whether a UserRule is created; a committed row is
// not a queue item, and reusing it would mean manufacturing a fake item and
// dragging rule-creation semantics onto a screen that has no business teaching
// the parser anything. `ManualEntryForm` is built around "amount first is the
// whole design" — a numpad landing state and defaults for a row that does not
// exist yet — which is the opposite of changing one field on a row that does.
// What all three share is the PRIMITIVES (`NumericField`, `SegmentedControl`,
// the wallet rows), and that is the right amount of sharing: one set of
// controls, three sets of semantics.
//
// IT REPORTS A PATCH OF CHANGED FIELDS ONLY, and that is correctness rather
// than tidiness. `useUpdateTransaction` narrows its cache invalidation on
// `patch.walletId === undefined` — one wallet's detail key when the row stayed
// put, the whole wallets family when it moved. Sending every field on every
// save would make that test always false and quietly widen every edit to a
// full-family invalidation.
//
// Presentational: it validates and reports. The route owns every read and
// write (Global Constraints: no repository import inside a component).
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { NumericField } from "@/components/ui/numeric_field";
import { SegmentedControl } from "@/components/ui/segmented_control";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

import type { Centavos, Transaction, TxDirection, Wallet } from "@/types/domain";

/** Same two segments as `manual_entry_form.tsx`, and for the same reason:
 * `TxDirection` is exactly `"in" | "out"`, so Transfer is not a third member.
 * A transfer leg cannot reach this form at all — see the route. */
const DIRECTION_SEGMENTS = [
  { value: "out", label: "Expense" },
  { value: "in", label: "Income" },
] as const;

/** The fields this form may change. A deliberate subset of `TransactionPatch`:
 * `occurredAt`, `counterparty` and `referenceNo` are not offered, because
 * docs/07's "Edit anything" row names amount, direction, walletId, categoryId,
 * merchant and note, and category and note already have their own controls on
 * the detail screen. */
export type TransactionEditPatch = {
  amount?: Centavos;
  direction?: TxDirection;
  walletId?: string;
  merchant?: string | null;
  /** Only ever set to null, and only alongside `merchant: null` — see
   * `MERCHANT REMOVAL HAS TO ERASE BOTH` in the save path below. */
  counterparty?: string | null;
};

export type TransactionEditFormProps = {
  transaction: Transaction;
  wallets: readonly Wallet[];
  onSave: (patch: TransactionEditPatch) => void;
  onCancel: () => void;
  saving?: boolean;
  errorMessage?: string | null;
  testID?: string;
};

/**
 * The edit surface for a committed transaction's amount, direction, wallet and
 * merchant.
 *
 * @param transaction The row being edited. Every field seeds from it, so a save
 *   with nothing touched produces an empty patch and the route can skip the
 *   write entirely.
 * @param wallets Every wallet, archived included. The picker hides archived
 *   ones EXCEPT the row's current wallet — see `selectable`.
 * @param onSave Receives only the fields that actually changed.
 * @param onCancel Leaves without writing.
 * @param saving Disables Save while the route's write is in flight.
 * @param errorMessage A failure from the route's write, or null.
 */
export function TransactionEditForm({
  transaction,
  wallets,
  onSave,
  onCancel,
  saving = false,
  errorMessage = null,
  testID = "transaction-edit-form",
}: TransactionEditFormProps) {
  const placeholderColor = usePlaceholderColor();

  const [amountText, setAmountText] = useState(() => pesoInputFrom(Math.trunc(transaction.amount)));
  const [direction, setDirection] = useState<TxDirection>(transaction.direction);
  const [walletId, setWalletId] = useState(transaction.walletId);
  // SEEDED FROM WHAT THE DETAIL SCREEN SHOWS, which is `merchant` falling back
  // to `counterparty`. Seeding from `merchant` alone would open this field
  // EMPTY on a row whose detail screen plainly displays a name, and a save
  // would then look like the user had cleared something they never touched.
  const displayedMerchant = transaction.merchant ?? transaction.counterparty ?? "";
  const [merchant, setMerchant] = useState(displayedMerchant);

  // Archived wallets are hidden from every picker (spec), but the wallet this
  // row is ALREADY on has to stay pickable or an edit to a transaction sitting
  // on an archived wallet could not keep its own wallet — the user would be
  // forced to move money they only wanted to retype the amount of.
  const selectable = useMemo(() => {
    const active = wallets.filter((wallet) => !wallet.isArchived);
    if (active.some((wallet) => wallet.id === transaction.walletId)) return active;
    const current = wallets.find((wallet) => wallet.id === transaction.walletId);
    return current ? [current, ...active] : active;
  }, [wallets, transaction.walletId]);

  const amount = centavosFrom(amountText);
  const amountIsValid = amount > 0;

  // Trimmed, so a label edited down to spaces reads as removed rather than as
  // the string " ". Compared against what was DISPLAYED rather than against
  // `transaction.merchant`, so a row carrying only a counterparty does not
  // report a change nobody made.
  const trimmedMerchant = merchant.trim();
  const merchantChanged = trimmedMerchant !== displayedMerchant;

  function save(): void {
    if (!amountIsValid || saving) return;
    const patch: TransactionEditPatch = {};
    if (amount !== transaction.amount) patch.amount = amount;
    if (direction !== transaction.direction) patch.direction = direction;
    if (walletId !== transaction.walletId) patch.walletId = walletId;

    if (merchantChanged) {
      if (trimmedMerchant === "") {
        // MERCHANT REMOVAL HAS TO ERASE BOTH FIELDS. The detail screen renders
        // `merchant ?? counterparty`, so nulling `merchant` alone makes the
        // parser's raw counterparty surface in its place and the name the user
        // just deleted REAPPEARS. docs/07 §11.2 rule 4 promises the label can be
        // "edited or removed", and §11.2 rule 2's whole point is that a third
        // party's name does not linger on the device — a removal that leaves it
        // in another column keeps the name and only hides which column it is in.
        if (transaction.merchant !== null) patch.merchant = null;
        if (transaction.counterparty !== null) patch.counterparty = null;
      } else {
        // A RELABEL, NOT AN ERASURE, so `counterparty` is left alone: it is the
        // parser's own record of what the notification said, and loan payment
        // matching reads it (docs/07 §11.2 rule 2).
        patch.merchant = trimmedMerchant;
      }
    }

    onSave(patch);
  }

  return (
    <View testID={testID} className="gap-6 px-4 py-6">
      <NumericField
        testID="transaction-edit-amount"
        label="Amount"
        value={amountText}
        onChangeText={setAmountText}
        mode="peso"
        bordered
      />
      {!amountIsValid ? (
        <Text
          testID="transaction-edit-amount-error"
          className="text-danger dark:text-danger-dark"
        >
          Enter an amount greater than zero.
        </Text>
      ) : null}

      <View className="gap-2">
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Direction</Text>
        <SegmentedControl
          testID="transaction-edit-direction"
          segments={DIRECTION_SEGMENTS}
          value={direction}
          onChange={setDirection}
        />
      </View>

      <View className="gap-2">
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Wallet</Text>
        {selectable.map((wallet) => (
          <Pressable
            key={wallet.id}
            testID={`transaction-edit-wallet-${wallet.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: walletId === wallet.id }}
            accessibilityLabel={wallet.name}
            onPress={() => setWalletId(wallet.id)}
            className={`flex-row items-center justify-between rounded-xl px-4 py-3 ${
              walletId === wallet.id
                ? "bg-brand dark:bg-brand-dark"
                : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text
              className={
                walletId === wallet.id
                  ? "font-semibold text-on-brand dark:text-on-brand-dark"
                  : "text-fg dark:text-fg-dark"
              }
            >
              {wallet.name}
            </Text>
            {wallet.isArchived ? <Chip label="ARCHIVED" /> : null}
          </Pressable>
        ))}
      </View>

      <View className="gap-2">
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Merchant</Text>
        <TextInput
          placeholderTextColor={placeholderColor}
          testID="transaction-edit-merchant"
          value={merchant}
          onChangeText={setMerchant}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="Not recorded"
          accessibilityLabel="Merchant"
          className="min-h-[44px] rounded-xl bg-bg px-3 py-2 text-base text-fg dark:bg-bg-dark dark:text-fg-dark"
        />
        <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
          Clear this field to remove the merchant name from this transaction.
        </Text>
      </View>

      {errorMessage ? (
        <Text testID="transaction-edit-error" className="text-danger dark:text-danger-dark">
          {errorMessage}
        </Text>
      ) : null}

      <View className="gap-3">
        <Button
          title="Save changes"
          testID="transaction-edit-save"
          disabled={!amountIsValid}
          loading={saving}
          onPress={save}
        />
        <Button
          title="Cancel"
          variant="secondary"
          testID="transaction-edit-cancel"
          onPress={onCancel}
        />
      </View>
    </View>
  );
}
