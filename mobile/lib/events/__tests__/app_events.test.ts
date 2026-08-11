// lib/events/__tests__/app_events.test.ts — the bus the ingest pipeline
// announces a commit on (plan Task 10 rule 7).
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
