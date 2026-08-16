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
 */
export function formatTime(at: EpochMs): string {
  const date = new Date(at);
  return clockLabel(date.getHours(), date.getMinutes());
}

/**
 * "9:00 PM" from 1260 — a wall-clock time held as MINUTES FROM MIDNIGHT
 * rather than as an instant.
 *
 * The quiet-hours window (IA §6.2 rule 7, stored by
 * `lib/db/repos/app_settings_repo.ts`) is the one setting in the app shaped
 * that way, because "21:00" has to keep meaning 9pm on whatever day it is
 * rather than freezing one particular evening — so it has no instant to hand
 * `formatTime`. Both go through the same twelve-hour rendering below so the
 * Settings screen and a transaction detail can never disagree about how a
 * time is spelled.
 */
export function formatMinuteOfDay(minuteOfDay: number): string {
  return clockLabel(Math.floor(minuteOfDay / 60), minuteOfDay % 60);
}

/**
 * Midnight and noon are the two hours that break a naive `% 12`: both come out
 * as `0`, which renders "0:05 AM". They are handled explicitly.
 */
function clockLabel(hours: number, minutes: number): string {
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** "Aug 11, 2026 at 2:05 PM" — the transaction detail's date-and-time field. */
export function formatDateTime(at: EpochMs): string {
  return `${formatDate(at)} at ${formatTime(at)}`;
}
