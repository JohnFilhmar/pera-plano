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
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty_state";
import { ListRow } from "@/components/ui/list_row";
import { SectionHeader } from "@/components/ui/section_header";
import { providerLabelForPackage } from "@/constants/providers";
import { useCreateUserRule } from "@/hooks/mutations/use_create_user_rule";
import { useLinkTransfer } from "@/hooks/mutations/use_link_transfer";
import { useUnlinkTransfer } from "@/hooks/mutations/use_unlink_transfer";
import { useUpdateTransaction } from "@/hooks/mutations/use_update_transaction";
import { useCategories } from "@/hooks/queries/use_categories";
import { useRawCapture, useRawCaptureExpiry } from "@/hooks/queries/use_raw_capture";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useTransaction } from "@/hooks/queries/use_transaction";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallets } from "@/hooks/queries/use_wallets";
import { formatDateTime } from "@/lib/datetime";
import type { Transaction, TxSource } from "@/types/domain";

/** How each `source` reads in the "Recorded by" field (contract §3's union). */
const SOURCE_LABELS: Record<TxSource, string> = {
  notification: "Notification",
  manual: "Added manually",
  "recurring-rule": "Recurring rule",
  import: "Imported",
};

/** One labelled fact. Every field on this screen is one of these. */
function Field({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View className="gap-1 py-2">
      <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">{label}</Text>
      <Text testID={testID} className="text-base text-fg dark:text-fg-dark">
        {value}
      </Text>
    </View>
  );
}

export default function TransactionDetailScreen() {
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
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const { data: ruleset } = useRuleset();
  // Every row, for the transfer-candidate list. Unfiltered on purpose: the
  // counterpart is by definition in a DIFFERENT wallet, so no repository filter
  // this screen could pass would narrow it usefully.
  const { data: allTransactions } = useTransactions({});

  const rawId = transaction?.rawNotificationId ?? null;
  const { data: capture } = useRawCapture(rawId);
  const { data: expiresAt } = useRawCaptureExpiry(rawId);

  const updateTransaction = useUpdateTransaction();
  const createUserRule = useCreateUserRule();
  const linkTransfer = useLinkTransfer();
  const unlinkTransfer = useUnlinkTransfer();

  if (isPending) {
    return <View testID="transaction-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
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
    <ScrollView
      testID="transaction-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="pb-10 pt-4">
        <View className="px-4">
          <Card>
            <View className="gap-2">
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
              <Text
                testID="transaction-detail-direction"
                className="text-sm text-fg-2 dark:text-fg-2-dark"
              >
                {transaction.direction === "out" ? "Money out" : "Money in"}
              </Text>
              <Text
                testID="transaction-detail-datetime"
                className="text-sm text-fg-2 dark:text-fg-2-dark"
              >
                {formatDateTime(transaction.occurredAt)}
              </Text>
            </View>
          </Card>
        </View>

        <SectionHeader title="Details" />
        <View className="px-4">
          <Card variant="flat">
            <Field
              label="Wallet"
              value={wallet?.name ?? "Unknown wallet"}
              testID="transaction-detail-wallet"
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
            <Field
              label="Merchant"
              value={transaction.merchant ?? transaction.counterparty ?? "Not recorded"}
              testID="transaction-detail-merchant"
            />
            <Field
              label="Reference number"
              value={transaction.referenceNo ?? "Not recorded"}
              testID="transaction-detail-reference"
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
  );
}
