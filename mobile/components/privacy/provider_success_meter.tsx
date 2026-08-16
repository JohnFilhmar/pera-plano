// components/privacy/provider_success_meter.tsx — m3b Task 7.
//
// Rule 3: a provider whose failure rate climbs is the earliest signal that
// its notification wording changed underneath the parser — this meter exists
// to surface that BEFORE the user notices missing transactions on their own.
//
// TAKES STATS AS A PROP, NEVER READS THE REPO ITSELF. Components must never
// import `lib/db/repos/**` (release-gate grep); this file imports only the
// TYPE from `lib/diagnostics/parse_stats_repo.ts` — which is not a repo under
// that path — and the screen supplies the actual rows via
// `hooks/queries/use_parse_stats.ts`.
//
// SEMANTIC COLOUR, NOT THE CHART RAMP. `constants/colors.ts` permits the
// success meter to use `chart-1`..`chart-8`, but that ramp exists for
// CATEGORICAL data — "this provider, not that one" — and parsed-vs-failed is
// a STATUS axis, the exact thing `brand`/`danger` already mean app-wide. Two
// colour systems answering the same "good or bad" question here would be the
// one place they could disagree.
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import type { ProviderParseStats } from "@/lib/diagnostics/parse_stats_repo";

/**
 * Docs/08-risks-and-open-questions.md's own pre-launch bar: "the ≥95% parse
 * ... criterion". A provider whose window has fallen BELOW that bar (failure
 * rate above 5%) is the same regression that criterion exists to catch, so
 * the highlight reuses its number rather than inventing a separate one.
 */
export const FAILURE_RATE_THRESHOLD = 0.05;

function failureRate(stats: ProviderParseStats): number {
  const total = stats.parsed + stats.failed;
  return total === 0 ? 0 : stats.failed / total;
}

export type ProviderSuccessMeterProps = {
  stats: ProviderParseStats[];
  /** Sends ONLY the aggregate row the user pressed — see this file's header. */
  onReport: (stats: ProviderParseStats) => void;
  testID?: string;
};

export function ProviderSuccessMeter({ stats, onReport, testID }: ProviderSuccessMeterProps) {
  if (stats.length === 0) {
    return (
      <EmptyState
        testID={testID ?? "provider-success-meter-empty"}
        title="No parse activity yet"
        body="Once notifications start arriving, each provider's parsed and failed counts will show up here."
      />
    );
  }

  return (
    <View testID={testID ?? "provider-success-meter"} className="gap-3">
      {stats.map((row) => {
        const total = row.parsed + row.failed;
        const parsedRatio = total === 0 ? 0 : row.parsed / total;
        const flagged = failureRate(row) > FAILURE_RATE_THRESHOLD;

        return (
          <Card key={row.providerKey} testID={`provider-success-${row.providerKey}`}>
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-fg dark:text-fg-dark">{row.providerKey}</Text>
              {flagged ? (
                <Text
                  testID={`provider-success-${row.providerKey}-flag`}
                  className="text-xs font-semibold uppercase text-danger dark:text-danger-dark"
                >
                  Needs attention
                </Text>
              ) : null}
            </View>

            <View
              className="mt-3 h-2 overflow-hidden rounded-full bg-danger dark:bg-danger-dark"
            >
              <View
                testID={`provider-success-${row.providerKey}-fill`}
                className="h-2 rounded-full bg-brand dark:bg-brand-dark"
                style={{ width: `${Math.round(parsedRatio * 100)}%` }}
              />
            </View>

            <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">
              {`${row.parsed} parsed · ${row.failed} failed`}
            </Text>

            {flagged ? (
              <Text className="mt-1 text-danger dark:text-danger-dark">
                This provider&apos;s parse success has dropped — its notification wording may
                have changed.
              </Text>
            ) : null}

            <Pressable
              testID={`provider-success-${row.providerKey}-report`}
              accessibilityRole="button"
              onPress={() => onReport(row)}
              className="mt-2 self-start"
            >
              <Text className="font-semibold text-brand dark:text-brand-dark">Report this</Text>
            </Pressable>
          </Card>
        );
      })}
    </View>
  );
}
