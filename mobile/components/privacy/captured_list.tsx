// components/privacy/captured_list.tsx — "What PeraPlano captured" (m3b
// Task 6 rule 3; interface note 1).
//
// THIS LIST IS THE PROOF BEHIND THE PRIVACY PROMISE. It renders the REAL
// rows `useRawCaptures` reads back from `raw_notifications` — the same table
// and the same `captureLines`/`captureExpiryLabel` presentation
// `WhyRecordedPanel` (components/transactions/why_recorded_panel.tsx) uses
// for one Transaction's capture, so the two surfaces can never show
// different text or a different deletion date for the same row. It never
// shows a summary or a count in place of the rows themselves — a user who
// came here to check what the app actually read has to see the actual text,
// not a reassurance that some exists.
//
// PRESENTATIONAL. `items` arrives already resolved — the provider name
// resolved via constants/providers.ts's `providerLabelForPackage` against
// the installed ruleset — by app/(tabs)/more/privacy.tsx, matching how
// app/transaction/[id].tsx resolves `WhyRecordedPanel`'s own `providerName`
// prop. This file imports no repository and no native module.
import { Text, View } from "react-native";

import { captureLines } from "@/components/transactions/why_recorded_panel";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { ExpiryCountdown } from "./expiry_countdown";
import type { EpochMs, RawCapture } from "@/types/domain";

export type CapturedListItem = {
  capture: RawCapture;
  /** Resolved to a human name — never the raw Android package (see the file header). */
  providerName: string;
  expiresAt: EpochMs;
};

export type CapturedListProps = {
  items: CapturedListItem[];
  now?: EpochMs;
  testID?: string;
};

export function CapturedList({ items, now = Date.now(), testID = "captured-list" }: CapturedListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        testID="captured-list-empty"
        title="Nothing captured yet"
        body="Notifications PeraPlano reads from your banks and e-wallets will show up here, with the exact text it read."
      />
    );
  }

  return (
    <View testID={testID} className="gap-3">
      {items.map(({ capture, providerName, expiresAt }) => (
        <Card key={capture.id} testID={`captured-item-${capture.id}`} variant="flat">
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-fg dark:text-fg-dark">
                {providerName}
              </Text>
              <ExpiryCountdown expiresAt={expiresAt} now={now} testID={`captured-item-expiry-${capture.id}`} />
            </View>
            <View testID={`captured-item-text-${capture.id}`} className="gap-1 rounded-xl bg-bg p-3 dark:bg-bg-dark">
              {captureLines(capture).map((line) => (
                <Text key={line} className="text-sm text-fg dark:text-fg-dark">
                  {line}
                </Text>
              ))}
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}
