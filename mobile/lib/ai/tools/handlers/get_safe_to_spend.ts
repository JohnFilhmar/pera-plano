// mobile/lib/ai/tools/handlers/get_safe_to_spend.ts
//
// CALLS THE SERVICE, DOES NOT RE-DERIVE. AI spec §1.2 boundary 2: the
// assistant reads the screen's own source, so it structurally cannot disagree
// with the screen. "The first time the assistant says ₱2,380 while the Reports
// tab says ₱2,400, the user stops believing both."
//
// THE FIELD IS `perDay`, NOT `amount`. The design spec §5.2/7 names `.amount`,
// which does not exist on `SafeToSpendResult` (lib/safe_to_spend.ts:74). `perDay`
// is the figure Home shows; `overBy` is a WHOLE-PERIOD shortfall and is
// surfaced separately and labelled, because a model handed both as
// undifferentiated numbers will average them into a sentence — and telling a
// user who is ₱3,499 over that they are ₱175 over is the exact failure
// lib/safe_to_spend.ts warns about in its own comment.
import { formatCentavos } from "@/components/ui/amount_text";
import { toDateIso } from "@/lib/dates";
import { isDatabaseUnlocked } from "@/lib/db/database";
import { getSafeToSpend } from "@/lib/safe_to_spend_service";
import type { EpochMs } from "@/types/domain";
import { locked, ok, safeText, type DisplayField, type ToolResult } from "../types";

const TOOL = "get_safe_to_spend";

export type SafeToSpendData = {
  state: string;
  drivingFilterLabel: string | null;
};

export async function handleGetSafeToSpend(
  _args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<SafeToSpendData>> {
  // RULE 2: a refusal, never an empty success. AI spec §3.6 — an empty result
  // is indistinguishable from "you have no transactions", and a model handed
  // that will cheerfully tell a locked user they have no money.
  if (!isDatabaseUnlocked()) return locked(TOOL);

  const result = await getSafeToSpend(toDateIso(new Date(now)), now);

  const display: DisplayField[] = [
    { key: "per_day", value: formatCentavos(result.perDay), kind: "amount" },
    { key: "headroom", value: formatCentavos(result.headroom), kind: "amount" },
    { key: "days_remaining", value: String(result.daysRemaining), kind: "count" },
  ];

  // Only present when the user is actually over, and always labelled as the
  // whole-period figure it is.
  if (result.overBy > 0) {
    display.push({ key: "over_by", value: formatCentavos(result.overBy), kind: "amount" });
  }
  if (result.periodEnd !== null) {
    display.push({ key: "period_end", value: result.periodEnd, kind: "date" });
  }
  if (result.reviewQueueCount > 0) {
    // Rule 12's "not yet counted" disclosure: the answer is incomplete and the
    // model needs to be able to say so.
    display.push({
      key: "unreviewed_count",
      value: String(result.reviewQueueCount),
      kind: "count",
    });
  }

  return ok(
    TOOL,
    {
      state: result.state,
      // User-authored, so it goes through the same truncation as any free text.
      drivingFilterLabel:
        result.drivingFilterLabel === null ? null : safeText(result.drivingFilterLabel),
    },
    display,
  );
}
