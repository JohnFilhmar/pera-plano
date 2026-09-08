// lib/limits/__tests__/limit_write_serialisation.test.ts — GAP-098.
//
// SEPARATE FROM limit_service.test.ts ON PURPOSE. That file's header says
// "NOTHING IS MOCKED HERE" and that is worth keeping true. These cases need one
// seam faked — a `sumSpend` that can be held open — so a ledger pass can be
// parked between its READ of a limit's alert state and its WRITE of it. The
// unit under test, `limit_service`, is NOT mocked; the assertions are a
// subsequent read of the persisted row, or the alerts the pass itself returned,
// never a spy call count.
//
// WHAT THE RACE IS. All three writers of the alert state — `recomputeLimits`,
// `muteLimitForPeriod` and `refreshLimitBase` — read the whole object, await at
// least one more SQL query, then write the whole object back. Nothing ordered
// those sections, so a mute tapped while a pass sits inside `sumSpend` was
// persisted and then overwritten by that pass's older, unmuted copy: limits
// rule 25 says the mute lasts "until the next period boundary", and the user
// got the alert they had just silenced. Rule 11's immediate base re-snapshot
// was lost through exactly the same window.
import { closeDatabase } from "@/lib/db/database";
import type { SQLiteDatabase } from "@/lib/db/database";
import { createLimit, getLimitAlertState, updateLimit } from "@/lib/db/repos/limits_repo";
import { newId } from "@/lib/ids";
import { freshDb } from "@/test_support/db";

import {
  muteLimitForPeriod,
  recomputeLimits,
  refreshLimitBase,
} from "../limit_service";
import { pendingLimitWriteLocks, withLimitWriteLock } from "../limit_write_queue";

/**
 * The gate the fake `sumSpend` waits on. It has to be declared out here so the
 * tests can open and close it, and it has to be named `mock*` so Jest's factory
 * hoisting allows the reference.
 */
const mock_sum_spend_gate: { hold: Promise<void> | null } = { hold: null };

jest.mock("@/lib/db/repos/transactions_repo", () => {
  const actual = jest.requireActual(
    "@/lib/db/repos/transactions_repo",
  ) as typeof import("@/lib/db/repos/transactions_repo");

  return {
    ...actual,
    // Still the REAL sum — the arithmetic under test must not move. All this
    // adds is a place to stop, once, on request.
    sumSpend: async (args: Parameters<typeof actual.sumSpend>[0]) => {
      const total = await actual.sumSpend(args);
      const held = mock_sum_spend_gate.hold;
      if (held !== null) {
        mock_sum_spend_gate.hold = null;
        await held;
      }
      return total;
    },
  };
});

const ms = (y: number, m: number, d: number, hh = 12) => new Date(y, m, d, hh).getTime();

let db: SQLiteDatabase;

async function seedWallet(id: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO wallets (id, name, balance, currency, is_archived, created_at, updated_at)
     VALUES (?, ?, 0, 'PHP', 0, 0, 0)`,
    [id, `wallet-${id}`],
  );
}

async function seedCategory(id: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, NULL, 'circle', 0, 0, 0, 0)`,
    [id, `cat-${id}`],
  );
}

async function seedTx(args: { amount: number; occurredAt: number }): Promise<void> {
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at,
       merchant, counterparty, reference_no, source, confidence, raw_notification_id,
       transfer_link_id, note, created_at, updated_at)
     VALUES (?, 'w1', 'food', ?, 'out', ?, NULL, NULL, NULL, 'manual', 1, NULL, NULL, NULL, ?, ?)`,
    [newId(), args.amount, args.occurredAt, args.occurredAt, args.occurredAt],
  );
}

/**
 * Parks the NEXT `sumSpend` call until the returned function is called. One
 * shot: the call after it runs straight through, so a pass stops exactly once
 * and the test controls where.
 */
function holdNextSumSpend(): () => void {
  let release: () => void = () => undefined;
  mock_sum_spend_gate.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

/**
 * Lets every already-runnable continuation finish. A macrotask turn drains the
 * whole microtask queue behind it, and every query in this suite is backed by
 * synchronous sql.js, so one turn is enough to run an un-gated caller to
 * completion.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  db = await freshDb();
  mock_sum_spend_gate.hold = null;
  await seedWallet("w1");
  await seedCategory("food");
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The two UI writes, against a pass parked between its read and its write
// ---------------------------------------------------------------------------

test("a mute tapped while a ledger pass is mid-flight survives that pass's write", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ amount: 500000, occurredAt: ms(2026, 7, 5) });
  const now = ms(2026, 7, 10);

  // A first pass so the state exists and belongs to this period: what follows
  // must exercise the steady-state read-modify-write, not a period roll.
  await recomputeLimits({ now, monthlyIncome: null });

  const release = holdNextSumSpend();
  const pass = recomputeLimits({ now, monthlyIncome: null });
  await settle(); // the pass is now inside sumSpend, holding its stale copy

  const mute = muteLimitForPeriod(limit.id, now, null);
  await settle(); // unserialised, this is where the mute lands and is lost

  release();
  await pass;
  await mute;

  expect((await getLimitAlertState(limit.id))?.muted).toBe(true);
});

test("a base re-snapshot taken while a ledger pass is mid-flight survives that pass's write", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ amount: 100000, occurredAt: ms(2026, 7, 5) });
  const now = ms(2026, 7, 10);

  await recomputeLimits({ now, monthlyIncome: null });

  const release = holdNextSumSpend();
  const pass = recomputeLimits({ now, monthlyIncome: null });
  await settle();

  // Rule 11's manual-edit exception, exactly as `useUpdateLimit` performs it.
  await updateLimit(limit.id, { value: 2000000 });
  const refresh = refreshLimitBase(limit.id, now, null);
  await settle();

  release();
  await pass;
  await refresh;

  expect((await getLimitAlertState(limit.id))?.base).toBe(2000000);
});

// ---------------------------------------------------------------------------
// Two passes over the same limit (limits rule 19)
// ---------------------------------------------------------------------------

test("two overlapping passes fire one threshold between them, not one each", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ amount: 500000, occurredAt: ms(2026, 7, 5) });
  const now = ms(2026, 7, 10);

  const release = holdNextSumSpend();
  const first = recomputeLimits({ now, monthlyIncome: null });
  await settle();

  const second = recomputeLimits({ now, monthlyIncome: null });
  await settle();

  release();
  const posted = [...(await first), ...(await second)];

  // Rule 19: "Each threshold fires at most once per period."
  expect(posted).toHaveLength(1);
  expect(posted[0]?.threshold).toBe(50);
  expect((await getLimitAlertState(limit.id))?.fired).toEqual([50]);
});

// ---------------------------------------------------------------------------
// The queue itself
// ---------------------------------------------------------------------------

test("sections on one limit run in the order they were queued, and different limits do not wait", async () => {
  const order: string[] = [];
  const later = (label: string, turns: number) =>
    withLimitWriteLock(label.startsWith("a") ? "limit-a" : "limit-b", async () => {
      for (let i = 0; i < turns; i += 1) await settle();
      order.push(label);
    });

  // `a1` is deliberately the slowest: if the queue ordered by completion rather
  // than by arrival, `a2` would land first.
  const a1 = later("a1", 3);
  const a2 = later("a2", 0);
  const b1 = later("b1", 0);
  await Promise.all([a1, a2, b1]);

  expect(order.indexOf("a1")).toBeLessThan(order.indexOf("a2"));
  // b1 queued last and waited on nothing, so it finished before a1 ever did.
  expect(order[0]).toBe("b1");
});

test("a rejected section reaches its own caller and does not poison the ones behind it", async () => {
  const run: string[] = [];

  const failed = withLimitWriteLock("limit-c", async () => {
    run.push("first");
    throw new Error("write failed");
  });
  const after = withLimitWriteLock("limit-c", async () => {
    run.push("second");
    return "ok";
  });

  await expect(failed).rejects.toThrow("write failed");
  await expect(after).resolves.toBe("ok");
  expect(run).toEqual(["first", "second"]);
});

test("the chain map holds only limits with work in flight, and empties when they drain", async () => {
  await settle(); // every earlier test in this file wrote through the queue too
  expect(pendingLimitWriteLocks()).toBe(0);

  const held = withLimitWriteLock("limit-d", () => settle());
  const queued = withLimitWriteLock("limit-d", () => settle());
  const other = withLimitWriteLock("limit-e", () => settle());

  // Two limits in flight, not three sections: the chain is per limit.
  expect(pendingLimitWriteLocks()).toBe(2);

  await Promise.all([held, queued, other]);
  await settle();

  expect(pendingLimitWriteLocks()).toBe(0);
});
