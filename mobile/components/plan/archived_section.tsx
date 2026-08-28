// components/plan/archived_section.tsx — "Show deleted" plus a Restore button,
// for every Plan tab.
//
// Owner's device report: "no way to see and unarchive archived goals and the
// same for other planned tabs". Every Plan tab grew a retire action on its
// detail screen and none of them grew the other half, so a row retired by
// mistake left the app entirely. The rows were always still there — retiring
// has never removed one — they were simply unreachable.
//
// THE UI SAYS DELETE, THE SCHEMA SAYS ARCHIVE, and that split is deliberate
// (owner, 2026-08-28: "replace the misleading button text from archive to
// 'delete'"). "Archive" is the mechanism — `archived_at`, `archiveBill`,
// `unarchiveGoal` — and it is not a word most people reach for when they want
// something gone. Every Plan entity is now soft-deleted and restorable, so the
// app can safely use the word the user actually means and keep the promise
// behind it. The file and prop names stay on the schema's vocabulary so the
// code reads consistently with the repositories; only what is RENDERED changed.
//
// ONE COMPONENT FOR THE FOUR TABS, following `app/(tabs)/wallets.tsx`, which
// already had this shape (a `showArchived` toggle over a list keyed by it) and
// was the only screen in the app that did. Four hand-rolled copies is how the
// app ended up with five slightly different chips; see components/ui/chip.tsx.
//
// PRESENTATIONAL. The panel owns the open/closed state — it has to, because
// that flag also gates the query behind it — and owns the mutation. This file
// renders what it is handed.
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section_header";

export type ArchivedItem = {
  id: string;
  name: string;
  /** One line under the name — what it was, or when it was retired. */
  detail?: string;
};

export type ArchivedSectionProps = {
  testID: string;
  /** Plural, lowercase, used in this section's own sentences: "bills". */
  noun: string;
  open: boolean;
  onToggle: () => void;
  /** `undefined` while the query behind the toggle is still loading. */
  items: ArchivedItem[] | undefined;
  onRestore: (id: string) => void;
  /** The id currently being restored, so only its own row shows a spinner. */
  restoringId?: string | null;
  /**
   * A restore the repository refused, already turned into a sentence by the
   * panel — which is the only layer that knows which entity it is talking
   * about and therefore what the user should do next.
   *
   * ONLY GOALS CAN REACH THIS TODAY. Deleting a goal frees its savings account,
   * so restoring one whose wallet has since been claimed by a new goal has to
   * fail rather than put two live goals on one account. Bills, limits and loans
   * hold nothing exclusive, so their restores cannot be refused — the prop is
   * simply unused there rather than special-cased away.
   */
  error?: string | null;
};

export function ArchivedSection({
  testID,
  noun,
  open,
  onToggle,
  items,
  onRestore,
  restoringId = null,
  error = null,
}: ArchivedSectionProps) {
  return (
    <View testID={testID} className="gap-3">
      {/* A Pressable rather than `Button`: this is a disclosure control, and
          every `Button` variant in this app reads as an ACTION with weight —
          filling it would make "look at what I threw away" compete with the
          tab's real action (the Add FAB) for attention it does not deserve. */}
      <Pressable
        testID={`${testID}-toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="min-h-[44px] justify-center"
      >
        <Text className="text-sm font-semibold text-brand-ink dark:text-brand-ink-dark">
          {open ? `Hide deleted ${noun}` : `Show deleted ${noun}`}
        </Text>
      </Pressable>

      {!open ? null : items === undefined ? (
        <ActivityIndicator testID={`${testID}-loading`} />
      ) : items.length === 0 ? (
        <Text testID={`${testID}-empty`} className="text-sm text-fg-2 dark:text-fg-2-dark">
          Nothing deleted.
        </Text>
      ) : (
        <View className="gap-3">
          <SectionHeader title="Deleted" />
          {error === null ? null : (
            // ABOVE THE ROWS, not beside one. The panel reports the last failed
            // restore and does not say which row it was; putting the message on
            // a guessed row would attach it to the wrong one.
            <Text
              testID={`${testID}-error`}
              className="text-sm text-danger dark:text-danger-dark"
            >
              {error}
            </Text>
          )}
          {items.map((item) => (
            <View
              key={item.id}
              testID={`${testID}-row-${item.id}`}
              className="flex-row items-center justify-between gap-3 rounded-xl bg-surface p-4 dark:bg-surface-dark"
            >
              <View className="flex-1">
                <Text className="text-fg dark:text-fg-dark">{item.name}</Text>
                {item.detail === undefined ? null : (
                  <Text className="mt-1 text-xs text-fg-2 dark:text-fg-2-dark">{item.detail}</Text>
                )}
              </View>
              <Button
                title="Restore"
                variant="secondary"
                testID={`${testID}-restore-${item.id}`}
                loading={restoringId === item.id}
                onPress={() => onRestore(item.id)}
              />
            </View>
          ))}
          {/* Said once, here, rather than in a confirmation dialog per row.
              Restoring is not destructive — it is the undo — so a dialog in
              front of it would be friction guarding nothing. */}
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
            Restoring puts it back exactly as it was. Nothing in your ledger changed while it was
            deleted.
          </Text>
        </View>
      )}
    </View>
  );
}
