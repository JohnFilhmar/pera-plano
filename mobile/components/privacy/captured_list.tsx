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
//
// device-testing round 3, task 2: on the owner's device this screen rendered
// every unexpired capture (up to 30 days) as one unbroken ScrollView —
// 1080×7707px. The fix is pagination, never truncation — the header promise
// above ("has to see the actual text") rules out `numberOfLines` or a
// summary, so the height comes down by showing fewer WHOLE rows at once,
// with a page control and a same-screen filter to get to a flooding app.
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { captureLines } from "@/components/transactions/why_recorded_panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
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

export type CapturedPackageOption = { packageName: string; label: string; count: number };

/**
 * One option per distinct `capture.packageName`, `label` taken from that
 * group's (already-resolved) `providerName` — see the file header on why
 * this component never resolves a package itself. Ordered noisiest-first so
 * the app flooding the list is the first chip a user's thumb reaches.
 */
export function capturedPackageOptions(items: readonly CapturedListItem[]): CapturedPackageOption[] {
  const byPackage = new Map<string, CapturedPackageOption>();
  for (const item of items) {
    const packageName = item.capture.packageName;
    const existing = byPackage.get(packageName);
    if (existing) {
      existing.count += 1;
    } else {
      byPackage.set(packageName, { packageName, label: item.providerName, count: 1 });
    }
  }
  // Count descending, then label ascending — a deterministic tiebreak so two
  // packages tied on count don't reshuffle position between renders and move
  // a chip out from under a thumb already on its way down.
  return Array.from(byPackage.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
}

/** One page's worth of cards. Keeps the screen's worst-case height bounded
 * regardless of how many captures the 30-day TTL is currently holding. */
export const CAPTURES_PER_PAGE = 10;

export function CapturedList({ items, now = Date.now(), testID = "captured-list" }: CapturedListProps) {
  const [page, setPage] = useState(0);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  const packageOptions = useMemo(() => capturedPackageOptions(items), [items]);

  const filteredItems = useMemo(
    () =>
      selectedPackage === null
        ? items
        : items.filter((item) => item.capture.packageName === selectedPackage),
    [items, selectedPackage],
  );

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / CAPTURES_PER_PAGE));
  // Clamped, not trusted: a refetch that shortened the list (or a filter —
  // see below) can leave `page` pointing past the new last page. Deriving
  // the page actually shown from `page` rather than mutating `page` itself
  // means the very next render self-corrects instead of showing zero rows.
  const clampedPage = Math.min(page, totalPages - 1);

  // Slicing here, not sorting: the screen already hands rows down
  // newest-first (app/__tests__/privacy_screen.test.tsx), and re-sorting a
  // presentational component's input would risk disagreeing with that order.
  const pageStart = clampedPage * CAPTURES_PER_PAGE;
  const pageItems = filteredItems.slice(pageStart, pageStart + CAPTURES_PER_PAGE);
  const rangeFirst = pageStart + 1;
  const rangeLast = pageStart + pageItems.length;

  const handleSelectPackage = (packageName: string | null) => {
    setSelectedPackage(packageName);
    // A filter that leaves the user on a stale page can land past its own
    // (now shorter) result and render an empty list that looks broken —
    // always surface the new result from its start.
    setPage(0);
  };

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
      {packageOptions.length > 1 ? (
        // One app means one chip plus "All" — a control that cannot change
        // anything — so the row only earns its place once there is a real
        // choice to make.
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          <Chip
            testID="captured-filter-all"
            label="All"
            tone={selectedPackage === null ? "brand" : "neutral"}
            selected={selectedPackage === null}
            onPress={() => handleSelectPackage(null)}
          />
          {packageOptions.map((option) => (
            <Chip
              key={option.packageName}
              testID={`captured-filter-${option.packageName}`}
              label={`${option.label} · ${option.count}`}
              tone={selectedPackage === option.packageName ? "brand" : "neutral"}
              selected={selectedPackage === option.packageName}
              onPress={() => handleSelectPackage(option.packageName)}
            />
          ))}
        </ScrollView>
      ) : null}

      {pageItems.map(({ capture, providerName, expiresAt }) => (
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

      {filteredItems.length > CAPTURES_PER_PAGE ? (
        <View testID="captured-pager" className="flex-row items-center justify-between gap-2">
          <Button
            testID="captured-prev-page"
            title="Previous"
            variant="secondary"
            onPress={() => setPage(clampedPage - 1)}
            disabled={clampedPage === 0}
          />
          <Text testID="captured-pager-status" className="text-sm text-fg-2 dark:text-fg-2-dark">
            {`Showing ${rangeFirst}–${rangeLast} of ${filteredItems.length}`}
          </Text>
          <Button
            testID="captured-next-page"
            title="Next"
            variant="secondary"
            onPress={() => setPage(clampedPage + 1)}
            disabled={clampedPage >= totalPages - 1}
          />
        </View>
      ) : null}
    </View>
  );
}
