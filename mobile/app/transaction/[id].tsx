// app/transaction/[id].tsx — one transaction's detail (m1c plan Task 7).
//
// THE SCREEN A USER OPENS WHEN THEY DO NOT BELIEVE A ROW. Everything on it is
// either a fact the pipeline recorded or a way to correct one, and the panel in
// the middle is what makes the first kind checkable: the exact notification
// text that produced this row, the app it came from, and the day it is
// destroyed.
//
// THE THREE THINGS THIS SCREEN OWNS, AND WHY EACH IS HERE RATHER THAN IN A
// COMPONENT:
//
//   RESOLVING THE PROVIDER NAME. The panel is presentational and must never see
//   a package id; `providerLabelForPackage` needs the installed ruleset, which
//   is a hook. So the screen resolves it and hands the panel a NAME.
//
//   READING THE EXPIRY SEPARATELY FROM THE CAPTURE. `RawCapture` is
//   interface-contract §4 — the native-bridge shape — and carries no expiry.
//   Two hooks over one row, and the countdown reads the STORED column rather
//   than `capturedAt + TTL`, which differs on every replayed or late-drained
//   capture.
//
//   FIRING THE CATEGORY EDIT AND THE RULE AS TWO SEPARATE WRITES. That is the
//   checkbox: unchecking it fires exactly one of them. A single combined
//   mutation would make "changed this row" and "changed every future row from
//   this merchant" indistinguishable at the call site.
//
// Global Constraints: hooks only, no repository import, no SQL. The one
// deliberate exception to "thin screen" is the small amount of orchestration
// above, which has nowhere else to live.
import { useLocalSearchParams } from "expo-router";
import { ArrowLeftRight, Tag } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryPicker } from "@/components/transactions/category_picker";
import {
  TransferLinkActions,
  transferFee,
} from "@/components/transactions/transfer_link_actions";
import { WhyRecordedPanel } from "@/components/transactions/why_recorded_panel";
import { AmountText } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty_state";
import { ListRow } from "@/components/ui/list_row";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { ProviderBadge } from "@/components/ui/provider_badge";
import { SectionHeader } from "@/components/ui/section_header";
import { providerKeyForPackage, providerLabelForPackage } from "@/constants/providers";
import { useCreateUserRule } from "@/hooks/mutations/use_create_user_rule";
import { useLinkTransfer } from "@/hooks/mutations/use_link_transfer";
import { useUnlinkTransfer } from "@/hooks/mutations/use_unlink_transfer";
import { useUpdateTransaction } from "@/hooks/mutations/use_update_transaction";
import { useAllWalletMatchers } from "@/hooks/queries/use_all_wallet_matchers";
import { useCategories } from "@/hooks/queries/use_categories";
import { useRawCapture, useRawCaptureExpiry } from "@/hooks/queries/use_raw_capture";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useTransaction } from "@/hooks/queries/use_transaction";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallets } from "@/hooks/queries/use_wallets";
import { formatDateTime } from "@/lib/datetime";
import type { Transaction, TxSource } from "@/types/domain";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

/**
 * The header medallion's glyph — a GENERIC mark, not one resolved from
 * `category.icon`. Same call `components/transactions/transaction_row.tsx`
 * makes (see its header, "THE MEDALLION'S DEFAULT GLYPH"): `Category.icon` is
 * a lucide icon name held as a plain string, and nothing in this codebase yet
 * maps an arbitrary name back to its component. Building that resolver is a
 * real, untested subsystem this restyle task does not own either.
 */
const CategoryGlyph = registerIcon(Tag);
/** Rule 3, restated on the one screen whose whole job is explaining a row. */
const TransferGlyph = registerIcon(ArrowLeftRight);

/** How each `source` reads in the "Recorded by" field (contract §3's union). */
const SOURCE_LABELS: Record<TxSource, string> = {
  notification: "Notification",
  manual: "Added manually",
  "recurring-rule": "Recurring rule",
  import: "Imported",
};

/**
 * One labelled fact. Every field on this screen that is not a `ListRow` (the
 * three that need a `left`/`right` slot — Category, Wallet, Counts toward) or
 * the editable Note is one of these.
 *
 * `mono` IS THE ONE THING `ListRow` CANNOT DO. Its `title` slot carries a
 * fixed className with no override, so the Reference row — task-4b-brief.md
 * Step 2's "Reference (mono, text-micro)" — has to stay a `Field` rather than
 * become a fourth `ListRow`, with this one extra prop standing in for the
 * style override `ListRow` does not expose.
 */
function Field({
  label,
  value,
  testID,
  mono = false,
}: {
  label: string;
  value: string;
  testID: string;
  mono?: boolean;
}) {
  return (
    <View className="gap-1 py-2">
      <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">{label}</Text>
      <Text
        testID={testID}
        className={
          mono
            ? "font-mono text-micro text-fg dark:text-fg-dark"
            : "text-base text-fg dark:text-fg-dark"
        }
      >
        {value}
      </Text>
    </View>
  );
}

export default function TransactionDetailScreen() {
  const placeholderColor = usePlaceholderColor();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactionId = id ?? "";
  // A full-screen route outside the tab navigator: nothing above it clears the
  // status bar or Android's navigation bar. See app/_layout.tsx's
  // SafeAreaProvider comment for why each surface pads its own edges.
  const insets = useSafeAreaInsets();

  const [picking, setPicking] = useState(false);
  const [choosingCategory, setChoosingCategory] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { data: transaction, isPending } = useTransaction(transactionId);
  // ARCHIVED WALLETS INCLUDED, because this screen only ever RESOLVES A NAME —
  // the Wallet row below and the transfer candidates' subtitles — and never
  // offers a wallet to pick. Archiving is the only removal path in the app, so
  // an archived wallet's rows stay in the ledger for good; the default
  // active-only list cannot find their wallet and every one of them read
  // "Unknown wallet".
  const { data: wallets } = useWallets({ includeArchived: true });
  const { data: categories } = useCategories();
  const { data: ruleset } = useRuleset();
  // Every row, for the transfer-candidate list. Unfiltered on purpose: the
  // counterpart is by definition in a DIFFERENT wallet, so no repository filter
  // this screen could pass would narrow it usefully.
  const { data: allTransactions } = useTransactions({});
  // For the Wallet row's `ProviderBadge` (task-4b). Same recipe
  // app/(tabs)/wallets.tsx and app/wallet/[id]/edit.tsx already use — every
  // matcher on the device, joined to this row's wallet by `walletId` — rather
  // than a new hook, so a cash wallet (no matcher, no provider) and a
  // provider-linked one resolve exactly the way the rest of the app agrees
  // they should.
  const { data: matchers } = useAllWalletMatchers();

  const rawId = transaction?.rawNotificationId ?? null;
  const { data: capture } = useRawCapture(rawId);
  const { data: expiresAt } = useRawCaptureExpiry(rawId);

  const updateTransaction = useUpdateTransaction();
  const createUserRule = useCreateUserRule();
  const linkTransfer = useLinkTransfer();
  const unlinkTransfer = useUnlinkTransfer();

  if (isPending) {
    return (
      <View testID="transaction-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={6} />
      </View>
    );
  }

  if (!transaction) {
    // A blank screen for a bad id leaves the user tapping a back button they
    // cannot see — the same call app/wallet/[id].tsx makes.
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="transaction-detail-missing"
          title="Transaction not found"
          body="This transaction may have been removed. Go back and pick another one."
        />
      </View>
    );
  }

  const wallet = (wallets ?? []).find((candidate) => candidate.id === transaction.walletId);
  const category = (categories ?? []).find(
    (candidate) => candidate.id === transaction.categoryId,
  );
  const isTransfer = transaction.transferLinkId !== null;

  const providerName = capture
    ? providerLabelForPackage(ruleset?.providers ?? [], capture.packageName)
    : "";

  // `null` for a wallet with no matcher at all — cash, or a provider-linked
  // wallet whose match the user has not set up yet — which `ProviderBadge`
  // has no sensible way to render, so the Wallet row falls back to no badge
  // rather than one badging the wrong thing.
  const walletProviderKey = (() => {
    const packageName = matchers?.find((matcher) => matcher.walletId === transaction.walletId)
      ?.packageName;
    return packageName ? providerKeyForPackage(ruleset?.providers ?? [], packageName) : null;
  })();

  // "Counts toward" (task-4b): the same split rule 3 already draws on the
  // ledger row itself (a transfer leg is neither spend nor income) — restated
  // here as a fact about THIS transaction rather than re-derived from scratch,
  // so the two screens can never disagree about one row.
  //
  // The adjustment arm is checked FIRST, ahead of direction, because a
  // correction has a direction (money apparently in or out) and that direction
  // is exactly what must not be reported. This label was the visible half of
  // the owner's 2026-08-30 bug: the sheet said "Spending" over a starting
  // balance, and it said it truthfully — the row really was being counted.
  const countsToward = transaction.isAdjustment
    ? "Not counted — balance adjustment"
    : isTransfer
      ? "Not counted — transfer"
      : transaction.direction === "in"
        ? "Income"
        : "Spending";

  function commitNote(): void {
    if (!transaction || note === null) return;
    const trimmed = note.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === transaction.note) return;
    updateTransaction.mutate({ id: transaction.id, patch: { note: next } });
  }

  function commitCategory(choice: { categoryId: string; createRule: boolean }): void {
    if (!transaction) return;
    setChoosingCategory(false);
    if (choice.categoryId !== transaction.categoryId) {
      updateTransaction.mutate({ id: transaction.id, patch: { categoryId: choice.categoryId } });
    }

    // RULE 6, AND THE CHECKBOX IS THE WHOLE CONDITION. A user who unchecked it
    // said "this row, not this merchant" — making the rule anyway would
    // recategorize transactions they never looked at.
    //
    // The SHIPPED UserRule shape: a matcher/action pair. There is no
    // "kind: merchant_category" in this codebase, and `merchantPattern` is a
    // case-insensitive SUBSTRING (lib/ingest/categorizer.ts), never a regex —
    // so the merchant string goes in verbatim, unescaped and unanchored.
    if (choice.createRule && transaction.merchant) {
      createUserRule.mutate({
        matcher: { merchantPattern: transaction.merchant },
        action: { kind: "set-category", categoryId: choice.categoryId },
        // Invariant I15 / §3.11 invariant 1: every rule is traceable to what
        // created it, so the settings screen can say where it came from.
        createdFrom: transaction.id,
      });
    }
  }

  function link(counterpart: Transaction): void {
    if (!transaction) return;
    setPicking(false);
    const outLeg = transaction.direction === "out" ? transaction : counterpart;
    const inLeg = transaction.direction === "out" ? counterpart : transaction;
    linkTransfer.mutate({
      outTransactionId: outLeg.id,
      inTransactionId: inLeg.id,
      feeAmount: transferFee(transaction, counterpart),
      // The user made this pairing, not the detector (domain §3.3).
      origin: { detectedBy: "manual", confidence: 1 },
    });
  }

  return (
    // DEVICE-TESTING FIX (2026-08-18, Task 2 follow-up): the insets used to
    // sit on the ScrollView's `style` prop, which is the ScrollView's OUTER
    // FRAME, not its scrolling content — so the header rendered under the
    // status bar and the bottom of the panel could scroll in behind
    // Android's navigation bar. Matches `app/review/index.tsx`'s shape
    // (insets on a padding-free outer View wrapping the ScrollView), the
    // same house pattern this task's three wallet screens
    // (`app/wallet/[id].tsx`, `app/wallet/new.tsx`,
    // `app/wallet/[id]/edit.tsx`) use, rather than inventing another one: the
    // outer View reserves both system-bar edges first, so the ScrollView's
    // own viewport never extends into either one.
    <View
      testID="transaction-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView className="flex-1">
        <View className="pb-10 pt-4">
          <View className="px-4">
            <Card>
              <View className="items-center gap-2">
                {/* The icon medallion (task-4b). 56dp — `h-14 w-14` — twice the
                    ledger row's own 28dp version (transaction_row.tsx), the
                    same `bg-chip` disc scaled up for a screen with one row
                    instead of forty. */}
                <View className="h-14 w-14 items-center justify-center rounded-full bg-chip dark:bg-chip-dark">
                  {isTransfer ? (
                    <TransferGlyph size={26} className="text-fg-2 dark:text-fg-2-dark" />
                  ) : (
                    <CategoryGlyph size={26} className="text-fg-2 dark:text-fg-2-dark" />
                  )}
                </View>
                <AmountText
                  testID="transaction-detail-amount"
                  amount={transaction.amount}
                  direction={transaction.direction}
                  size="hero"
                  // Rule 3 of the ledger row, restated here: a transfer leg is
                  // neither spending nor income, and must not be coloured as
                  // either on the screen that explains it.
                  muted={isTransfer}
                />
                <Text className="text-title font-bold text-fg dark:text-fg-dark">
                  {transaction.merchant ?? transaction.counterparty ?? (category?.name ?? "Uncategorized")}
                </Text>
                <Text
                  testID="transaction-detail-direction"
                  className="text-secondary text-fg-2 dark:text-fg-2-dark"
                >
                  {transaction.direction === "out" ? "Money out" : "Money in"}
                </Text>
                <Text
                  testID="transaction-detail-datetime"
                  className="text-secondary text-fg-2 dark:text-fg-2-dark"
                >
                  {formatDateTime(transaction.occurredAt)}
                </Text>
                {/* Explains a MACHINE decision, so it renders for exactly the
                    one source that is one — `notification` is the only
                    `TxSource` this screen's own `WhyRecordedPanel` treats as
                    a real parse (see that component's SOURCE_NOTES branch for
                    `recurring-rule`/`import`, which get a plain sentence and
                    no confidence figure either). A manual entry gets no chip
                    at all rather than one reading "manual" — the badge exists
                    to explain a machine decision, and a human typing their
                    own transaction is not one. */}
                {transaction.source === "notification" ? (
                  <Chip
                    testID="transaction-detail-auto-captured"
                    label={`AUTO-CAPTURED · ${Math.round(transaction.confidence * 100)}% MATCH`}
                    tone="brand"
                    fill="soft"
                  />
                ) : null}
              </View>
            </Card>
          </View>

          <SectionHeader title="Details" />
          <View className="px-4">
            <Card variant="flat">
              {/* NO `subtitle` HERE, unlike Category below — pinned:
                  `transaction_detail.test.tsx` asserts
                  `toHaveTextContent("GCash")` on this exact testID with a
                  plain string, and RNTL's matcher requires the element's
                  WHOLE normalized text to equal that string, not merely
                  contain it (`toHaveTextContent(/Food & Dining/)` on the
                  Category row below tolerates a trailing "Category" caption
                  only because it is a regex). A "Wallet" subtitle here would
                  turn the aggregate text into "GCashWallet" and fail the
                  exact match. */}
              <ListRow
                testID="transaction-detail-wallet"
                title={wallet?.name ?? "Unknown wallet"}
                left={
                  walletProviderKey ? (
                    <ProviderBadge providerKey={walletProviderKey} size={28} />
                  ) : undefined
                }
                // Says the wallet is gone from the pickers WITHOUT taking its
                // name away — the row is still money that moved through it. In
                // the `right` slot rather than the title or a subtitle, so an
                // ACTIVE wallet's row renders the bare name the exact-text
                // assertion above depends on.
                right={wallet?.isArchived ? <Chip label="ARCHIVED" /> : undefined}
              />
              {/* The one field that opens something. Rule 1 makes the category
                  editable; the picker owns the rule checkbox. */}
              <ListRow
                testID="transaction-detail-category"
                title={category?.name ?? "Uncategorized"}
                subtitle="Category"
                onPress={() => setChoosingCategory(true)}
                right={<Chip label="Change" />}
              />
              <ListRow
                testID="transaction-detail-counts-toward"
                title={countsToward}
                subtitle="Counts toward"
              />
              <Field
                label="Merchant"
                value={transaction.merchant ?? transaction.counterparty ?? "Not recorded"}
                testID="transaction-detail-merchant"
              />
              <Field
                label="Reference number"
                value={transaction.referenceNo ?? "Not recorded"}
                testID="transaction-detail-reference"
                mono
              />
              <Field
                label="Recorded by"
                value={SOURCE_LABELS[transaction.source]}
                testID="transaction-detail-source"
              />
              <View className="gap-1 py-2">
                <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Note</Text>
                {/* Saved on blur rather than behind a Save button: a note is the
                    one field with no wrong value, and a button the user does not
                    press is a note they believe they wrote and did not. */}
                <TextInput
                  placeholderTextColor={placeholderColor}
                  testID="transaction-detail-note-input"
                  value={note ?? transaction.note ?? ""}
                  onChangeText={setNote}
                  onBlur={commitNote}
                  onSubmitEditing={commitNote}
                  placeholder="Add a note"
                  accessibilityLabel="Note"
                  className="min-h-[44px] rounded-xl bg-bg px-3 py-2 text-base text-fg dark:bg-bg-dark dark:text-fg-dark"
                />
              </View>
            </Card>
          </View>

          {/* RULE 2. The app's honesty mechanism — see the component's header. */}
          <WhyRecordedPanel
            source={transaction.source}
            providerName={providerName}
            capture={rawId === null ? null : capture}
            expiresAt={rawId === null ? null : expiresAt}
            confidence={transaction.confidence}
          />

          <TransferLinkActions
            transaction={transaction}
            transactions={allTransactions ?? []}
            wallets={wallets ?? []}
            picking={picking}
            onOpenPicker={() => setPicking(true)}
            onDismissPicker={() => setPicking(false)}
            onLink={link}
            onUnlink={() => {
              if (transaction.transferLinkId) unlinkTransfer.mutate(transaction.transferLinkId);
            }}
          />

          <CategoryPicker
            visible={choosingCategory}
            categories={categories ?? []}
            selectedId={transaction.categoryId}
            merchant={transaction.merchant}
            onDismiss={() => setChoosingCategory(false)}
            onSubmit={commitCategory}
          />
        </View>
      </ScrollView>
    </View>
  );
}
