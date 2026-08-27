import { closeDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { getTransferLink } from "@/lib/db/repos/transfer_links_repo";
import {
  attachCounterpartLeg,
  recordTransfer,
  TransferValidationError,
} from "@/lib/transfers/transfer_service";
import type { SQLiteDatabase } from "@/lib/db/database";

const NOW = 1_786_000_000_000;
const HOUR = 60 * 60 * 1000;

let db: SQLiteDatabase;
let bpi: string;
let gcash: string;

async function seedCategory(id: string, name: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, NULL, 'circle-help', 1, 0, 0, 0)`,
    [id, name],
  );
}

beforeEach(async () => {
  db = await freshDb();
  await seedCategory("cat_uncategorized", "Uncategorized");
  await seedCategory("cat_fees_charges", "Fees & Charges");
  bpi = (await createWallet({ name: "BPI", type: "bank", openingBalance: 500_000 })).id;
  gcash = (await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 0 })).id;
});

afterEach(async () => {
  await closeDatabase();
});

test("a fee-free transfer writes two equal legs and one link", async () => {
  const result = await recordTransfer(
    {
      fromWalletId: bpi,
      toWalletId: gcash,
      amount: 100_000,
      feeAmount: 0,
      occurredAt: NOW - HOUR,
      note: null,
    },
    NOW,
  );

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);
  expect(result.feeTransactionId).toBeNull();

  const out = rows.find((row) => row.id === result.outLegId);
  const incoming = rows.find((row) => row.id === result.inLegId);
  expect(out?.walletId).toBe(bpi);
  expect(out?.direction).toBe("out");
  expect(out?.amount).toBe(100_000);
  expect(incoming?.walletId).toBe(gcash);
  expect(incoming?.direction).toBe("in");
  expect(incoming?.amount).toBe(100_000);
  expect(out?.transferLinkId).toBe(result.transferLinkId);
  expect(incoming?.transferLinkId).toBe(result.transferLinkId);

  const link = await getTransferLink(result.transferLinkId);
  expect(link?.feeAmount).toBe(0);
  expect(link?.detectedBy).toBe("manual");
});

test("a fee becomes its own unlinked expense on the source wallet", async () => {
  const result = await recordTransfer(
    {
      fromWalletId: bpi,
      toWalletId: gcash,
      amount: 100_000,
      feeAmount: 1_500,
      occurredAt: NOW - HOUR,
      note: null,
    },
    NOW,
  );

  const rows = await listTransactions({});
  expect(rows).toHaveLength(3);

  const fee = rows.find((row) => row.id === result.feeTransactionId);
  expect(fee?.walletId).toBe(bpi);
  expect(fee?.direction).toBe("out");
  expect(fee?.amount).toBe(1_500);
  expect(fee?.categoryId).toBe("cat_fees_charges");
  expect(fee?.transferLinkId).toBeNull();

  // The legs are EQUAL and both are net of the fee.
  const out = rows.find((row) => row.id === result.outLegId);
  const incoming = rows.find((row) => row.id === result.inLegId);
  expect(out?.amount).toBe(98_500);
  expect(incoming?.amount).toBe(98_500);
});

test("balances match the providers' own figures", async () => {
  await recordTransfer(
    {
      fromWalletId: bpi,
      toWalletId: gcash,
      amount: 100_000,
      feeAmount: 1_500,
      occurredAt: NOW - HOUR,
      note: null,
    },
    NOW,
  );

  expect((await getWallet(bpi))?.balance).toBe(400_000);
  expect((await getWallet(gcash))?.balance).toBe(98_500);
});

test.each([
  ["same_wallet", { fromWalletId: "SAME", toWalletId: "SAME" }],
  ["amount_not_positive", { amount: 0 }],
  ["fee_negative", { feeAmount: -1 }],
  ["fee_exceeds_amount", { feeAmount: 100_000 }],
  ["future_dated", { occurredAt: NOW + HOUR }],
])("rejects %s before writing anything", async (reason, override) => {
  const draft = {
    fromWalletId: bpi,
    toWalletId: gcash,
    amount: 100_000,
    feeAmount: 0,
    occurredAt: NOW - HOUR,
    note: null,
    ...override,
  };
  if (draft.fromWalletId === "SAME") {
    draft.fromWalletId = bpi;
    draft.toWalletId = bpi;
  }

  await expect(recordTransfer(draft, NOW)).rejects.toBeInstanceOf(TransferValidationError);
  await expect(recordTransfer(draft, NOW)).rejects.toMatchObject({ reason });
  expect(await listTransactions({})).toHaveLength(0);
  expect((await getWallet(bpi))?.balance).toBe(500_000);
});

test("rejects an archived wallet", async () => {
  await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [gcash]);

  await expect(
    recordTransfer(
      {
        fromWalletId: bpi,
        toWalletId: gcash,
        amount: 100_000,
        feeAmount: 0,
        occurredAt: NOW - HOUR,
        note: null,
      },
      NOW,
    ),
  ).rejects.toMatchObject({ reason: "archived_wallet" });

  expect(await listTransactions({})).toHaveLength(0);
});

test("attaches a minted counterpart to a committed leg", async () => {
  const captured = await insertTransaction({
    walletId: gcash,
    categoryId: "cat_uncategorized",
    amount: 100_000,
    direction: "in",
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });

  const result = await attachCounterpartLeg(
    { captured: { existingLegId: captured.id }, counterpartWalletId: bpi, feeAmount: 0 },
    NOW,
  );

  expect(result.inLegId).toBe(captured.id);

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);

  const minted = rows.find((row) => row.id === result.outLegId);
  expect(minted?.walletId).toBe(bpi);
  expect(minted?.direction).toBe("out");
  expect(minted?.amount).toBe(100_000);
  expect(minted?.source).toBe("manual");
  expect(minted?.rawNotificationId).toBeNull();
  expect(minted?.occurredAt).toBe(captured.occurredAt);
  expect(minted?.transferLinkId).toBe(result.transferLinkId);
});

test("commits an uncommitted proposal and links it in one write", async () => {
  const result = await attachCounterpartLeg(
    {
      captured: {
        proposal: {
          walletId: bpi,
          categoryId: "cat_uncategorized",
          amount: 100_000,
          direction: "out",
          occurredAt: NOW - HOUR,
          source: "notification",
          confidence: 0.9,
        },
      },
      counterpartWalletId: gcash,
      feeAmount: 0,
    },
    NOW,
  );

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.transferLinkId === result.transferLinkId)).toBe(true);
});

test("puts the fee on the source wallet, whichever leg was captured", async () => {
  // The CAPTURED leg is the incoming one, so the source is the minted side.
  const captured = await insertTransaction({
    walletId: gcash,
    categoryId: "cat_uncategorized",
    amount: 98_500,
    direction: "in",
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });

  const result = await attachCounterpartLeg(
    { captured: { existingLegId: captured.id }, counterpartWalletId: bpi, feeAmount: 1_500 },
    NOW,
  );

  const rows = await listTransactions({});
  const fee = rows.find((row) => row.id === result.feeTransactionId);
  expect(fee?.walletId).toBe(bpi);
  expect(fee?.amount).toBe(1_500);
  expect(fee?.categoryId).toBe("cat_fees_charges");
  expect(fee?.transferLinkId).toBeNull();

  // The legs stay EQUAL — the captured amount is the provider's own figure and
  // is never rewritten.
  expect(rows.find((row) => row.id === result.outLegId)?.amount).toBe(98_500);
  expect(rows.find((row) => row.id === result.inLegId)?.amount).toBe(98_500);
});

test("refuses to attach a leg to its own wallet", async () => {
  const captured = await insertTransaction({
    walletId: gcash,
    categoryId: "cat_uncategorized",
    amount: 100_000,
    direction: "in",
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });

  await expect(
    attachCounterpartLeg(
      { captured: { existingLegId: captured.id }, counterpartWalletId: gcash, feeAmount: 0 },
      NOW,
    ),
  ).rejects.toMatchObject({ reason: "same_wallet" });

  expect(await listTransactions({})).toHaveLength(1);
});

test("rejects an unknown counterpart wallet without writing anything", async () => {
  const captured = await insertTransaction({
    walletId: gcash,
    categoryId: "cat_uncategorized",
    amount: 100_000,
    direction: "in",
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });

  await expect(
    attachCounterpartLeg(
      { captured: { existingLegId: captured.id }, counterpartWalletId: "no_such_wallet", feeAmount: 0 },
      NOW,
    ),
  ).rejects.toMatchObject({ reason: "unknown_wallet" });

  expect(await listTransactions({})).toHaveLength(1);
});
