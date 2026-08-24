// app/(tabs)/plan/limits/[id].tsx — Limit detail (m2 Task 8;
// docs/04-features/03-limits.md "Flow: breach", rules 3-4).
//
// Rule 3 names what this screen owes the user: "progress bar, effective limit
// (base + rollover carryover, ITEMIZED), spend so far, remaining or overage,
// days left, and the list of transactions counted this period." Rule 4 adds the
// three actions: edit, mute for the period, delete.
//
// ALL THREE ARE FINALLY HERE (2026-08-20). "Edit" was never built — the owner's
// report is that limits "should still be modifiable" — and "delete" is now
// ARCHIVE: `deleteLimit`'s literal `DELETE FROM limits` is gone, because a
// limit is what a breach is attributed to and the rule across the plan entities
// is that retiring something never destroys what it explains.
//
// THE DRILL-DOWN LIST USES THE LIMIT'S OWN FILTERS. The m2 plan's version
// passes a wallet id only when the limit filters on exactly one wallet, and
// never passes the category filter at all — so a category-filtered limit lists
// every transaction in the period while the total above it counts a fraction of
// them, and the screen visibly contradicts itself. `listTransactions` and
// `sumSpend` are given the SAME filters here, expanded the same way
// (`expandCategoryIds`, rule 4's descendants rule), so the list adds up to the
// number printed above it.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";

import { LimitCard } from "@/components/limits/limit_card";
import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import { EmptyState } from "@/components/ui/empty_state";
import { ListRow } from "@/components/ui/list_row";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { SectionHeader } from "@/components/ui/section_header";
import { queryKeys } from "@/constants/query_keys";
import { useArchiveLimit } from "@/hooks/mutations/use_archive_limit";
import { useMuteLimit } from "@/hooks/mutations/use_mute_limit";
import { useCategories } from "@/hooks/queries/use_categories";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { listCategoryRefs } from "@/lib/db/repos/categories_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { formatDate } from "@/lib/datetime";
import { expandCategoryIds } from "@/lib/limits/limit_engine";
import { limitDisplayName } from "@/lib/limits/limit_label";

export default function LimitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: statuses } = useLimitStatuses();
  const { data: categories } = useCategories();
  const mute = useMuteLimit();
  const archive = useArchiveLimit();
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const status = (statuses ?? []).find((candidate) => candidate.limit.id === id);

  const { data: transactions } = useQuery({
    queryKey: queryKeys.limits.detail(id ?? ""),
    enabled: status !== undefined && !status.paused,
    queryFn: async () => {
      const limit = status!.limit;
      const categoryIds =
        limit.categoryFilter !== null && limit.categoryFilter.length > 0
          ? expandCategoryIds(limit.categoryFilter, await listCategoryRefs())
          : undefined;

      const rows = await listTransactions({
        from: status!.window.start,
        to: status!.window.end,
        direction: "out",
        excludeTransferLinked: true,
      });

      // `listTransactions` takes a single optional walletId/categoryId, while a
      // limit filters on SETS of both — so the set filtering happens here
      // rather than being silently dropped.
      return rows.filter((row) => {
        if (categoryIds !== undefined && !categoryIds.includes(row.categoryId)) return false;
        if (
          limit.walletFilter !== null &&
          limit.walletFilter.length > 0 &&
          !limit.walletFilter.includes(row.walletId)
        ) {
          return false;
        }
        return true;
      });
    },
  });

  if (statuses === undefined) {
    return (
      <View testID="limit-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={5} />
      </View>
    );
  }

  if (status === undefined) {
    // Reachable by pressing Archive on this very screen — the mutation
    // invalidates, the status disappears, and this renders for a frame before
    // `router.back()` lands. It is also what a stale deep link hits.
    return (
      <View testID="limit-detail-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This limit is gone"
          body="It was archived. Your transactions are untouched — a limit only ever watched them."
          action={{ label: "Back to limits", onPress: () => router.back() }}
        />
      </View>
    );
  }

  const categoryNames = new Map((categories ?? []).map((category) => [category.id, category.name]));
  const name = limitDisplayName(status.limit, categoryNames);

  return (
    <ScrollView
      testID="limit-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <LimitCard
        testID="limit-detail-card"
        name={name}
        spend={status.spend}
        effectiveLimit={status.effectiveLimit}
        daysLeft={status.window.daysLeft}
        uiState={status.uiState}
      />

      {status.effectiveLimit !== null ? (
        <Card>
          {/* ITEMIZED, per rule 3 — the user has to be able to see that part of
              their headroom is borrowed from last period and will not be there
              next time. A single total hides that. */}
          <View className="flex-row items-center justify-between">
            <Text className="text-fg-2 dark:text-fg-2-dark">Base</Text>
            <AmountText amount={status.base ?? 0} />
          </View>
          {status.carryover > 0 ? (
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-fg-2 dark:text-fg-2-dark">Rollover from last period</Text>
              <AmountText testID="limit-detail-carryover" amount={status.carryover} />
            </View>
          ) : null}
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="font-semibold text-fg dark:text-fg-dark">Effective limit</Text>
            <AmountText testID="limit-detail-effective" amount={status.effectiveLimit} size="lg" />
          </View>
          <Text className="mt-3 text-fg-2 dark:text-fg-2-dark">
            {`Spent ${formatCentavos(status.spend)} · ${status.window.daysLeft} ${
              status.window.daysLeft === 1 ? "day" : "days"
            } left`}
          </Text>
        </Card>
      ) : null}

      {/* Rule 4's three actions, all three finally present: edit, mute, and
          retire. "Edit" was the missing one (owner: limits "should still be
          modifiable"), and "Delete" is now "Archive" — see below. */}
      <View className="flex-row flex-wrap gap-3">
        <Button
          title="Edit"
          variant="secondary"
          testID="limit-edit"
          onPress={() =>
            router.push({
              pathname: "/plan/limits/[id]/edit",
              params: { id: status.limit.id },
            })
          }
        />
        <Button
          title="Mute this period"
          variant="secondary"
          testID="limit-mute"
          onPress={() => mute.mutate(status.limit.id)}
          loading={mute.isPending}
        />
        {/* ARCHIVE, NOT DELETE (owner-approved 2026-08-20). It used to run a
            real `DELETE FROM limits`; a limit is what a breach is attributed
            to, and the rule across the plan entities is now that retiring
            something never destroys what it explains.

            BEHIND A CONFIRMATION, because the row leaves the list and the only
            way back is a screen that does not exist yet — an accidental tap
            should not be the way a user discovers that. */}
        <Button
          title="Archive"
          variant="destructive"
          testID="limit-archive"
          onPress={() => setConfirmingArchive(true)}
          loading={archive.isPending}
        />
      </View>

      <ConfirmDialog
        visible={confirmingArchive}
        title="Archive this limit?"
        body="It stops appearing in Plan and stops alerting you. Nothing you have spent is deleted, and the breaches it recorded stay readable."
        confirmLabel="Archive"
        destructive
        onCancel={() => setConfirmingArchive(false)}
        onConfirm={async () => {
          setConfirmingArchive(false);
          await archive.mutateAsync(status.limit.id);
          router.back();
        }}
      />

      <SectionHeader title="Counted this period" />
      {transactions === undefined || transactions.length === 0 ? (
        <Text testID="limit-detail-no-transactions" className="text-fg-2 dark:text-fg-2-dark">
          Nothing counted toward this limit yet.
        </Text>
      ) : (
        transactions.map((transaction) => (
          <ListRow
            key={transaction.id}
            testID={`limit-tx-${transaction.id}`}
            title={transaction.merchant ?? "Unknown"}
            subtitle={formatDate(transaction.occurredAt)}
            right={<AmountText amount={transaction.amount} direction="out" />}
          />
        ))
      )}
    </ScrollView>
  );
}
