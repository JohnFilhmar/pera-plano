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
import { Type, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryPicker } from "@/components/transactions/category_picker";
import { Button, registerIcon } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DateField } from "@/components/ui/date_field";
import { NumericField } from "@/components/ui/numeric_field";
import { SegmentedControl } from "@/components/ui/segmented_control";
import { centavosFrom } from "@/lib/money/peso_input";
import {
  categoryForMerchant,
  lastUsedCashWallet,
  occurredAtFor,
} from "@/lib/transactions/manual_entry";

import type { Category, Centavos, EpochMs, Transaction, TxDirection, Wallet } from "@/types/domain";
import { isManualOnly } from "@/lib/wallets/summary";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

const CloseGlyph = registerIcon(X);
const NoteGlyph = registerIcon(Type);

/** Expense/Income (task-4b's `SegmentedControl`). `TxDirection` stays exactly
 * `"in" | "out"` — the ledger's column type must never hold a value it can't
 * write — so Transfer is NOT a third member of this array. It is `kind` on
 * `ManualEntryDraft` instead (money-transfers Task 4), driving a separate
 * `manual-entry-segment-transfer` control rendered beside this one below. */
const DIRECTION_SEGMENTS = [
  { value: "out", label: "Expense" },
  { value: "in", label: "Income" },
] as const;

export type ManualEntryDraft =
  | {
      kind: "entry";
      amount: Centavos;
      direction: TxDirection;
      walletId: string;
      categoryId: string;
      occurredAt: EpochMs;
      merchant: string | null;
      note: string | null;
    }
  | {
      kind: "transfer";
      amount: Centavos;
      feeAmount: Centavos;
      fromWalletId: string;
      toWalletId: string;
      occurredAt: EpochMs;
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
  /**
   * A write this form already accepted that the ROUTE then failed to commit —
   * a rejected `recordTransfer`, say. `null` when there is nothing to report.
   *
   * NOT part of `showErrors`. Every other error here is a field this form can
   * see is wrong and can therefore clear the moment the user fixes it; this one
   * is owned by whoever performed the write, because only they know when it
   * stops being true. Shown UNCONDITIONALLY when set, for the same reason:
   * gating it behind a submit attempt would hide a message that only ever
   * exists because a submit already happened.
   */
  submitError?: string | null;
  /**
   * A write this form has already handed to the route and that has not settled
   * yet. Save is inert and spinning for exactly that long.
   *
   * OWNED BY THE ROUTE, like `submitError` above and for the same reason: only
   * whoever performed the write knows when it stops being in flight. The route
   * keeps this screen open for the whole of it (app/transaction/new.tsx closes
   * on the write landing, not on the tap), so Save is on screen and live while
   * the write runs, and a second tap inside that window is a second
   * INDEPENDENT write — two rows on the entry path, two legs and a link twice
   * on the transfer path. Nothing underneath dedupes them: a manual entry is
   * ground truth and two deliberate entries seconds apart are legitimate,
   * which is that route's rule 4. So the double tap is refused at the button.
   *
   * Defaults to `false`, so a caller with no write behind it — this file's own
   * component test — keeps today's behaviour.
   */
  submitting?: boolean;
  onCreateCashWallet: () => void;
  /**
   * The header's X (task-4b). OPTIONAL, and absent means no button rather
   * than a dead one: `components/transactions/__tests__/manual_entry_form.test.tsx`
   * renders this form bare, with no router above it to close to, and this
   * form stays presentational (no `useRouter` of its own — Global
   * Constraints: components consume hooks the route hands them, not ones
   * they reach for) the same way `onCreateCashWallet` already lets the route
   * own navigation while this file only ever reports.
   */
  onClose?: () => void;
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
  submitError = null,
  submitting = false,
  onCreateCashWallet,
  onClose,
}: ManualEntryFormProps) {
  const placeholderColor = usePlaceholderColor();
  // This form IS the /transaction/new screen — a full-bleed route outside the
  // tab navigator, so nothing above it clears the status bar or Android's
  // navigation bar (app.json `edgeToEdgeEnabled`). Save now lives in its own
  // header row (task-4b) rather than at the bottom of the column, which is
  // what used to land under ▢ ◁.
  const insets = useSafeAreaInsets();
  const [direction, setDirection] = useState<TxDirection>("out");
  // `null` until the user picks a date, so the default keeps tracking the clock
  // rather than being frozen at first render — the same shape `chosenWalletId`
  // and `chosenCategoryId` below already use, and for a sharper reason. A
  // `useState(() => localDayOf(now))` initialiser runs ONCE: a form opened at
  // 23:58 and saved at 00:02 still held yesterday's day, and `occurredAtFor`
  // stamped the entry at yesterday's MIDNIGHT — a purchase filed to the wrong
  // day, in the wrong period, with a time the user never typed.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const day = pickedDay ?? localDayOf(now);
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [pickingCategory, setPickingCategory] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // The third segment. A separate state, not a third `direction` value — see
  // DIRECTION_SEGMENTS' header. Switching kind never resets amount, date or
  // note; only the fields that don't apply on the other side (Category/
  // Merchant here, To/Fee there) disappear.
  const [kind, setKind] = useState<"entry" | "transfer">("entry");
  const isTransfer = kind === "transfer";
  const [chosenToWalletId, setChosenToWalletId] = useState<string | null>(null);
  const [feeAmount, setFeeAmount] = useState("");

  // Spec: archived wallets are hidden from every picker, and the wallets
  // nothing can track are listed first — this screen exists for the spending no
  // notification will ever report; everything else is the exception.
  const selectable = useMemo(() => {
    const active = wallets.filter((wallet) => !wallet.isArchived);
    return [...active.filter(isManualOnly), ...active.filter((wallet) => !isManualOnly(wallet))];
  }, [wallets]);

  const hasCashWallet = selectable.some(isManualOnly);
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
  const feeAmountCentavos = centavosFrom(feeAmount);
  const occurredAt = occurredAtFor(day, now);

  const canSave = amountCentavos > 0;
  const walletMissing = walletId === null;
  const dateInvalid = occurredAt === null;

  // Fewer than two unarchived wallets means the segment has nothing to offer —
  // disabled WITH THE REASON SHOWN rather than offered-then-refused on submit,
  // the same no-dead-taps rule this file's header cites for `Button`'s
  // `iconOnly` and `ReviewCard`'s disabled-without-a-handler pairs.
  const transferAvailable = wallets.filter((wallet) => !wallet.isArchived).length >= 2;

  // Reuses `selectable`'s archived-wallet filter rather than a second one; the
  // only thing the To picker adds is excluding whichever wallet is From.
  const toCandidates = selectable.filter((wallet) => wallet.id !== walletId);
  // DERIVED, not just stored: a picked To that now equals From (the From list
  // is never filtered against it, so re-picking From to the same wallet is
  // one tap) is treated as no selection at all, in the same render — not
  // corrected a tick later by an effect. A stale `chosenToWalletId` that
  // happened to equal `walletId` would otherwise stay "selected" against a
  // wallet the To list no longer even offers, and `toWalletMissing` below
  // would wrongly read false, letting handleSave emit an equal pair the
  // service's own `same_wallet` check exists only to catch three layers down.
  const toWalletId = chosenToWalletId === walletId ? null : chosenToWalletId;
  const toWalletMissing = isTransfer && toWalletId === null;
  // `>=`, matching transfer_service.ts's own `fee_exceeds_amount` rule: an
  // EQUAL fee would leave a zero-amount leg, which the schema's
  // `CHECK (amount > 0)` rejects after the out-leg already exists. Closed
  // here, in the same showErrors mechanism as walletMissing/dateInvalid/
  // toWalletMissing, so `fee_exceeds_amount` stays a backstop the service
  // enforces rather than a path a user can actually reach — a bare
  // NumericField with no upper bound tied to `amount` would otherwise let
  // an ordinary typed number trigger a validation error with no error
  // surface on this screen to show it. Blank fee reads as 0 through the same
  // `centavosFrom` the amount field uses, so it never trips this.
  const feeExceedsAmount = isTransfer && feeAmountCentavos >= amountCentavos;

  const selectedCategory = categories.find((category) => category.id === categoryId);
  // The summary line beneath the amount (task-4b) — glanceable confirmation
  // of the two defaults rule 3 already picked, not a second way to change
  // them: the full wallet list and `DateField` below stay the only controls,
  // so this never has to duplicate their validation or selection state.
  const selectedWallet = wallets.find((wallet) => wallet.id === walletId);

  function handleSave(): void {
    // Ahead of the amount check, because a write already in flight outranks
    // every reason this form could otherwise have to accept another one.
    // `Button` drops its own handler while `loading` (its header: "it must not
    // fire twice"), so this is the belt to that braces — the refusal has to
    // survive a press that gets past the responder.
    if (submitting) return;
    if (!canSave) return;

    if (walletMissing || dateInvalid || toWalletMissing || feeExceedsAmount) {
      setShowErrors(true);
      return;
    }

    if (isTransfer) {
      onSubmit({
        kind: "transfer",
        amount: amountCentavos,
        feeAmount: feeAmountCentavos,
        fromWalletId: walletId,
        toWalletId: toWalletId as string,
        occurredAt,
        note: trimmedOrNull(note),
      });
      return;
    }

    onSubmit({
      kind: "entry",
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
      {/* Header: X close + Save text action (task-4b), replacing the
          full-width primary Button that used to be the last thing in this
          column. `manual-entry-save` keeps its testID, `disabled` and
          `onPress` — only where it lives and how it reads moved. */}
      <View className="flex-row items-center justify-between">
        {onClose ? (
          <Pressable
            testID="manual-entry-close"
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            className="h-11 w-11 items-center justify-center rounded-full bg-chip dark:bg-chip-dark"
          >
            <CloseGlyph size={20} className="text-fg dark:text-fg-dark" />
          </Pressable>
        ) : (
          // Reserves the X's width so Save does not jump when no `onClose`
          // is supplied — this file's own component test renders the bare
          // form with no router above it to close to.
          <View className="h-11 w-11" />
        )}
        {/* `loading` rather than a second term inside `disabled`: an in-flight
            write is the one refusal on this screen with no field for the user
            to go and fix, so it shows its reason as a spinner where the
            others show theirs as text — still disabled WITH THE REASON, never
            offered-then-refused. `Button` treats the two identically
            otherwise (handler dropped, `accessibilityState.disabled` true)
            and adds `busy` on top. */}
        <Button
          testID="manual-entry-save"
          title="Save"
          variant="ghost"
          loading={submitting}
          disabled={!canSave}
          onPress={handleSave}
        />
      </View>

      {/* DIRECTLY UNDER SAVE, above the amount, because it is the answer to the
          tap the user just made and the screen did not close on. Same
          `text-danger` treatment as `manual-entry-fee-error` and the other
          inline errors below — a failed write is not a different KIND of
          problem to the user, only a later one. */}
      {submitError === null ? null : (
        <Text testID="manual-entry-submit-error" className="text-danger dark:text-danger-dark">
          {submitError}
        </Text>
      )}

      {/* The amount, large and centred (task-4b, REVISED per review round 2).
          `NumericField` itself is now the hero figure (`size="hero"`) rather
          than a small, easy-to-miss real control sitting under a decorative
          duplicate that did nothing when pressed — that first version put
          the most prominent thing on the screen exactly where a tap
          accomplished nothing. The caption above is hidden from screen
          readers, not omitted: `NumericField`'s own `accessibilityLabel`
          already speaks "How much?, {amount}" on press-focus, so a visible
          "How much?" here is for sighted users only — without it, nothing
          on screen said what this large number even was. */}
      <View className="items-center gap-1 pt-2">
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="text-center text-secondary text-fg-2 dark:text-fg-2-dark"
        >
          How much?
        </Text>
        <NumericField
          testID="manual-amount"
          label="How much?"
          placeholder="₱0"
          value={amount}
          onChangeText={onAmountChange}
          size="hero"
        />
        <Text className="text-center text-secondary text-fg-2 dark:text-fg-2-dark">
          {`${selectedWallet?.name ?? "No wallet yet"} · ${day}`}
        </Text>
      </View>

      {/* Direction — one of the four screens `SegmentedControl` was built
          for (task-4b). `testID="manual-entry-direction"` renders children at
          `manual-entry-direction-out`/`-in`, the exact ids the hand-rolled
          toggle this replaces already used.

          Transfer rides alongside it rather than inside `segments`: it is
          NOT a `TxDirection`, `SegmentedControl` has no per-item `disabled`
          (and none of its other five call sites need one), and this pill's
          pinned testID is `manual-entry-segment-transfer` — a third child of
          `testID="manual-entry-direction"` would be
          `manual-entry-direction-transfer` instead. A second, one-off
          control here is cheaper than reshaping a shared component for its
          only disableable segment. */}
      <View className="flex-row gap-2">
        {/* `style={{ flex: 2 }}`, and it has to be on a wrapper here.
            `SegmentedControl`'s own root is a plain `flex-row` View with no
            flex of its own, so dropping it straight into this row left it with
            a zero flex basis: its two `flex-1` segments divided a container
            that was itself sized to nothing, and Expense/Income painted as two
            empty ~0-width pills while the sibling Transfer Pressable (which
            does declare `flex-1`) swallowed the rest of the row. Two shares
            here against Transfer's one gives the three options their thirds
            back.

            Wrapped rather than fixed inside `SegmentedControl`: putting a bare
            `flex-1` on that component's root would be right in this row and
            wrong at every other call site, since the rest mount it as a child
            of a COLUMN — where that would mean "stretch to fill the screen's
            height" rather than "take a share of the row". */}
        <View style={{ flex: 2 }}>
          <SegmentedControl
            testID="manual-entry-direction"
            segments={DIRECTION_SEGMENTS}
            value={direction}
            onChange={(value) => {
              setDirection(value);
              setKind("entry");
            }}
          />
        </View>
        <Pressable
          testID="manual-entry-segment-transfer"
          disabled={!transferAvailable}
          accessibilityRole="radio"
          accessibilityLabel={
            transferAvailable ? "Transfer" : "Transfer — add a second wallet first"
          }
          accessibilityState={{ selected: isTransfer, disabled: !transferAvailable }}
          onPress={() => {
            if (transferAvailable) setKind("transfer");
          }}
          className={`min-h-[44px] flex-1 items-center justify-center rounded-full px-3 ${
            isTransfer ? "bg-brand dark:bg-brand-dark" : "bg-chip dark:bg-chip-dark"
          } ${!transferAvailable ? "opacity-40" : ""}`}
        >
          <Text
            numberOfLines={1}
            className={`text-row font-semibold ${
              isTransfer ? "text-on-brand dark:text-on-brand-dark" : "text-fg-2 dark:text-fg-2-dark"
            }`}
          >
            Transfer
          </Text>
        </Pressable>
      </View>
      {!transferAvailable ? (
        <Text
          testID="manual-entry-transfer-unavailable"
          className="text-fg-2 dark:text-fg-2-dark"
        >
          Add a second wallet to transfer between wallets.
        </Text>
      ) : null}

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

      {/* Wallet — relabelled "From" in transfer mode (money-transfers Task 4).
          No visible label in entry mode, unchanged from before this task. */}
      <View className="gap-2">
        {isTransfer ? (
          <Text className="text-fg-2 dark:text-fg-2-dark">From</Text>
        ) : null}
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
          </Pressable>
        ))}

        {showErrors && walletMissing ? (
          <Text testID="manual-entry-wallet-error" className="text-danger dark:text-danger-dark">
            Choose which wallet this came out of.
          </Text>
        ) : null}
      </View>

      {/* To + Fee — transfer mode only. The SAME inline Pressable-per-wallet
          shape the From list above already uses; there is no `WalletPicker`
          component in this codebase, and this task does not invent one.
          Fee is optional: blank reads as 0 through the same `centavosFrom`
          the amount field already uses. */}
      {isTransfer ? (
        <View testID="manual-entry-to-wallet" className="gap-2">
          <Text className="text-fg-2 dark:text-fg-2-dark">To</Text>
          {toCandidates.map((wallet) => (
            <Pressable
              key={wallet.id}
              testID={`manual-entry-to-wallet-${wallet.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: toWalletId === wallet.id }}
              accessibilityLabel={wallet.name}
              onPress={() => setChosenToWalletId(wallet.id)}
              className={`rounded-xl px-4 py-3 ${
                toWalletId === wallet.id
                  ? "bg-brand dark:bg-brand-dark"
                  : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text
                className={
                  toWalletId === wallet.id
                    ? "font-semibold text-on-brand dark:text-on-brand-dark"
                    : "text-fg dark:text-fg-dark"
                }
              >
                {wallet.name}
              </Text>
            </Pressable>
          ))}

          {showErrors && toWalletMissing ? (
            <Text testID="manual-entry-to-wallet-error" className="text-danger dark:text-danger-dark">
              Choose which wallet this went into.
            </Text>
          ) : null}

          <NumericField
            testID="manual-entry-fee"
            label="Fee (optional)"
            placeholder="₱0"
            value={feeAmount}
            onChangeText={setFeeAmount}
          />
          {showErrors && feeExceedsAmount ? (
            <Text testID="manual-entry-fee-error" className="text-danger dark:text-danger-dark">
              The fee can't be more than the amount you're sending.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Date */}
      <View className="gap-2">
        <DateField
          testID="manual-entry-date"
          label="Date"
          placeholder="Pick a date"
          value={day}
          // Picking a day is what pins it: from here on the field stops
          // following the clock, because a date the user chose outranks a
          // default however long the form stays open.
          onChange={setPickedDay}
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

      {/* Category and Merchant — entry mode only. A transfer moves money
          between the user's own wallets; it has no category (it is not
          spend) and no merchant (there is no counterparty to name). */}
      {!isTransfer ? (
        <>
          {/* Category — a single Chip standing in for the hand-rolled summary
              row this replaces (task-4b). NOT a wrapped row of every category as
              a chip each: `category-option-{id}` and `category-picker-save`
              below are `CategoryPicker`'s own sheet, which is also where the
              "always categorize X as Y" rule offer lives (rule 6) — a second,
              bypassing selector here would need to either duplicate that offer
              or silently drop it. */}
          <View className="flex-row">
            <Chip
              testID="manual-entry-category"
              label={selectedCategory?.name ?? "Uncategorized"}
              fill="outline"
              onPress={() => setPickingCategory(true)}
            />
          </View>

          <TextInput
            placeholderTextColor={placeholderColor}
            testID="manual-entry-merchant"
            value={merchant}
            onChangeText={setMerchant}
            accessibilityLabel="Merchant"
            placeholder="Where? (optional)"
            className="rounded-xl bg-surface px-4 py-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
          />
        </>
      ) : null}

      {/* Note, on `bg-chip` with a leading glyph (task-4b). */}
      <View className="flex-row items-center gap-2 rounded-xl bg-chip px-4 py-3 dark:bg-chip-dark">
        <NoteGlyph size={18} className="text-fg-2 dark:text-fg-2-dark" />
        <TextInput
          placeholderTextColor={placeholderColor}
          testID="manual-entry-note"
          value={note}
          onChangeText={setNote}
          accessibilityLabel="Note"
          placeholder="Note (optional)"
          className="flex-1 text-fg dark:text-fg-dark"
        />
      </View>

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
