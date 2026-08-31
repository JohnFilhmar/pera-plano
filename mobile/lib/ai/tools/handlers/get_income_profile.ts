// mobile/lib/ai/tools/handlers/get_income_profile.ts
//
// A NULL HERE IS A LEGITIMATE ANSWER, NOT A BUG. `averageAmount` and
// `monthlyEquivalent` are `Centavos | null`, and null means "we have not
// detected your income yet" — a true statement about a real state.
//
// `formatCentavos(null as any)` renders "₱NaN.NaN", which grounds against
// nothing: the grounding check compares the model's prose against the display
// corpus verbatim, so a NaN in the corpus would license a NaN in the answer.
// The refusal path exists to keep that string out of the corpus entirely.
import { formatCentavos } from "@/components/ui/amount_text";
import { toDateIso } from "@/lib/dates";
import { isDatabaseUnlocked } from "@/lib/db/database";
import { getIncomeSummary } from "@/lib/income/income_service";
import type { EpochMs } from "@/types/domain";
import { empty, locked, ok, type DisplayField, type ToolResult } from "../types";

const TOOL = "get_income_profile";

export type IncomeProfileData = {
  cadence: string | null;
  status: string;
  isManualOverride: boolean;
};

export async function handleGetIncomeProfile(
  _args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<IncomeProfileData>> {
  if (!isDatabaseUnlocked()) return locked(TOOL);

  const summary = await getIncomeSummary(now);

  // Nothing detected yet. Refusing is more useful than a result with no
  // figures in it, because the model can say WHY there is no answer.
  if (summary.monthlyEquivalent === null && summary.averageAmount === null) {
    return empty(
      TOOL,
      "No income has been detected yet, so there is no income profile to report.",
    );
  }

  const display: DisplayField[] = [];
  if (summary.averageAmount !== null) {
    display.push({
      key: "average_amount",
      value: formatCentavos(summary.averageAmount),
      kind: "amount",
    });
  }
  if (summary.monthlyEquivalent !== null) {
    display.push({
      key: "monthly_equivalent",
      value: formatCentavos(summary.monthlyEquivalent),
      kind: "amount",
    });
  }
  if (summary.expectedNextAt !== null) {
    display.push({
      key: "expected_next",
      value: toDateIso(new Date(summary.expectedNextAt)),
      kind: "date",
    });
  }

  return ok(
    TOOL,
    {
      cadence: summary.cadence,
      status: summary.status,
      isManualOverride: summary.isManualOverride,
    },
    display,
  );
}
