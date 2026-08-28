// components/plan/archived_section.tsx — "Show archived" plus a Restore button,
// for every Plan tab that can archive something.
//
// Owner's device report: "no way to see and unarchive archived goals and the
// same for other planned tabs". Bills, Limits and Utang each grew an archive
// action on their detail screen and none of them grew the other half, so a row
// archived by mistake left the app entirely. The rows were always still there —
// archiving has never deleted anything — they were simply unreachable.
//
// ONE COMPONENT FOR THE THREE TABS, following `app/(tabs)/wallets.tsx`, which
// already had this shape (a `showArchived` toggle over a list keyed by it) and
// was the only screen in the app that did. Three hand-rolled copies is how the
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
};

export function ArchivedSection({
  testID,
  noun,
  open,
  onToggle,
  items,
  onRestore,
  restoringId = null,
}: ArchivedSectionProps) {
  return (
    <View testID={testID} className="gap-3">
      {/* A Pressable rather than `Button`: this is a disclosure control, and
          every `Button` variant in this app reads as an ACTION with weight —
          filling it would make "look at what I retired" compete with the tab's
          real action (the Add FAB) for attention it does not deserve. */}
      <Pressable
        testID={`${testID}-toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="min-h-[44px] justify-center"
      >
        <Text className="text-sm font-semibold text-brand-ink dark:text-brand-ink-dark">
          {open ? `Hide archived ${noun}` : `Show archived ${noun}`}
        </Text>
      </Pressable>

      {!open ? null : items === undefined ? (
        <ActivityIndicator testID={`${testID}-loading`} />
      ) : items.length === 0 ? (
        <Text testID={`${testID}-empty`} className="text-sm text-fg-2 dark:text-fg-2-dark">
          Nothing archived.
        </Text>
      ) : (
        <View className="gap-3">
          <SectionHeader title="Archived" />
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
            archived.
          </Text>
        </View>
      )}
    </View>
  );
}
