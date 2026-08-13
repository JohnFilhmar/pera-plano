// components/transactions/day_group_header.tsx — m1c plan Task 6, rule 1.
//
// One heading per calendar day in the ledger, with THAT DAY'S NET beside it.
//
// THE NET IS SIGNED, AND THAT IS THE WHOLE POINT. `in` adds, `out` subtracts, so
// a day where ₱100 arrived and ₱100 left reads ₱0.00 — which is what actually
// happened. Summed without signs the same day reads ₱200.00, a gross-turnover
// figure that looks entirely plausible sitting above a list of real rows and is
// wrong on every mixed day the user has. The arithmetic itself lives in
// `dayNet` next door, beside the grouping it has to agree with.
//
// TRANSFER LEGS ARE NOT IN IT (invariant I2). A header that counted them would
// contradict the "Transfer — not counted as spending" label on the row directly
// beneath it, and the user would have to decide which of the two to believe.
//
// THE DAY KEY IS LOCAL, NOT UTC. `new Date(ms).toISOString().slice(0, 10)` is
// the tempting one-liner and it is wrong for every user of this app: 7am in
// Manila is still the previous day in UTC, so a morning coffee would file itself
// under yesterday and yesterday's net would move.
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
// Spelled out rather than taken from `Intl`, so a header reads the same on
// every device and in every test locale. It moved to lib/datetime.ts when the
// transaction detail screen (m1c Task 7) needed the same table: two month
// tables is how two screens end up disagreeing about the same instant.
import { MONTHS } from "@/lib/datetime";
import type { Centavos, EpochMs, IsoDate } from "@/types/domain";

/** Epoch milliseconds → the LOCAL calendar day as 'YYYY-MM-DD'. See the header. */
export function localDateKey(at: EpochMs): IsoDate {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * "Today", "Yesterday", or "Aug 11, 2026".
 *
 * The year is always present on an older day. A ledger is scrolled backwards
 * for months, and "Aug 11" alone stops being unambiguous the moment the user
 * passes a January.
 *
 * Yesterday is computed by stepping the CALENDAR back a day rather than
 * subtracting 86,400,000ms, so a DST boundary cannot land the label on the
 * wrong date. The Philippines has no DST, but the app is not the only place
 * this component will ever run.
 */
export function dayLabel(date: IsoDate, now: EpochMs): string {
  if (date === localDateKey(now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === localDateKey(yesterday.getTime())) return "Yesterday";

  const [year, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

export type DayGroupHeaderProps = {
  /** The group's LOCAL calendar day, 'YYYY-MM-DD'. */
  date: IsoDate;
  /** Signed, transfer legs already excluded — see `dayNet`. */
  net: Centavos;
  /**
   * The clock "Today" and "Yesterday" are measured against. Injected so a test
   * is not a function of the day it runs on; defaults to the real clock, which
   * is what every screen passes (nothing here is in `lib/ingest/`, where
   * `Date.now()` is banned outright).
   */
  now?: EpochMs;
  testID?: string;
};

export function DayGroupHeader({ date, net, now = Date.now(), testID }: DayGroupHeaderProps) {
  const id = testID ?? `day-group-${date}`;

  return (
    <View
      testID={id}
      className="flex-row items-center justify-between px-4 pb-2 pt-5"
    >
      <Text className="text-base font-semibold text-fg dark:text-fg-dark">
        {dayLabel(date, now)}
      </Text>
      <View className="flex-row items-baseline gap-2">
        {/* The word matters. A bare figure beside a date reads as a balance,
            and a balance is the one number this is not. */}
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Net</Text>
        <AmountText
          testID={`${id}-net`}
          amount={net}
          size="sm"
          // No direction, so `formatCentavos` signs the whole figure itself:
          // a spending day is "-₱100.00". Passing a direction would force a
          // `+`/`−` glyph onto a number that is already signed.
          showSign={false}
        />
      </View>
    </View>
  );
}
