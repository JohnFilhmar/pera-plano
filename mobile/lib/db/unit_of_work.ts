// lib/db/unit_of_work.ts — compose several repository writes into ONE SQL
// transaction (m1c Task 10 rule 2).
//
// WHAT THIS IS FOR. Each repository already keeps its own row and the state that
// row implies inseparable — `insertTransaction` writes the ledger row and moves
// the wallet balance together, `linkTransfer` writes the link and stamps both
// legs together. What no repository can do is make a write in ONE aggregate
// atomic with a write in another, and the Review Queue's triage actions need
// exactly that: a Transaction, a UserRule and a resolved queue item, all three
// or none of them.
//
// A partial success there is not a cosmetic bug. A committed Transaction with an
// unresolved queue item puts the same card back in front of the user; they
// confirm it again, and their ledger now holds one purchase twice.
//
// HOW IT WORKS. `SQLiteDatabase.withTransactionAsync` is re-entrant (see
// database.ts), so the repositories called inside `work` join this transaction
// instead of starting one of their own. Anything thrown inside rolls the whole
// thing back and propagates.
//
// NOT A REPOSITORY, AND IT ISSUES NO SQL. It only opens and closes the
// transaction the repositories then write inside — the "repositories own the
// SQL" rule stays intact.
import { getDatabase } from "@/lib/db/database";

/**
 * Runs `work` inside one SQL transaction and returns its value.
 *
 * The return value is why this exists rather than a bare
 * `db.withTransactionAsync` at each call site: that method resolves to `void`,
 * so every caller would otherwise hoist a `let` outside the closure and assert
 * it non-null afterwards — five copies of the same footgun in one file.
 */
export async function withUnitOfWork<T>(work: () => Promise<T>): Promise<T> {
  const db = await getDatabase();
  // `undefined` until `work` runs. Reachable as `undefined` only if
  // withTransactionAsync resolved WITHOUT running the body, which it never does
  // — anything the body throws is rethrown rather than swallowed.
  let result: T | undefined;
  await db.withTransactionAsync(async () => {
    result = await work();
  });
  return result as T;
}
