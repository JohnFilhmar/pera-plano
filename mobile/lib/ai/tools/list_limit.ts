// mobile/lib/ai/tools/list_limit.ts
//
// HOW MANY ROWS `list_transactions` MAY RETURN, in a module that imports
// nothing. The schema, the real handler and the eval's fixture handler all need
// these bounds, and taking them from the handler would bring its database
// imports along with them.

export const LIMIT_MIN = 1;
export const LIMIT_MAX = 20;
const LIMIT_DEFAULT = 5;

/**
 * Clamps a requested row count into 1..20.
 *
 * @param raw - The model's `limit` argument, of any type.
 * @returns A whole number from 1 to 20. A non-number or NaN gives 5, and an
 *   out-of-range number lands on the nearer bound.
 */
export function clampLimit(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.floor(parsed)));
}
