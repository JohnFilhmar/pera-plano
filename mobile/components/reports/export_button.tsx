// components/reports/export_button.tsx — Reports' CSV export action (M3b
// Task 4; docs/04-features/10-reports.md Flow D; task-4 brief rule 6).
//
// SELF-GATED, unlike components/home/projection_sparkline.tsx's "wrapped by
// its caller" convention — that convention exists for a component reused
// across several mount points, where gating belongs at whichever
// composition edge the upgrade sheet's context makes sense for. This button
// has exactly one mount point (the Reports screen) and the brief's own rule
// 6 states the free-tier badge as THIS component's behavior ("free tier
// sees the button with the Plus badge"), so it self-wraps in `PlusGate` —
// the same choice components/loans/schedule_table.tsx and
// components/goals/goal_form.tsx's contribution-rule field make.
//
// SELF-CONTAINED BY DESIGN: takes the range and date it needs as props and
// calls `exportTransactionsCsv` (a lib function) directly — it does not
// import `lib/db/repos/**` itself (release-gate grep) and does not touch
// `app/(tabs)/more/reports.tsx` or anything else under `components/reports/`,
// both owned by the task building the Reports screen in parallel.
import { useState } from "react";
import { Download } from "lucide-react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { Button } from "@/components/ui/button";
import { hasCsvExport } from "@/lib/entitlements";
import { exportTransactionsCsv } from "@/lib/reports/csv_export";
import type { DateRange } from "@/lib/reports/aggregate";

export type ExportButtonProps = {
  /** The report's current period or custom range (aggregate.ts's inclusive `DateRange`). */
  range: DateRange;
  /** `'YYYY-MM-DD'` — names the written file; the composition edge's clock, not this component's. */
  today: string;
  /** Called with the written file's uri once the share sheet has been handed it. */
  onExported?: (fileUri: string) => void;
  /** Called when the export itself throws — e.g. no committed transactions in range is NOT an error (rule 9's header-only file is a normal export). */
  onError?: (error: unknown) => void;
};

export function ExportButton({ range, today, onExported, onError }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);

  async function handlePress(): Promise<void> {
    // BELT AND BRACES (brief rule 6's "hasBackup-independent check"). `PlusGate`
    // already keeps this handler unreachable on free tier — its own Pressable
    // wraps `children` in `pointerEvents="none"` and intercepts the press
    // itself — but the handler still asks `hasCsvExport()` directly rather
    // than trusting that structure alone, the same call-site discipline
    // lib/entitlements.ts's header asks of every gated call-site.
    if (!hasCsvExport() || busy) return;

    setBusy(true);
    try {
      const fileUri = await exportTransactionsCsv(range, today);
      onExported?.(fileUri);
    } catch (error) {
      onError?.(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlusGate capability="csv_export">
      <Button
        title="Export CSV"
        testID="export-csv-button"
        icon={Download}
        loading={busy}
        onPress={handlePress}
      />
    </PlusGate>
  );
}
