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
import { UserRulesList } from "@/components/privacy/user_rules_list";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useDeleteUserRule } from "@/hooks/mutations/use_delete_user_rule";
import { useSetUserRuleEnabled } from "@/hooks/mutations/use_set_user_rule_enabled";
import { useCategories } from "@/hooks/queries/use_categories";
import { useParseStats } from "@/hooks/queries/use_parse_stats";
import { useUserRules } from "@/hooks/queries/use_user_rules";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function ParserDiagnosticsScreen() {
  const { data: stats } = useParseStats();
  const { data: rules } = useUserRules();
  const { data: categories } = useCategories();
  const { data: wallets } = useWallets();
  const setEnabled = useSetUserRuleEnabled();
  const deleteRule = useDeleteUserRule();

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

      {/* Review-queue rule 16, GAP-128. Here rather than on its own screen
          because rule 16 names this screen, and because a rule and the parse
          counts answer the same question from two directions: why did this
          notification come out the way it did. The list waits for all three
          reads rather than rendering half of itself, since a rule row whose
          category has not arrived yet would show a raw id and then change under
          the reader. */}
      <View className="gap-2">
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Your rules</Text>
        <Text className="text-fg-2 dark:text-fg-2-dark">
          Corrections you have made, applied to matching notifications from then on. Switching one
          off stops it applying to anything new. Neither switching off nor deleting changes a
          transaction it has already touched.
        </Text>
        {rules === undefined || categories === undefined || wallets === undefined ? (
          <LoadingSkeleton rows={2} />
        ) : (
          <UserRulesList
            rules={rules}
            categories={categories}
            wallets={wallets}
            onToggle={(change) => setEnabled.mutate(change)}
            onDelete={(id) => deleteRule.mutate(id)}
          />
        )}
      </View>

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
