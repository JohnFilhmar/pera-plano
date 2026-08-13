// lib/datetime.ts — the app's human-readable date and time strings.
//
// SPELLED OUT RATHER THAN TAKEN FROM `Intl`, for the same reason
// components/transactions/day_group_header.tsx spelled its month table out
// first: a header must read the same on every device and in every test locale.
// `toLocaleString` is a device-settings-dependent output — it varies by locale,
// by OEM, and between the Hermes and JSC builds of the same app — which makes
// it untestable and makes two screens disagree about the same instant.
//
// EVERYTHING HERE IS LOCAL TIME. `new Date(ms).toISOString()` is the tempting
// one-liner and it is wrong for every user of this app: 7am in Manila is still
// the previous day in UTC.
import type { EpochMs } from "@/types/domain";

/** Short month names. The one table in the app — see the file header. */
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Aug 11, 2026". The year is always present — see `dayLabel`. */
export function formatDate(at: EpochMs): string {
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * "2:05 PM" — twelve-hour, because that is how the Philippines reads a clock,
 * and because every provider notification this app parses is written that way.
 *
 * Midnight and noon are the two hours that break a naive `% 12`: both come out
 * as `0`, which renders "0:05 AM". They are handled explicitly.
 */
export function formatTime(at: EpochMs): string {
  const date = new Date(at);
  const hours = date.getHours();
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(date.getMinutes()).padStart(2, "0")} ${suffix}`;
}

/** "Aug 11, 2026 at 2:05 PM" — the transaction detail's date-and-time field. */
export function formatDateTime(at: EpochMs): string {
  return `${formatDate(at)} at ${formatTime(at)}`;
}
