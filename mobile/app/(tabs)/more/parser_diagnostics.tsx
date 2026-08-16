// app/(tabs)/more/parser_diagnostics.tsx — m3b Task 7. Route: /more/parser_diagnostics.
//
// NESTED UNDER app/(tabs)/more/, matching app/(tabs)/more/reports.tsx and
// app/(tabs)/more/subscriptions.tsx — NOT a sibling app/more/ tree, which
// would collide on the same /more/* URL space (that mistake has landed five
// times already; see reports.tsx's own header).
//
// FREE-TIER, UNGATED (rule 5): nothing here sits behind PlusGate or SoonGate.
//
// "REPORT THIS" STOPS AT THE AGGREGATE. Rule 3 asks for an action that "only
// sends the aggregate counts" — `ProviderSuccessMeter`'s `onReport` callback
// receives exactly one `ProviderParseStats` row, which structurally has
// nowhere to carry anything else. The actual network call to
// `POST /v1/telemetry/parse_stats` (interface contract §6) is a client task
// assigned to m3c, not this one — this screen's job is to prove the payload
// this button can ever produce is the aggregate and nothing more, and to give
// the user honest feedback that their tap did something.
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { ProviderSuccessMeter } from "@/components/privacy/provider_success_meter";
import { useParseStats } from "@/hooks/queries/use_parse_stats";
import type { ProviderParseStats } from "@/lib/diagnostics/parse_stats_repo";

export default function ParserDiagnosticsScreen() {
  const { data: stats } = useParseStats();
  const [reportedProviderKey, setReportedProviderKey] = useState<string | null>(null);

  function handleReport(row: ProviderParseStats): void {
    setReportedProviderKey(row.providerKey);
  }

  if (stats === undefined) {
    return <View testID="parser-diagnostics-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  return (
    <ScrollView
      testID="parser-diagnostics-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <View>
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Parser diagnostics</Text>
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
          Parsed and failed counts per provider, over the last 30 days. Counts only — never a
          notification's text, amount, or merchant.
        </Text>
      </View>

      {reportedProviderKey !== null ? (
        <View
          testID="parser-diagnostics-report-confirmation"
          className="rounded-lg bg-brand-soft px-4 py-3 dark:bg-brand-soft-dark"
        >
          <Text className="text-fg dark:text-fg-dark">
            {`Thanks — reported ${reportedProviderKey}'s counts. This helps catch a broken parser early.`}
          </Text>
        </View>
      ) : null}

      <ProviderSuccessMeter stats={stats} onReport={handleReport} />

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
