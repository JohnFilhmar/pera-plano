// lib/limits/limit_label.ts — what to call a Limit (m2 Task 8).
//
// THE `limits` TABLE HAS NO NAME COLUMN. Nothing in docs/02-domain-model.md
// §3.5 or the create flow (limits spec steps 1-7) asks the user to name one —
// they choose a scope, a basis, and optional filters, and the review summary in
// step 6 reads "₱8,000.00 monthly, Food & Dining, rollover on". So a limit's
// name is DERIVED from what it caps, and it has to be derived the same way
// everywhere: the Plan tab's card, the detail header and the notification body
// naming three different things for one limit is how a user ends up unsure
// which cap they just breached.
//
// ONE FUNCTION, TWO CALLERS WITH DIFFERENT KNOWLEDGE. `limit_service`'s alert
// path has no category names to hand — it runs on a ledger commit, and loading
// the category table to phrase a notification would be a query per alert. It
// calls this with no map and gets the scope-only form. Screens already hold the
// categories for their pickers and pass them, getting the richer form. Same
// function, so the two can only differ in detail, never in wording.
import type { Limit } from "@/types/domain";

/** The fields a name is derived from — so callers can pass a partial row. */
export type LimitLabelInput = Pick<Limit, "scope" | "categoryFilter" | "walletFilter">;

const SCOPE_LABEL: Record<Limit["scope"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

/**
 * `"Monthly limit"` · `"Monthly limit · Food & Dining"` ·
 * `"Monthly limit · 2 categories"`.
 *
 * Names the CATEGORY filter and not the wallet one when both are present. A
 * limit is about what the money was spent on far more often than about which
 * card paid for it, and a label carrying both is longer than the card it sits
 * on. The detail screen states the full filter set.
 *
 * Falls back to a count past one name rather than joining them: two or three
 * category names run past the card's width, and a truncated list reads as if
 * the limit covers only the categories that happened to fit.
 */
export function limitDisplayName(
  limit: LimitLabelInput,
  categoryNames?: ReadonlyMap<string, string>,
): string {
  const base = `${SCOPE_LABEL[limit.scope]} limit`;
  const categories = limit.categoryFilter ?? [];

  if (categories.length === 0) {
    const wallets = limit.walletFilter ?? [];
    return wallets.length > 0 ? `${base} · ${countPhrase(wallets.length, "wallet")}` : base;
  }

  if (categories.length === 1) {
    const name = categoryNames?.get(categories[0]);
    // No map, or an id the map does not know (a category deleted since the
    // limit was made): fall back to the count rather than to the raw uuid.
    return `${base} · ${name ?? countPhrase(1, "category")}`;
  }

  return `${base} · ${countPhrase(categories.length, "category")}`;
}

/** "1 category" / "2 categories" / "1 wallet" / "3 wallets". */
function countPhrase(count: number, noun: "category" | "wallet"): string {
  if (count === 1) return `1 ${noun}`;
  return `${count} ${noun === "category" ? "categories" : "wallets"}`;
}
