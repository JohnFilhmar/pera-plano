// lib/limits/__tests__/limit_rollover_wiring.test.ts — the user-visible
// consequence of the missing subscriber, pinned on its own.
//
// WHY THIS FILE EXISTS SEPARATELY FROM limit_service.test.ts. That file already
// proves carryover arithmetic by calling `recomputeLimits` by hand. It stayed
// green for the entire period in which `recomputeLimits` HAD NO PRODUCTION
// CALLER — which is precisely the shape of the defect:
//
//   recomputeLimits is the only path that calls setLimitAlertState
//     -> getLimitAlertState answers null forever
//     -> `existing !== null && existing.periodStart === previous.start`
//        (limit_service.ts:134) is always false
//     -> carriesForward is always false
//     -> CARRYOVER IS PERMANENTLY ZERO
//
// So a user who enabled rollover silently never received carried headroom, and
// every unit test in the feature agreed nothing was wrong. The assertion below
// is deliberately driven through the LEDGER EVENT rather than a direct call:
// nothing here would fail if `startLimitLedgerSubscriber` were deleted from the
// app and its own unit tests kept passing, unless the event is the trigger.
//
// Real migrations, real repos, real engine — only the notification stack is
// mocked, because `expo-notifications` cannot be required under Jest at all.
jest.mock("@/lib/alerts/alerts_service", () => ({
  postAlert: jest.fn().mockResolvedValue("os-id"),
  scheduleReminder: jest.fn(),
  cancelScheduled: jest.fn().mockResolvedValue(undefined),
}));

import { closeDatabase } from "@/lib/db/database";
import type { SQLiteDatabase } from "@/lib/db/database";
import { createLimit, getLimitAlertState } from "@/lib/db/repos/limits_repo";
import { emitAppEvent } from "@/lib/events/app_events";
import { newId } from "@/lib/ids";
import { freshDb } from "@/test_support/db";

import { startLimitLedgerSubscriber } from "../limit_ledger_subscriber";

const ms = (y: number, m: number, d: number, hh = 12) => new Date(y, m, d, hh).getTime();

/** Long enough to be deterministic, short enough not to slow the suite. */
const DEBOUNCE_MS = 20;
const settle = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 6));

let db: SQLiteDatabase;
let nowSpy: jest.SpyInstance<number, []>;
let stopSubscriber: () => void;

async function seedTx(args: { amount: number; occurredAt: number }): Promise<void> {
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at,
       merchant, counterparty, reference_no, source, confidence, raw_notification_id,
       transfer_link_id, note, created_at, updated_at)
     VALUES (?, 'w1', 'food', ?, 'out', ?, NULL, NULL, NULL, 'manual', 1, NULL, NULL, NULL, ?, ?)`,
    [newId(), args.amount, args.occurredAt, args.occurredAt, args.occurredAt],
  );
}

/** A ledger commit at a given instant, exactly as the ingest pipeline announces one. */
async function commitAt(instant: number): Promise<void> {
  nowSpy.mockReturnValue(instant);
  await emitAppEvent("ledger:committed", { transactionId: newId() });
  await settle();
}

beforeEach(async () => {
  db = await freshDb();
  jest.clearAllMocks();
  // The subscriber reads `systemClock.now()` at the composition edge, which is
  // the only place in this stack that touches real time. Pinning `Date.now`
  // lets a month boundary be crossed inside one test.
  nowSpy = jest.spyOn(Date, "now");
  await db.runAsync(
    `INSERT INTO wallets (id, name, balance, currency, is_archived, created_at, updated_at)
     VALUES ('w1', 'wallet', 0, 'PHP', 0, 0, 0)`,
  );
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES ('food', 'Food', NULL, 'circle', 0, 0, 0, 0)`,
  );
  stopSubscriber = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });
});

afterEach(async () => {
  stopSubscriber();
  nowSpy.mockRestore();
  await closeDatabase();
});

test("A ROLLOVER LIMIT CROSSING A PERIOD BOUNDARY RECEIVES ITS CARRYOVER", async () => {
  // Limits rule 14: unspent headroom from period N−1 carries into period N.
  // ₱10,000 limit, ₱4,000 spent in July -> ₱6,000 carried into August.
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 1_000_000,
    rollover: true,
  });

  await seedTx({ amount: 400_000, occurredAt: ms(2026, 6, 5) });
  await commitAt(ms(2026, 6, 5));

  // July's state has to be on disk for August to have a period to carry FROM —
  // and it only gets there because a commit ran a recompute. This is the exact
  // link that was missing.
  const july = await getLimitAlertState(limit.id);
  expect(july?.periodStart).toBe(ms(2026, 6, 1, 0));

  await commitAt(ms(2026, 7, 2));

  const august = await getLimitAlertState(limit.id);
  expect(august?.periodStart).toBe(ms(2026, 7, 1, 0));
  expect(august?.carryover).toBe(600_000);
});

test("carryover stays zero when the user has not enabled rollover", async () => {
  // The control for the test above: without it, a subscriber that wrote a
  // constant would pass just as well.
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 1_000_000,
    rollover: false,
  });

  await seedTx({ amount: 400_000, occurredAt: ms(2026, 6, 5) });
  await commitAt(ms(2026, 6, 5));
  await commitAt(ms(2026, 7, 2));

  expect((await getLimitAlertState(limit.id))?.carryover).toBe(0);
});

test("A COMMIT LATCHES THE THRESHOLDS THAT FIRED", async () => {
  // The second consequence of the dead subscriber: `fired: []` was never
  // persisted either, so a threshold could re-announce itself on every pass
  // once anything did start calling recompute.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1_000_000 });

  await seedTx({ amount: 500_000, occurredAt: ms(2026, 6, 5) });
  await commitAt(ms(2026, 6, 6));

  expect((await getLimitAlertState(limit.id))?.fired).toEqual([50]);
});
