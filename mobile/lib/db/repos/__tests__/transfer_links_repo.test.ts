// lib/db/repos/__tests__/transfer_links_repo.test.ts — plan Task 10 Step 2.
//
// The property every one of these tests is really guarding is domain invariant
// I2 / plan rule 6: a linked pair leaves spend and income entirely, and the fee
// is informational only — it is never counted anywhere, ever.
import { closeDatabase } from "@/lib/db/database";
import { createWallet } from "../wallets_repo";
import { getTransferLink, linkTransfer, unlinkTransfer } from "../transfer_links_repo";
import { freshDb } from "@/test_support/db";
import { insertTransaction, sumSpend } from "../transactions_repo";
import type { SQLiteDatabase } from "@/lib/db/database";
import type { Transaction } from "@/types/domain";

const NOW = 1_786_000_000_000;
const HOUR = 60 * 60 * 1000;
const CATEGORY_ID = "cat_transfer";

let db: SQLiteDatabase;
let sending: string;
let receiving: string;

async function leg(
  walletId: string,
  direction: "in" | "out",
  amount: number,
): Promise<Transaction> {
  return insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount,
    direction,
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });
}

beforeEach(async () => {
  db = await freshDb();
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, 'Uncategorized', NULL, 'circle-help', 1, 0, 0, 0)`,
    [CATEGORY_ID],
  );
  sending = (await createWallet({ name: "BPI", type: "bank", openingBalance: 500000 })).id;
  receiving = (await createWallet({ name: "GCash", type: "e-wallet" })).id;
});

afterEach(async () => {
  await closeDatabase();
});

test("linkTransfer records the link and stamps both legs", async () => {
  const out = await leg(sending, "out", 100000);
  const incoming = await leg(receiving, "in", 100000);

  const link = await linkTransfer(out.id, incoming.id, 0);

  expect(link.outTransactionId).toBe(out.id);
  expect(link.inTransactionId).toBe(incoming.id);
  expect(link.feeAmount).toBe(0);
  expect(await getTransferLink(link.id)).toEqual(link);

  // Both directions of the relationship (domain §3.3 "referenced from both
  // directions"). Without the leg stamp every total below still counts them.
  const legs = await db.getAllAsync<{ transfer_link_id: string | null }>(
    "SELECT transfer_link_id FROM transactions ORDER BY direction",
  );
  expect(legs.map((row) => row.transfer_link_id)).toEqual([link.id, link.id]);
});

test("a linked pair leaves sumSpend, and its fee is never counted anywhere", async () => {
  const out = await leg(sending, "out", 100000);
  const incoming = await leg(receiving, "in", 97500);

  const before = await sumSpend({ from: NOW - 2 * HOUR, to: NOW });
  expect(before).toBe(100000);

  const link = await linkTransfer(out.id, incoming.id, out.amount - incoming.amount);

  expect(link.feeAmount).toBe(2500);
  // The whole point of plan rule 6: the ₱25.00 rail fee is real money and is
  // shown on the link, but it must never turn up in a spend total — not as its
  // own row, and not as a residue of the out-leg.
  expect(await sumSpend({ from: NOW - 2 * HOUR, to: NOW })).toBe(0);
  const rows = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM transactions",
  );
  expect(rows?.count).toBe(2);
});

test("a link defaults to an active, manual, fully confident pairing", async () => {
  const out = await leg(sending, "out", 100000);
  const incoming = await leg(receiving, "in", 100000);

  const link = await linkTransfer(out.id, incoming.id, 0);

  // The schema's own defaults (001_core.sql:76): a link created with nothing
  // said about it is one the user made by hand.
  expect(link.status).toBe("active");
  expect(link.detectedBy).toBe("manual");
  expect(link.confidence).toBe(1);
});

test("an auto-detected link carries detectedBy auto and the detector's confidence", async () => {
  const out = await leg(sending, "out", 100000);
  const incoming = await leg(receiving, "in", 100000);

  const link = await linkTransfer(out.id, incoming.id, 0, {
    detectedBy: "auto",
    confidence: 0.95,
  });

  expect(link.detectedBy).toBe("auto");
  expect(link.confidence).toBe(0.95);
  expect((await getTransferLink(link.id))?.detectedBy).toBe("auto");
});

test("a negative fee — a credited bonus — round-trips intact", async () => {
  const out = await leg(sending, "out", 100000);
  const incoming = await leg(receiving, "in", 105000);

  const link = await linkTransfer(out.id, incoming.id, out.amount - incoming.amount);

  // domain §3.3: "a negative value indicates a credited bonus". Clamping it to
  // zero would silently discard the fact that the user gained ₱50.00.
  expect(link.feeAmount).toBe(-5000);
  expect((await getTransferLink(link.id))?.feeAmount).toBe(-5000);
});

test("unlinkTransfer dissolves the link and returns both legs to the totals", async () => {
  const out = await leg(sending, "out", 100000);
  const incoming = await leg(receiving, "in", 100000);
  const link = await linkTransfer(out.id, incoming.id, 0);

  await unlinkTransfer(link.id);

  expect(await sumSpend({ from: NOW - 2 * HOUR, to: NOW })).toBe(100000);
  // Dissolved, not deleted: the pairing is history the user may want to see,
  // and the two legs' FK references stay valid.
  expect((await getTransferLink(link.id))?.status).toBe("dissolved");
  const legs = await db.getAllAsync<{ transfer_link_id: string | null }>(
    "SELECT transfer_link_id FROM transactions",
  );
  expect(legs.every((row) => row.transfer_link_id === null)).toBe(true);
});

test("unlinking is idempotent and unknown ids read back as null", async () => {
  expect(await getTransferLink("no-such-link")).toBeNull();
  await expect(unlinkTransfer("no-such-link")).resolves.toBeUndefined();

  const out = await leg(sending, "out", 100000);
  const incoming = await leg(receiving, "in", 100000);
  const link = await linkTransfer(out.id, incoming.id, 0);

  await unlinkTransfer(link.id);
  await expect(unlinkTransfer(link.id)).resolves.toBeUndefined();
  expect((await getTransferLink(link.id))?.status).toBe("dissolved");
});
