// lib/transactions/manual_entry.ts — the defaults behind m1c plan Task 8's
// rule 3, as pure functions.
//
// They live here rather than inline in the form because each one decides WHERE
// THE USER'S MONEY LANDS, and two of them fail silently:
//
//   THE WALLET. Cash written into a bank wallet corrupts both — the bank's
//   balance stops matching the bank, and the cash actually spent is never
//   counted against the user's pocket. Nothing errors, and both totals look
//   perfectly plausible afterwards.
//
//   THE DATE. A future-dated entry is money that has not moved yet counted in
//   this period's spend, which spec rule 24 forbids outright.
//
// No clock is read here — `occurredAtFor` takes `now`, so every default is
// reproducible in a test rather than depending on when it ran.
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";

import type { EpochMs, Transaction, Wallet } from "@/types/domain";
import { isManualOnly } from "@/lib/wallets/summary";

/**
 * The cash wallet the ledger touched most recently, or `null` when there is no
 * safe answer.
 *
 * `null` is a real answer, not a failure: the form hangs its
 * create-a-cash-wallet prompt and its "which pocket?" question off it. Handing
 * back a bank wallet "so the form has something" is exactly the corruption this
 * function exists to prevent.
 *
 * Two nulls, for two different reasons:
 *   - no cash wallet exists at all -> the form offers to create one
 *   - two cash wallets and no history -> a coin flip whose loser is a real
 *     wallet with a now-wrong balance, so the form asks instead
 *
 * Archived wallets are excluded from BOTH the candidate list and the ledger
 * scan. The archive spec hides them from every picker, so defaulting to one
 * would name a wallet the picker itself will not offer.
 */
export function lastUsedCashWallet(wallets: Wallet[], ledger: Transaction[]): Wallet | null {
  const cash = wallets.filter((w) => isManualOnly(w) && !w.isArchived);
  if (cash.length === 0) return null;

  const byId = new Map(cash.map((w) => [w.id, w]));

  // Sorted, not scanned in the caller's order: `find` over whatever order the
  // ledger arrived in picks the wrong wallet on exactly the days it matters.
  // `createdAt` breaks a same-instant tie on the later write, so two entries
  // sharing a timestamp still have a defined winner.
  const mostRecent = [...ledger]
    .filter((row) => byId.has(row.walletId))
    .sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt)[0];

  if (mostRecent !== undefined) return byId.get(mostRecent.walletId) ?? null;

  // No cash history. One pocket is unambiguous; more than one is a question.
  return cash.length === 1 ? (cash[0] as Wallet) : null;
}

/** Folded the same way `categorizer.ts` folds a merchant, so the two agree. */
function foldMerchant(merchant: string | null | undefined): string {
  return (merchant ?? "").trim().toLowerCase();
}

/**
 * The category this merchant last landed in, or `UNCATEGORIZED_ID`.
 *
 * A BLANK merchant is no evidence and returns Uncategorized — deliberately not
 * "the last category used at all". Inheriting the previous entry's category
 * would file a jeepney fare under groceries because groceries happened to be
 * typed first, and the user would have to notice and undo it every time.
 */
export function categoryForMerchant(
  ledger: Transaction[],
  merchant: string | null | undefined,
): string {
  const wanted = foldMerchant(merchant);
  if (wanted === "") return UNCATEGORIZED_ID;

  const mostRecent = [...ledger]
    .filter((row) => row.merchant !== null && foldMerchant(row.merchant) === wanted)
    .sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt)[0];

  return mostRecent?.categoryId ?? UNCATEGORIZED_ID;
}

/** `'YYYY-MM-DD'` -> the local calendar day it names, or `null` if it names none. */
function parseLocalDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);

  const parsed = new Date(year, month - 1, date, 0, 0, 0, 0);

  // `new Date(2026, 1, 30)` rolls silently into March — the one bad date that
  // parses without complaint. Reading the fields back is the only way to catch
  // it, so a 30th of February is rejected rather than becoming the 2nd of March.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== date
  ) {
    return null;
  }

  return parsed;
}

/**
 * When a manual entry happened, from the day the user picked.
 *
 * TODAY KEEPS THE ACTUAL MOMENT rather than snapping to midnight, so an entry
 * typed at 9pm sorts after the morning's instead of jumping to the top of
 * today's group as though it happened first.
 *
 * A past day lands at the start of that LOCAL day — the ledger groups by local
 * calendar day (`day_group_header`), and a UTC midnight is the previous day for
 * every Philippine morning.
 *
 * A future day returns `null`. Spec rule 24: a manual transaction "is never
 * future-dated", because money that has not moved yet must not be counted
 * against this period's spend.
 */
export function occurredAtFor(day: string, now: EpochMs): EpochMs | null {
  const parsed = parseLocalDay(day);
  if (parsed === null) return null;

  const startOfPickedDay = parsed.getTime();

  const today = new Date(now);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();

  if (startOfPickedDay > startOfToday) return null;
  return startOfPickedDay === startOfToday ? now : startOfPickedDay;
}
