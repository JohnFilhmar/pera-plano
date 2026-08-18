// components/review/correct_sheet.tsx — the "Correct" half of a triage card
// (m1c plan Task 10; docs/04-features/08-review-queue.md §"Flow: triage a
// low-confidence parse", §"Flow: unknown provider").
//
// ONE SHEET, TWO ENTRY POINTS, AND THAT IS DELIBERATE. "Correct" on a
// low-confidence card and "This is a money notification" on an unknown-provider
// card are the same interaction seen from two distances: fix a field the parser
// got wrong, or supply the fields it could not read at all. Splitting them into
// two components would mean two places to get the patch wrong, and the second
// one — the assisted form for an app PeraPlano has never seen — is the one whose
// output is least verifiable.
//
// IT REPORTS A DIFF, NOT A FORM. `onSubmit` receives only the fields the user
// actually CHANGED, because that difference is what decides whether a UserRule
// is created (`lib/review/resolve_actions.ts`). Reporting the whole form would
// make every plain confirmation look like a correction and manufacture a rule
// from every card the user simply agreed with — the queue teaching the pipeline
// things nobody asked it to learn.
//
// THE CHECKBOX MEANS EXACTLY WHAT IT SAYS. Checked by default, because the
// common case is "yes, always" and a user who has to opt IN to being remembered
// will re-correct the same merchant forever and conclude triage is pointless
// (spec rule 12). Unchecked, NOTHING is created — they have said something
// specific about every future row from that source.
//
// PRESENTATIONAL: wallets and categories arrive from the screen's hooks, and
// this component writes nothing.
//
// DEVICE-TESTING FIX (2026-08-18, Task 1): a real notification landed here
// and could not be saved — `canSave` needs a wallet, the wallet rows lived
// below a `max-h-96` scroll fold, and the greyed Save gave no reason. Three
// changes: (a) a text line above Save states whichever of amount/wallet is
// still missing; (b) the wallet block now renders directly under the numpad,
// ABOVE Direction — chosen over relaxing `max-h-96` because a taller fixed
// cap is still a fold on some device, while reordering puts the picker
// on-screen without any scrolling in the common single-wallet case; (c) the
// sole wallet is preselected when `wallets.length === 1` (no ambiguity left
// to ask about), and the section says so explicitly when `wallets.length ===
// 0` instead of leaving a bare "WALLET" label over dead space.
//
// THE PRESELECT IS A CONFIRMABLE DEFAULT, NOT A SUPPRESSED SIGNAL (fixed
// 2026-08-18, post-review). A first version of (c) folded the preselected
// wallet into the diff's OWN baseline, so saving an untouched single-wallet
// sheet reported no `walletId` at all. That failed SILENTLY: `resolveCorrect`
// requires a wallet from patch or payload, the payload had none, the mutation
// has no `onError`, and the sheet had already closed by the time it threw —
// Save looked like it worked and nothing was written, for exactly the user
// this fix was written for. `changedWallet` below compares against
// `proposed.walletId` — what the PARSER proposed — the same as every other
// field, never against the preselected default. That is the invariant this
// file relied on before the preselect existed: whenever the payload has no
// wallet, ANY wallet the state ends up holding (typed, tapped, or
// preselected) is reported. For a one-wallet user this also means the sheet
// offers "always route this app's notifications to my only wallet" — correct
// rather than presumptuous, since there is only one wallet it could mean.
import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AmountNumpad } from "@/components/transactions/amount_numpad";
import { CategoryPicker } from "@/components/transactions/category_picker";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button, registerIcon } from "@/components/ui/button";
import { centavosFromDigits } from "@/components/ui/amount_text";
import type { CorrectionPatch } from "@/lib/review/resolve_actions";
import type {
  Category,
  Centavos,
  ReviewItemPayload,
  ReviewQueueItem,
  TxDirection,
  Wallet,
} from "@/types/domain";

const CheckGlyph = registerIcon(Check);

/**
 * The checkbox's sentence. Names BOTH halves of what the rule will do, so
 * "always" is never an unqualified promise.
 */
export function alwaysRuleLabel(subject: string, outcome: string): string {
  return `Always treat ${subject} as ${outcome}`;
}

/**
 * One checkbox governing TWO rules needs a sentence that admits it. Naming only
 * the category rule while quietly suppressing the wallet rule as well would make
 * the box mean more than it says — in the direction where the user gets less
 * than they agreed to, which is the safe direction but still a lie.
 */
export const ALWAYS_BOTH_LABEL = "Remember both of these corrections";

export const CORRECT_SHEET_TITLE = "Fix what's wrong";

// ---------------------------------------------------------------------------
// Payload readers — same defensive shape as review_card.tsx, and for the same
// reason: the repository stores the payload verbatim and never interprets it, so
// an item from an older build must open a partial form rather than crash the
// sheet.
// ---------------------------------------------------------------------------

function readString(payload: ReviewItemPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readAmount(payload: ReviewItemPayload): Centavos | null {
  const value = payload.amount;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readDirection(payload: ReviewItemPayload): TxDirection | null {
  return payload.direction === "in" || payload.direction === "out" ? payload.direction : null;
}

/** Centavos back into the digit string the numpad builds forward from. */
function digitsFromCentavos(amount: Centavos | null): string {
  return amount === null || amount <= 0 ? "" : String(Math.trunc(amount));
}

/**
 * The wallet the sheet opens (and diffs) on. The parser's own guess wins when
 * it has one; otherwise a single available wallet is not really a guess — it
 * is the only answer there is, so nothing is left for the user to decide.
 * With two or more wallets, guessing which one a transaction belongs to IS
 * the decision this sheet exists to ask about, so this stays `null`.
 */
function defaultWalletId(payload: ReviewItemPayload, wallets: readonly Wallet[]): string | null {
  const proposed = readString(payload, "walletId");
  if (proposed !== null) return proposed;
  return wallets.length === 1 ? wallets[0].id : null;
}

export const NO_WALLETS_MESSAGE = "No wallets yet — add one to save this entry.";

/**
 * The line above a disabled Save. Amount is checked first because it is the
 * first thing the sheet asks for (the numpad sits above the wallet block);
 * either message names the ONE thing still missing rather than restating
 * "can't save" with no reason, which is the actual bug this fixes.
 *
 * `walletCount` special-cases the zero-wallets state: "Pick a wallet" would
 * tell the user to choose from the list the section above just said is
 * empty (`NO_WALLETS_MESSAGE`) — two lines on the same screen disagreeing
 * about whether there is anything to pick.
 */
function saveDisabledReason(
  amount: Centavos,
  walletId: string | null,
  walletCount: number,
): string | null {
  if (amount <= 0) return "Enter an amount to save";
  if (walletId === null) return walletCount === 0 ? "Add a wallet to save" : "Pick a wallet to save";
  return null;
}

export type CorrectSheetProps = {
  visible: boolean;
  item: ReviewQueueItem;
  wallets: readonly Wallet[];
  categories: readonly Category[];
  onDismiss: () => void;
  onSubmit: (patch: CorrectionPatch) => void;
};

export function CorrectSheet({
  visible,
  item,
  wallets,
  categories,
  onDismiss,
  onSubmit,
}: CorrectSheetProps) {
  const proposed = {
    amount: readAmount(item.payload),
    direction: readDirection(item.payload),
    walletId: readString(item.payload, "walletId"),
    categoryId: readString(item.payload, "categoryId"),
    merchant: readString(item.payload, "merchant"),
  };

  const [digits, setDigits] = useState(digitsFromCentavos(proposed.amount));
  const [direction, setDirection] = useState<TxDirection>(proposed.direction ?? "out");
  const [walletId, setWalletId] = useState<string | null>(defaultWalletId(item.payload, wallets));
  const [categoryId, setCategoryId] = useState<string | null>(proposed.categoryId);
  const [merchant, setMerchant] = useState(proposed.merchant ?? "");
  const [createRule, setCreateRule] = useState(true);
  const [pickingCategory, setPickingCategory] = useState(false);

  // Reopening starts from the item's CURRENT proposal and a fresh checkbox. A
  // sheet dismissed mid-edit that re-opened holding an abandoned choice is one
  // tap from committing it.
  //
  // KEYED ON THE ITEM'S ID, NOT THE ITEM. `useReviewQueue` hands back a fresh
  // array of fresh objects on every refetch, and a queue item is immutable apart
  // from `resolved_at` — so depending on the object would re-run this effect on
  // a background refetch and silently wipe the amount the user was half-way
  // through typing.
  const itemId = item.id;
  useEffect(() => {
    if (!visible) return;
    setDigits(digitsFromCentavos(readAmount(item.payload)));
    setDirection(readDirection(item.payload) ?? "out");
    setWalletId(defaultWalletId(item.payload, wallets));
    setCategoryId(readString(item.payload, "categoryId"));
    setMerchant(readString(item.payload, "merchant") ?? "");
    setCreateRule(true);
    setPickingCategory(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `wallets` is
    // read (via `defaultWalletId`) but deliberately excluded: the sheet
    // mounts on tap, after the wallets query has already resolved, so this
    // is benign today. If a wallets refetch ever landed WHILE the sheet was
    // open, the preselect just wouldn't re-run for it — no worse than not
    // preselecting, never wrong, so not worth re-running this whole reset
    // (and re-arming the checkbox) over a background list update.
  }, [visible, itemId]);

  const amount = centavosFromDigits(digits);
  const trimmedMerchant = merchant.trim();
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const selectedWallet = wallets.find((wallet) => wallet.id === walletId) ?? null;

  // The DIFF, field by field. Each is a correction only when it differs from
  // what the parser proposed — see this file's header. The wallet compares
  // against `proposed.walletId`, NEVER the preselected default: see "THE
  // PRESELECT IS A CONFIRMABLE DEFAULT" above for why comparing against the
  // preselect instead silently dropped `walletId` from the patch.
  const changedAmount = amount > 0 && amount !== proposed.amount;
  const changedDirection = direction !== (proposed.direction ?? "out") || proposed.direction === null;
  const changedWallet = walletId !== null && walletId !== proposed.walletId;
  const changedCategory = categoryId !== null && categoryId !== proposed.categoryId;
  const changedMerchant = trimmedMerchant !== (proposed.merchant ?? "") && trimmedMerchant !== "";

  // What a rule could be built from. A category rule needs a merchant to key on
  // — `categorizer.ts` makes a blank `merchantPattern` FAIL CLOSED, so a rule
  // without one could never fire, and offering it would promise something the
  // pipeline cannot keep.
  const categoryRuleOffered = changedCategory && trimmedMerchant !== "";
  const ruleOffered = categoryRuleOffered || changedWallet;

  const ruleLabel =
    categoryRuleOffered && changedWallet
      ? ALWAYS_BOTH_LABEL
      : categoryRuleOffered
        ? alwaysRuleLabel(trimmedMerchant, selectedCategory?.name ?? "this category")
        : alwaysRuleLabel("notifications from this app", selectedWallet?.name ?? "this wallet");

  // The two fields the ledger itself refuses: `CHECK (amount > 0)` and the
  // wallet foreign key. Disabling here means the failure is a greyed button
  // rather than a thrown repository error after the sheet has already closed.
  const canSave = amount > 0 && walletId !== null;
  const disabledReason = canSave ? null : saveDisabledReason(amount, walletId, wallets.length);

  function handleSave(): void {
    const patch: CorrectionPatch = { createRule: ruleOffered ? createRule : true };
    if (changedAmount) patch.amount = amount;
    if (changedDirection) patch.direction = direction;
    if (changedWallet && walletId !== null) patch.walletId = walletId;
    if (changedCategory && categoryId !== null) patch.categoryId = categoryId;
    if (changedMerchant) patch.merchant = trimmedMerchant;
    onSubmit(patch);
  }

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title={CORRECT_SHEET_TITLE}>
      <View testID="correct-sheet" className="gap-4">
        <ScrollView className="max-h-96">
          <View className="gap-4">
            <AmountNumpad digits={digits} onDigitsChange={setDigits} />

            {/* Directly under the numpad, ahead of Direction — see this
                file's header. This is the field a disabled Save most often
                blocks on, and the fix is putting it on-screen, not just
                naming it below. */}
            <View className="gap-2">
              <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Wallet</Text>
              {wallets.length === 0 ? (
                <Text
                  testID="correct-wallet-empty"
                  className="text-sm text-fg-2 dark:text-fg-2-dark"
                >
                  {NO_WALLETS_MESSAGE}
                </Text>
              ) : (
                wallets.map((wallet) => (
                  <Pressable
                    key={wallet.id}
                    testID={`correct-wallet-${wallet.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: walletId === wallet.id }}
                    accessibilityLabel={wallet.name}
                    onPress={() => setWalletId(wallet.id)}
                    className={`min-h-[44px] justify-center rounded-xl px-4 py-3 ${
                      walletId === wallet.id
                        ? "bg-brand-soft dark:bg-brand-soft-dark"
                        : "bg-bg dark:bg-bg-dark"
                    }`}
                  >
                    <Text className="text-fg dark:text-fg-dark">{wallet.name}</Text>
                  </Pressable>
                ))
              )}
            </View>

            <View className="flex-row gap-3">
              {(["out", "in"] as const).map((option) => (
                <Pressable
                  key={option}
                  testID={`correct-direction-${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: direction === option }}
                  accessibilityLabel={option === "out" ? "Money out" : "Money in"}
                  onPress={() => setDirection(option)}
                  className={`min-h-[44px] flex-1 items-center justify-center rounded-xl py-3 ${
                    direction === option
                      ? "bg-brand dark:bg-brand-dark"
                      : "bg-bg dark:bg-bg-dark"
                  }`}
                >
                  <Text
                    className={`font-semibold ${
                      direction === option
                        ? "text-surface dark:text-surface-dark"
                        : "text-fg dark:text-fg-dark"
                    }`}
                  >
                    {option === "out" ? "Money out" : "Money in"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View className="gap-2">
              <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Category</Text>
              <Pressable
                testID="correct-category"
                accessibilityRole="button"
                accessibilityLabel={`Category: ${selectedCategory?.name ?? "Uncategorized"}`}
                onPress={() => setPickingCategory(true)}
                className="min-h-[44px] justify-center rounded-xl bg-bg px-4 py-3 dark:bg-bg-dark"
              >
                <Text className="text-fg dark:text-fg-dark">
                  {selectedCategory?.name ?? "Uncategorized"}
                </Text>
              </Pressable>
            </View>

            <View className="gap-2">
              <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Merchant</Text>
              <TextInput
                testID="correct-merchant"
                value={merchant}
                onChangeText={setMerchant}
                accessibilityLabel="Merchant"
                placeholder="Who was paid?"
                className="rounded-xl bg-bg px-4 py-3 text-fg dark:bg-bg-dark dark:text-fg-dark"
              />
            </View>
          </View>
        </ScrollView>

        {ruleOffered ? (
          <Pressable
            testID="correct-rule-checkbox"
            onPress={() => setCreateRule((on) => !on)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: createRule }}
            accessibilityLabel={ruleLabel}
            className="min-h-[44px] flex-row items-center gap-3 py-2"
          >
            <View
              className={
                createRule
                  ? "h-5 w-5 items-center justify-center rounded border-2 border-brand bg-brand dark:border-brand-dark dark:bg-brand-dark"
                  : "h-5 w-5 items-center justify-center rounded border-2 border-fg-2 dark:border-fg-2-dark"
              }
            >
              {createRule ? (
                <CheckGlyph size={14} className="text-surface dark:text-surface-dark" />
              ) : null}
            </View>
            <Text className="flex-1 text-sm text-fg dark:text-fg-dark">{ruleLabel}</Text>
          </Pressable>
        ) : null}

        {disabledReason !== null ? (
          <Text
            testID="correct-save-reason"
            className="text-center text-sm text-warn dark:text-warn-dark"
          >
            {disabledReason}
          </Text>
        ) : null}

        <Button
          testID="correct-save"
          title="Save"
          variant="primary"
          disabled={!canSave}
          onPress={handleSave}
        />

        <CategoryPicker
          visible={pickingCategory}
          categories={categories}
          selectedId={categoryId ?? ""}
          // The rule offer lives on THIS sheet, which knows about the wallet
          // correction too — the picker's own checkbox would be a second,
          // disagreeing answer to the same question.
          merchant={null}
          onDismiss={() => setPickingCategory(false)}
          onSubmit={(choice) => {
            setCategoryId(choice.categoryId);
            setPickingCategory(false);
          }}
        />
      </View>
    </BottomSheet>
  );
}
