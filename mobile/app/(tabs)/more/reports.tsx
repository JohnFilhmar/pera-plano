// app/(tabs)/more/reports.tsx — M3b Task 3. Route: /more/reports.
//
// SELECTS A SCOPE AND DISPLAYS (interfaces note 1). Every figure comes from
// lib/reports/reports_service.ts's getReport, reached through
// hooks/queries/use_report.ts; nothing in this file computes a peso.
//
// ROUTE PLACEMENT: nested under app/(tabs)/more/, matching
// app/(tabs)/more/subscriptions.tsx — NOT a sibling app/more/ tree, which
// would collide on the same /more/* URL space (m2b Tasks 4 and 8, m2c Task 5
// and m3-part2 Task 6 each made that mistake once already).
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { DonutChart } from "@/components/reports/donut_chart";
import { ExportButton } from "@/components/reports/export_button";
import { RangePicker } from "@/components/reports/range_picker";
import { RankedBars } from "@/components/reports/ranked_bars";
import { SummaryTiles } from "@/components/reports/summary_tiles";
import { TrendLine } from "@/components/reports/trend_line";
import { EmptyState } from "@/components/ui/empty_state";
import { useAvailableScopes, useReport } from "@/hooks/queries/use_report";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";
import type { ReportScope } from "@/lib/reports/reports_service";

/** Rule 6, verbatim. */
const EMPTY_TITLE = "No transactions in this period.";

/** Shown when the share sheet fails to open — export_button.tsx rule 6's
 * "onError" is silent by design (it just calls the prop); a share sheet that
 * quietly does nothing is indistinguishable from a broken button, so this
 * screen is the composition edge that turns the callback into something the
 * user can actually see. */
const EXPORT_ERROR_MESSAGE = "Could not export or share the CSV. Try again.";

export default function ReportsScreen() {
  // Screens are a composition edge too (app/(tabs)/plan/bills.tsx reads the
  // clock the same way) — the default scope needs today's month before any
  // query has resolved, so it cannot wait on one.
  const today = toDateIso(new Date(systemClock.now()));
  const [scope, setScope] = useState<ReportScope>({ kind: "month", month: today.slice(0, 7) });
  const [exportError, setExportError] = useState<string | null>(null);

  const scopesQuery = useAvailableScopes();
  const reportQuery = useReport(scope);

  if (scopesQuery.data === undefined || reportQuery.data === undefined) {
    return <View testID="reports-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  const { summary, categories, trend, merchants, truncatedByTier } = reportQuery.data;

  return (
    <ScrollView
      testID="reports-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <RangePicker
        scope={scope}
        availableScopes={scopesQuery.data}
        onSelectMonth={(month) => setScope({ kind: "month", month })}
        onSelectCustom={(range) => setScope({ kind: "custom", range })}
      />

      {/* reports_service.ts's resolveScope: a scope the current tier can no
          longer honor clamps to the current month rather than erroring. This
          notice is the "explain" half of that contract, so the clamp never
          reads as the app silently ignoring what was asked for. */}
      {truncatedByTier ? (
        <View testID="reports-truncated-notice" className="rounded-xl bg-brand-soft p-3 dark:bg-brand-soft-dark">
          <Text className="text-fg dark:text-fg-dark">
            Showing the current month — upgrade to Plus to view other periods.
          </Text>
        </View>
      ) : null}

      {/* `summary.range` is the SCOPE'S resolved range, not a hardcoded one —
          the same clamped/custom range every chart on this screen is already
          drawing from, so the exported CSV always matches what's on screen.
          ExportButton is self-gated (wraps its own PlusGate) — mounted bare,
          never wrapped in a second PlusGate, or two `plus-badge` views would
          render at once. `testID` on the wrapper gives tests a scope of just
          this button — RangePicker above has its own independent PlusGate
          (the custom-range row), so a bare screen-wide "plus-badge" query
          would count both and could not tell one gate's badge from the
          other's. */}
      <View testID="reports-export">
        <ExportButton
          range={summary.range}
          today={today}
          onExported={() => setExportError(null)}
          onError={() => setExportError(EXPORT_ERROR_MESSAGE)}
        />
        {exportError ? (
          <Text testID="reports-export-error" className="text-danger dark:text-danger-dark">
            {exportError}
          </Text>
        ) : null}
      </View>

      {summary.transactionCount === 0 ? (
        <EmptyState testID="reports-empty" title={EMPTY_TITLE} body="Nothing was tracked in this range yet." />
      ) : (
        <>
          <SummaryTiles summary={summary} />
          <DonutChart categories={categories} />
          <RankedBars merchants={merchants} />
          <TrendLine points={trend} />
        </>
      )}
    </ScrollView>
  );
}
