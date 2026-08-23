// components/goals/allocation_sheet.tsx — m2b Task 4, rule 6.
//
// THE SHEET NEVER PRE-COMMITS. It holds its own checked/edited state and hands
// the survivors back on confirm; nothing reaches `applyAllocations` until the
// user presses the button. That is the UI half of the service's rule 1 — "the
// app does not move money, it records that the user did" — and it is why the
// toggle state lives here rather than being written through on every tap.
//
// EVERY ROW IS EDITABLE, because the proposal is a suggestion about money the
// user is about to move by hand. If they move ₱1,800 instead of ₱2,000, the
// ledger has to record ₱1,800 or it is simply wrong.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { NumericField } from "@/components/ui/numeric_field";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type { AllocationProposal } from "@/lib/goals/goals_service";
import type { Centavos } from "@/types/domain";

export type AllocationSheetProps = {
  visible: boolean;
  proposals: AllocationProposal[];
  /** The payday the proposals came out of — the ceiling the total is shown against. */
  paydayAmount: Centavos;
  onDismiss: () => void;
  onConfirm: (accepted: AllocationProposal[]) => void;
  busy?: boolean;
};

type RowState = { checked: boolean; text: string };

export function AllocationSheet({
  visible,
  proposals,
  paydayAmount,
  onDismiss,
  onConfirm,
  busy = false,
}: AllocationSheetProps) {
  // Keyed by goal id, seeded from the proposals. Checked by default: the user
  // set these rules themselves, so the sheet's job is to let them opt OUT of
  // this payday, not to make them re-approve their own configuration.
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      proposals.map((proposal) => [
        proposal.goalId,
        // pesoInputFrom, NOT String(proposal.amount) — proposal.amount is
        // CENTAVOS, and centavosFrom below reads a seeded field as PESOS.
        // String(200000) would seed "200000" and round-trip as ₱200,000.00,
        // a 100x inflation baked into the default rather than typed by the
        // user (numeric-input-system Task 11).
        { checked: true, text: pesoInputFrom(proposal.amount) },
      ]),
    ),
  );

  const rowFor = (proposal: AllocationProposal): RowState =>
    rows[proposal.goalId] ?? { checked: true, text: pesoInputFrom(proposal.amount) };

  const accepted = proposals
    .map((proposal) => ({ proposal, row: rowFor(proposal) }))
    .filter(({ row }) => row.checked && centavosFrom(row.text) > 0)
    .map(({ proposal, row }) => ({ ...proposal, amount: centavosFrom(row.text) }));

  const total = accepted.reduce((sum, proposal) => sum + proposal.amount, 0);
  const overPayday = total > paydayAmount;

  const setRow = (goalId: string, patch: Partial<RowState>) =>
    setRows((current) => ({
      ...current,
      [goalId]: { ...(current[goalId] ?? { checked: true, text: "0" }), ...patch },
    }));

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Move money to your goals">
      <View testID="allocation-sheet" className="gap-4">
        <Text className="text-fg-2 dark:text-fg-2-dark">
          {`Move these yourself in your banking app — PeraPlano will record them against your ${formatCentavos(paydayAmount)} payday.`}
        </Text>

        {proposals.map((proposal) => {
          const row = rowFor(proposal);
          return (
            <View key={proposal.goalId} className="gap-2 rounded-xl bg-chip p-3 dark:bg-chip-dark">
              <Pressable
                testID={`allocation-toggle-${proposal.goalId}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: row.checked }}
                onPress={() => setRow(proposal.goalId, { checked: !row.checked })}
                className="min-h-[44px] flex-row items-center justify-between"
              >
                <Text className="font-semibold text-fg dark:text-fg-dark">
                  {proposal.goalName}
                </Text>
                <Chip
                  label={row.checked ? "Included" : "Skipped"}
                  tone={row.checked ? "brand" : "neutral"}
                  fill={row.checked ? "soft" : "outline"}
                />
              </Pressable>

              {/* `disabled`, the direct replacement for the old
                  editable={row.checked}. This used to be a
                  pointerEvents="none" wrapper that left a skipped row looking
                  fully enabled — same colours as an editable one, announced
                  to TalkBack as a plain button — while silently swallowing
                  every tap. The prop dims it and marks it disabled to a
                  screen reader, both inside the field. */}
              <NumericField
                testID={`allocation-amount-${proposal.goalId}`}
                label={proposal.goalName}
                mode="peso"
                disabled={!row.checked}
                value={row.text}
                onChangeText={(text) => setRow(proposal.goalId, { text })}
              />
              <Text className="text-fg-2 dark:text-fg-2-dark">
                {formatCentavos(centavosFrom(row.text))}
              </Text>

              {/* Rule 3's shortfall, surfaced. The user planned one figure and
                  the payday could not cover it; saying so is more useful than
                  silently showing the smaller number. */}
              {proposal.amount < proposal.requested ? (
                <Text
                  testID={`allocation-shortfall-${proposal.goalId}`}
                  className="text-fg-2 dark:text-fg-2-dark"
                >
                  {`${formatCentavos(proposal.requested)} planned — this payday only covers ${formatCentavos(proposal.amount)}.`}
                </Text>
              ) : null}
            </View>
          );
        })}

        <View className="flex-row items-center justify-between">
          <Text className="font-semibold text-fg dark:text-fg-dark">Total</Text>
          <Text testID="allocation-total" className="font-semibold text-fg dark:text-fg-dark">
            {`${formatCentavos(total)} of ${formatCentavos(paydayAmount)}`}
          </Text>
        </View>

        {overPayday ? (
          <Text testID="allocation-over-warning" className="text-danger dark:text-danger-dark">
            That is more than this payday. Lower an amount or skip a goal.
          </Text>
        ) : null}

        <Button
          title="Record these"
          testID="allocation-confirm"
          disabled={accepted.length === 0 || overPayday || busy}
          loading={busy}
          onPress={() => onConfirm(accepted)}
        />
        <Button title="Not now" variant="ghost" testID="allocation-skip" onPress={onDismiss} />
      </View>
    </BottomSheet>
  );
}
