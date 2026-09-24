// lib/income/paydays.ts — one payday, however many credits it arrived in.
//
// A PAYDAY IS A LOCAL DATE, NOT A TRANSACTION. Employers in this market split a
// single pay packet into two deposits often enough that it has to be ordinary,
// and every rule the app writes about a payday is written per payday rather
// than per credit: goals rule 13 computes a percent contribution "from the sum
// of income Transactions detected on that payday date", rule 14 creates ONE
// planned contribution per payday trigger, and income rule 11 announces ONE
// prompt for the pay that arrived. Screening each credit on its own turns a
// half into a payday of its own — twice the prompts, or, when a half falls out
// of rule 11's ±30% band, none at all.
//
// LOCAL DAY, NEVER UTC. The key comes from `toDateIso` (lib/dates.ts), which
// reads the wall calendar. Manila is eight hours ahead, so a UTC key files
// every credit before 8am under the previous day — which would split the very
// paydays this module exists to join, and only for the users who are paid in
// the morning.
//
// ITS OWN MODULE, imported by both `income_service.ts` (the payday prompt) and
// `safe_to_spend_service.ts` (rule 6's contributions forecast). Those two must
// agree about what one payday is or Safe-to-Spend reserves money for a transfer
// the prompt never asks the user to make, which is the failure GAP-106 fixed on
// the forecast side. One collapse, one answer.
import { toDateIso } from "@/lib/dates";
import type { Centavos, IsoDate } from "@/types/domain";

import type { CandidateEvent } from "./candidates";

export type Payday = {
  /** The local calendar day the pay landed on. */
  date: IsoDate;
  /** Every credit that landed on `date`, oldest first. Never empty. */
  credits: CandidateEvent[];
  /** What the day's credits come to together. */
  amount: Centavos;
};

/**
 * The pay events grouped into paydays, oldest day first.
 *
 * KEYED RATHER THAN RUN-LENGTH GROUPED, and sorted on the way out, so the
 * answer is the same whatever order the caller's events arrive in. A caller
 * that reads a repository directly cannot always promise chronological input,
 * and a grouping that silently depended on it would produce two paydays for one
 * day the first time an unsorted list reached it.
 */
export function collapsePaydays(events: CandidateEvent[]): Payday[] {
  const byDate = new Map<IsoDate, CandidateEvent[]>();

  for (const event of events) {
    const date = toDateIso(new Date(event.occurredAt));
    const credits = byDate.get(date);
    if (credits === undefined) byDate.set(date, [event]);
    else credits.push(event);
  }

  return Array.from(byDate, ([date, credits]) => {
    const ordered = [...credits].sort((a, b) => a.occurredAt - b.occurredAt);
    return {
      date,
      credits: ordered,
      amount: ordered.reduce((total, credit) => total + credit.amount, 0),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
