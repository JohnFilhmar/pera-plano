// components/transactions/manual_entry_form.tsx — m1c plan Task 8, rules 1, 3 and 5.
//
// AMOUNT FIRST IS THE WHOLE DESIGN. Cash entry competes with not-bothering:
// every tap before the amount is a reason to skip it, and a cash wallet that
// receives only half its spending is worse than no cash wallet at all, because
// the user believes the total. So the numpad is the landing state and every
// other field is defaulted behind it — four keystrokes and Save must produce a
// complete, correct transaction.
//
// THE WALLET IS THE ONE DEFAULT THAT MAY NOT BE GUESSED. Cash written into a
// bank wallet corrupts both balances at once — the bank stops matching the
// bank, and the pocket money is never counted against the pocket — and nothing
// on screen would say so. When there is no safe answer this form ASKS.
//
// Presentational: it validates and reports. The route owns every read and write
// (Global Constraints: no repository import inside a component). THE AMOUNT IS
// ALSO OWNED BY THE ROUTE (numeric-input-system W1 Task 9): app/transaction/
// new.tsx holds the PesoInput text so its mount effect can hand the shared
// keypad a field to open before this form's own NumericField has ever been
// pressed — see that file's header for the other half of the handoff.
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryPicker } from "@/components/transactions/category_picker";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date_field";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom } from "@/lib/money/peso_input";
import {
  categoryForMerchant,
  lastUsedCashWallet,
  occurredAtFor,
} from "@/lib/transactions/manual_entry";

import type { Category, Centavos, EpochMs, Transaction, TxDirection, Wallet } from "@/types/domain";

export type ManualEntryDraft = {
  amount: Centavos;
  direction: TxDirection;
  walletId: string;
  categoryId: string;
  occurredAt: EpochMs;
  merchant: string | null;
  note: string | null;
};

export type ManualEntryFormProps = {
  testID?: string;
  wallets: Wallet[];
  categories: Category[];
  transactions: Transaction[];
  now: EpochMs;
  /** The typed peso text — see this file's header on why the route owns it. */
  amount: string;
  onAmountChange: (text: string) => void;
  onSubmit: (draft: ManualEntryDraft) => void;
  onCreateCashWallet: () => void;
};

/**
 * The `p-4` this form used to carry, kept as the floor the status-bar inset is
 * added to on the TOP edge only (see the root View below).
 *
 * The bottom edge is FormScreen's job (numeric-input-system W1 Task 9 fix
 * round): this form is now scroll content inside a KeyboardAwareScrollView
 * whose contentContainerStyle already pads for the keypad panel's height, and
 * app/_layout.tsx's rule is that an edge is padded exactly once, by whichever
 * component actually touches it. Padding the bottom here too would
 * double-count against that padding — and `insets.bottom` is also the wrong
 * quantity now anyway, since what covers the last control is the panel, not
 * the nav bar.
 */
const FORM_PADDING = 16;

/** `'YYYY-MM-DD'` for a local day — never `toISOString`, which is UTC. */
function localDayOf(at: EpochMs): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Blank optional text becomes `null`, never `""`. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function ManualEntryForm({
  testID,
  wallets,
  categories,
  transactions,
  now,
  amount,
  onAmountChange,
  onSubmit,
  onCreateCashWallet,
}: ManualEntryFormProps) {
  // This form IS the /transaction/new screen — a full-bleed route outside the
  // tab navigator, so nothing above it clears the status bar or Android's
  // navigation bar (app.json `edgeToEdgeEnabled`). Its Save button is the last
  // thing in the column and was the one landing under ▢ ◁.
  const insets = useSafeAreaInsets();
  const [direction, setDirection] = useState<TxDirection>("out");
  const [day, setDay] = useState(() => localDayOf(now));
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [pickingCategory, setPickingCategory] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Spec: archived wallets are hidden from every picker, and cash is listed
  // first — this screen exists for cash; everything else is the exception.
  const selectable = useMemo(() => {
    const active = wallets.filter((wallet) => !wallet.isArchived);
    return [
      ...active.filter((wallet) => wallet.type === "cash"),
      ...active.filter((wallet) => wallet.type !== "cash"),
    ];
  }, [wallets]);

  const hasCashWallet = selectable.some((wallet) => wallet.type === "cash");
  const defaultWallet = useMemo(
    () => lastUsedCashWallet(wallets, transactions),
    [wallets, transactions],
  );

  // `null` until the user chooses, so the default can keep tracking the props
  // rather than being frozen at first render.
  const [chosenWalletId, setChosenWalletId] = useState<string | null>(null);
  const walletId = chosenWalletId ?? defaultWallet?.id ?? null;

  // A deliberate choice outranks the merchant's history. A default that
  // overwrites what the user picked is worse than no default.
  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(null);
  const categoryId = chosenCategoryId ?? categoryForMerchant(transactions, merchant);

  const amountCentavos = centavosFrom(amount);
  const occurredAt = occurredAtFor(day, now);

  const canSave = amountCentavos > 0;
  const walletMissing = walletId === null;
  const dateInvalid = occurredAt === null;

  const selectedCategory = categories.find((category) => category.id === categoryId);

  function handleSave(): void {
    if (!canSave) return;

    if (walletMissing || dateInvalid) {
      setShowErrors(true);
      return;
    }

    onSubmit({
      amount: amountCentavos,
      direction,
      walletId,
      categoryId,
      occurredAt,
      merchant: trimmedOrNull(merchant),
      note: trimmedOrNull(note),
    });
  }

  return (
    // `px-4` on the class, the top padding in `style`: a `style` prop
    // REPLACES the padding NativeWind compiles from `className` rather than
    // adding to it, so `p-4` and a `paddingTop` inset cannot both be
    // expressed here. FORM_PADDING is the same 16dp `p-4` was, kept as the
    // floor a gesture-navigation phone (inset ≈ 0) still gets. No
    // `paddingBottom` here — see FORM_PADDING's header on why the bottom
    // edge is FormScreen's alone now. `flex-1` is safe against FormScreen's
    // KeyboardAwareScrollView because its contentContainerStyle sets
    // `flexGrow: 1` for it to grow into.
    <View
      testID={testID}
      className="flex-1 gap-6 bg-bg px-4 dark:bg-bg-dark"
      style={{
        paddingTop: FORM_PADDING + insets.top,
      }}
    >
      <NumericField
        testID="manual-amount"
        label="How much?"
        placeholder="₱0"
        value={amount}
        onChangeText={onAmountChange}
      />

      {/* Direction */}
      <View className="flex-row gap-3">
        {(["out", "in"] as const).map((option) => (
          <Pressable
            key={option}
            testID={`manual-entry-direction-${option}`}
            accessibilityRole="button"
            accessibilityState={{ selected: direction === option }}
            accessibilityLabel={option === "out" ? "Money out" : "Money in"}
            onPress={() => setDirection(option)}
            className={`flex-1 items-center rounded-xl py-3 ${
              direction === option
                ? "bg-brand dark:bg-brand-dark"
                : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text
              className={`font-semibold ${
                direction === option
                  ? "text-surface dark:text-surface-dark"
                  : "text-fg dark:text-fg-dark"
              }`}
            >
              {option === "out" ? "Spent" : "Received"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* THE PROMPT THAT REPLACES A DANGEROUS DEFAULT. Shown only when no cash
          wallet exists AND the user has not already resolved it by picking one
          deliberately — manual entry also covers unsupported providers and gap
          backfill, so a non-cash wallet is never the DEFAULT but is never
          forbidden either, and continuing to nag after the choice is noise.
          Two unused cash wallets is a different problem (no evidence which
          pocket), answered by the wallet error below rather than by offering to
          create a third. */}
      {!hasCashWallet && chosenWalletId === null ? (
        <View testID="manual-entry-no-cash" className="gap-2 rounded-xl bg-surface p-4 dark:bg-surface-dark">
          <Text className="font-semibold text-fg dark:text-fg-dark">No cash wallet yet</Text>
          <Text className="text-fg-2 dark:text-fg-2-dark">
            Cash needs its own wallet — putting it in a bank account makes both balances wrong.
          </Text>
          <Button
            testID="manual-entry-create-cash"
            title="Create a cash wallet"
            variant="secondary"
            onPress={onCreateCashWallet}
          />
        </View>
      ) : null}

      {/* Wallet */}
      <View className="gap-2">
        {selectable.map((wallet) => (
          <Pressable
            key={wallet.id}
            testID={`manual-entry-wallet-${wallet.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: walletId === wallet.id }}
            accessibilityLabel={wallet.name}
            onPress={() => setChosenWalletId(wallet.id)}
            className={`rounded-xl px-4 py-3 ${
              walletId === wallet.id
                ? "bg-brand-soft dark:bg-brand-soft-dark"
                : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text className="text-fg dark:text-fg-dark">{wallet.name}</Text>
          </Pressable>
        ))}

        {showErrors && walletMissing ? (
          <Text testID="manual-entry-wallet-error" className="text-danger dark:text-danger-dark">
            Choose which wallet this came out of.
          </Text>
        ) : null}
      </View>

      {/* Date */}
      <View className="gap-2">
        <DateField
          testID="manual-entry-date"
          label="Date"
          placeholder="Pick a date"
          value={day}
          onChange={setDay}
          // A manual transaction is something that already happened. `now`,
          // not the wall clock: every other date decision in this file
          // (localDayOf, occurredAtFor above) reads the injected clock, and
          // the picker's own bound has to agree with them rather than being
          // a second, independent source of "today".
          maximumDate={new Date(now)}
        />
        {showErrors && dateInvalid ? (
          <Text testID="manual-entry-date-error" className="text-danger dark:text-danger-dark">
            Pick today or a day already past — an entry can't be dated in the future.
          </Text>
        ) : null}
      </View>

      {/* Category */}
      <Pressable
        testID="manual-entry-category"
        accessibilityRole="button"
        accessibilityLabel={`Category: ${selectedCategory?.name ?? "Uncategorized"}`}
        onPress={() => setPickingCategory(true)}
        className="rounded-xl bg-surface px-4 py-3 dark:bg-surface-dark"
      >
        <Text className="text-fg dark:text-fg-dark">
          {selectedCategory?.name ?? "Uncategorized"}
        </Text>
      </Pressable>

      <TextInput
        testID="manual-entry-merchant"
        value={merchant}
        onChangeText={setMerchant}
        accessibilityLabel="Merchant"
        placeholder="Where? (optional)"
        className="rounded-xl bg-surface px-4 py-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
      />

      <TextInput
        testID="manual-entry-note"
        value={note}
        onChangeText={setNote}
        accessibilityLabel="Note"
        placeholder="Note (optional)"
        className="rounded-xl bg-surface px-4 py-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
      />

      <Button
        testID="manual-entry-save"
        title="Save"
        variant="primary"
        disabled={!canSave}
        onPress={handleSave}
      />

      <CategoryPicker
        visible={pickingCategory}
        categories={categories}
        selectedId={categoryId}
        merchant={trimmedOrNull(merchant)}
        onDismiss={() => setPickingCategory(false)}
        onSubmit={(choice) => {
          setChosenCategoryId(choice.categoryId);
          setPickingCategory(false);
        }}
      />
    </View>
  );
}
