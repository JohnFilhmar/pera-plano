// app/(tabs)/more/parser_diagnostics.tsx — m3b Task 7. Route: /more/parser_diagnostics.
//
// NESTED UNDER app/(tabs)/more/, matching app/(tabs)/more/reports.tsx and
// app/(tabs)/more/subscriptions.tsx — NOT a sibling app/more/ tree, which
// would collide on the same /more/* URL space (that mistake has landed five
// times already; see reports.tsx's own header).
//
// FREE-TIER, UNGATED (rule 5): nothing here sits behind PlusGate or SoonGate.
//
// NO "REPORT THIS" CONTROL, ON PURPOSE. An earlier revision shipped a
// per-row "Report this" button whose handler was local `useState` only — no
// network call, no queue, no write of any kind — behind a confirmation
// banner reading "Thanks — reported {provider}'s counts." The real send
// (`services/telemetry.ts`'s `sendParseStats`) is a decoupled, once-per-24h,
// opt-in batch wired only from `lib/bootstrap.ts`, unrelated to which row
// was pressed, and it makes no request at all once the user has turned off
// "Share anonymous parser health" in Settings — so the confirmation was
// false in both directions, and permanently false for anyone who opted out
// (see rest-state-promise-audit.md Finding 1). Removed the control and its
// confirmation rather than building the real scoped-send/opt-out-aware
// version. The paragraph below is what remains — it never claimed anything
// was sent, so it needed no replacement copy.
import { ScrollView, Text, View } from "react-native";

import { ProviderSuccessMeter } from "@/components/privacy/provider_success_meter";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useParseStats } from "@/hooks/queries/use_parse_stats";

export default function ParserDiagnosticsScreen() {
  const { data: stats } = useParseStats();

  if (stats === undefined) {
    return (
      <View testID="parser-diagnostics-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={4} />
      </View>
    );
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

      <ProviderSuccessMeter stats={stats} />

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
