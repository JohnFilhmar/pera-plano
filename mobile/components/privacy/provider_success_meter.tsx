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
//
// NO "REPORT THIS" CONTROL HERE ANYMORE. Each row used to carry a Pressable
// that only flipped local state in the caller and never sent anything — see
// app/(tabs)/more/parser_diagnostics.tsx's header comment for the full
// rationale (rest-state-promise-audit.md Finding 1). Removed along with the
// `onReport` prop it existed to call.
import { Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { ProviderBadge } from "@/components/ui/provider_badge";
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
  testID?: string;
};

export function ProviderSuccessMeter({ stats, testID }: ProviderSuccessMeterProps) {
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
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-1 flex-row items-center gap-2">
                {/* `row.providerKey` is a real, non-empty DB column — never
                    the empty string `providerBadge("")` falls back to a grey
                    "?" for — so this always renders a real colour-and-letter
                    identity, never that specific broken case. An UNKNOWN but
                    non-empty key (a test fixture like "old-provider") still
                    resolves to `providerBadge`'s OWN designed fallback (grey
                    square, the key's own initial), which is a different,
                    intended branch, not the forbidden one. */}
                <ProviderBadge providerKey={row.providerKey} size={20} />
                <Text className="font-semibold text-fg dark:text-fg-dark">{row.providerKey}</Text>
              </View>
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
          </Card>
        );
      })}
    </View>
  );
}
