// lib/events/__tests__/app_events.test.ts — the bus the ingest pipeline
// announces a commit on (plan Task 10 rule 7), widened by m2 Task 1 with
// `ledger:changed` and `income:payday`.
import { emitAppEvent, onAppEvent } from "../app_events";

test("delivers payloads to subscribers and stops on unsubscribe", async () => {
  const seen: string[] = [];
  const off = onAppEvent("ledger:committed", (payload) => {
    seen.push(payload.transactionId);
  });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  off();
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });

  expect(seen).toEqual(["tx-1"]);
});

test("awaits async handlers in subscription order so recomputes are deterministic", async () => {
  const order: number[] = [];
  const first = onAppEvent("ledger:committed", async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(1);
  });
  const second = onAppEvent("ledger:committed", () => {
    order.push(2);
  });

  await emitAppEvent("ledger:committed", { transactionId: "tx-9" });

  // The slow handler finishes before the fast one starts: a limit recompute
  // that has not finished must not be racing the next subscriber's read.
  expect(order).toEqual([1, 2]);
  first();
  second();
});

test("one throwing handler does not stop the others", async () => {
  const seen: string[] = [];
  const thrower = onAppEvent("ledger:committed", () => {
    throw new Error("boom");
  });
  const survivor = onAppEvent("ledger:committed", (payload) => {
    seen.push(payload.transactionId);
  });

  // And the emit itself resolves: the pipeline commits the ledger row first and
  // announces it second, so a broken subscriber must never turn a completed
  // commit into a thrown capture.
  await expect(emitAppEvent("ledger:committed", { transactionId: "tx-3" })).resolves.toBeUndefined();
  expect(seen).toEqual(["tx-3"]);
  thrower();
  survivor();
});

test("unsubscribing twice is harmless and emitting with no subscribers is a no-op", async () => {
  const off = onAppEvent("ledger:committed", () => undefined);
  off();
  off();

  await expect(emitAppEvent("ledger:committed", { transactionId: "tx-4" })).resolves.toBeUndefined();
});

test("a handler that unsubscribes during an emit still lets the rest run", async () => {
  const seen: string[] = [];
  const first = onAppEvent("ledger:committed", () => {
    seen.push("first");
    first();
  });
  const second = onAppEvent("ledger:committed", () => {
    seen.push("second");
  });

  // Iterating the live Set while a handler mutates it is the classic way to
  // silently skip a subscriber; the snapshot in `emitAppEvent` is what stops it.
  await emitAppEvent("ledger:committed", { transactionId: "tx-5" });

  expect(seen).toEqual(["first", "second"]);
  second();
});

// ---------------------------------------------------------------------------
// The m2 Task 1 widening. `ledger:changed` fires on an edit, a delete, a
// recategorisation or a transfer link — anything that moves a row a limit total
// already counted. `income:payday` is what the goals sheet waits on.
// ---------------------------------------------------------------------------

test("ledger:changed carries the transaction that moved", async () => {
  const seen: string[] = [];
  const off = onAppEvent("ledger:changed", (payload) => {
    seen.push(payload.transactionId);
  });

  await emitAppEvent("ledger:changed", { transactionId: "tx-edited" });
  off();

  expect(seen).toEqual(["tx-edited"]);
});

test("income:payday carries the wallet, amount and instant, not just an id", async () => {
  // The only payload on the bus that is not purely identifiers: a payday
  // handler allocates against the amount that just landed, and re-deriving it
  // from the row would make the goals sheet depend on the transaction still
  // existing unchanged by the time the handler runs.
  const seen: unknown[] = [];
  const occurredAt = new Date(2026, 7, 15, 8, 0).getTime();
  const off = onAppEvent("income:payday", (payload) => {
    seen.push(payload);
  });

  await emitAppEvent("income:payday", {
    transactionIds: ["tx-9"],
    walletId: "w-1",
    amount: 1_850_000,
    occurredAt,
  });
  off();

  expect(seen).toEqual([
    { transactionIds: ["tx-9"], walletId: "w-1", amount: 1_850_000, occurredAt },
  ]);
});

test("income:payday names EVERY credit one payday arrived in", async () => {
  // A payday is a local date, not a transaction: an employer paying half in the
  // morning and half in the afternoon sends one payday in two credits, and
  // `amount` is what they come to together (goals rule 13's percent base is "the
  // sum of income Transactions detected on that payday date"). A single id could
  // only ever name one half of that sum.
  const seen: { transactionIds: string[]; amount: number }[] = [];
  const off = onAppEvent("income:payday", (payload) => {
    seen.push({ transactionIds: payload.transactionIds, amount: payload.amount });
  });

  await emitAppEvent("income:payday", {
    transactionIds: ["tx-half-1", "tx-half-2"],
    walletId: "w-1",
    amount: 1_850_000,
    occurredAt: new Date(2026, 7, 15, 16, 0).getTime(),
  });
  off();

  expect(seen).toEqual([{ transactionIds: ["tx-half-1", "tx-half-2"], amount: 1_850_000 }]);
});

test("the three events are delivered independently of one another", async () => {
  // A registry that collapsed into one handler list — or a widening that reused
  // the committed key for changes — would fan every emit out to all three, and
  // a limit engine would recompute on a payday it has no interest in.
  const committed: string[] = [];
  const changed: string[] = [];
  const payday: string[] = [];

  const offCommitted = onAppEvent("ledger:committed", (p) => {
    committed.push(p.transactionId);
  });
  const offChanged = onAppEvent("ledger:changed", (p) => {
    changed.push(p.transactionId);
  });
  const offPayday = onAppEvent("income:payday", (p) => {
    payday.push(...p.transactionIds);
  });

  await emitAppEvent("ledger:changed", { transactionId: "tx-a" });
  await emitAppEvent("income:payday", {
    transactionIds: ["tx-b"],
    walletId: "w-1",
    amount: 100,
    occurredAt: new Date(2026, 7, 15, 8, 0).getTime(),
  });

  expect(committed).toEqual([]);
  expect(changed).toEqual(["tx-a"]);
  expect(payday).toEqual(["tx-b"]);

  offCommitted();
  offChanged();
  offPayday();
});

test("unsubscribing from one event leaves the others subscribed", async () => {
  const changed: string[] = [];
  const payday: string[] = [];

  const offChanged = onAppEvent("ledger:changed", (p) => {
    changed.push(p.transactionId);
  });
  const offPayday = onAppEvent("income:payday", (p) => {
    payday.push(...p.transactionIds);
  });

  offChanged();

  await emitAppEvent("ledger:changed", { transactionId: "tx-c" });
  await emitAppEvent("income:payday", {
    transactionIds: ["tx-d"],
    walletId: "w-1",
    amount: 100,
    occurredAt: new Date(2026, 7, 15, 8, 0).getTime(),
  });

  expect(changed).toEqual([]);
  expect(payday).toEqual(["tx-d"]);
  offPayday();
});

test("a throwing ledger:changed handler does not stop the rest", async () => {
  const seen: string[] = [];
  const thrower = onAppEvent("ledger:changed", () => {
    throw new Error("boom");
  });
  const survivor = onAppEvent("ledger:changed", (p) => {
    seen.push(p.transactionId);
  });

  await expect(emitAppEvent("ledger:changed", { transactionId: "tx-e" })).resolves.toBeUndefined();

  expect(seen).toEqual(["tx-e"]);
  thrower();
  survivor();
});
