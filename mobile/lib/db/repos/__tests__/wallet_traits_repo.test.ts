// lib/db/repos/__tests__/wallet_traits_repo.test.ts — against the real
// migrations through freshDb(), because the interesting behaviours here are
// SQL: an upsert that accumulates rather than replaces, and a verdict that
// refuses to overwrite what the user settled.
import { closeDatabase } from "@/lib/db/database";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { EMPTY_EVIDENCE } from "@/lib/wallets/classification";
import { freshDb } from "@/test_support/db";

import {
  applyOwedVerdict,
  getTraitEvidence,
  hasEverAskedWalletKind,
  recordTraitEvidence,
  setWalletOwed,
} from "../wallet_traits_repo";

import type { SQLiteDatabase } from "@/lib/db/database";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

describe("evidence", () => {
  test("a wallet with no history reads as empty, not as null", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    expect(await getTraitEvidence(wallet.id)).toEqual(EMPTY_EVIDENCE);
  });

  test("evidence accumulates across captures rather than replacing", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    await recordTraitEvidence(wallet.id, { owed: 250, held: 0 });
    const after = await recordTraitEvidence(wallet.id, { owed: 0, held: 150 });

    expect(after).toEqual({ owedScore: 250, heldScore: 150, sampleCount: 2 });
    expect(await getTraitEvidence(wallet.id)).toEqual(after);
  });

  test("a delta that scored nothing is not written and not counted", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    await recordTraitEvidence(wallet.id, { owed: 0, held: 0 });

    expect(await getTraitEvidence(wallet.id)).toEqual(EMPTY_EVIDENCE);
    const rows = await db.getAllAsync("SELECT wallet_id FROM wallet_trait_evidence");
    expect(rows).toHaveLength(0);
  });

  test("two wallets accumulate independently", async () => {
    const bpi = await createWallet({ name: "BPI", type: "bank" });
    const gcash = await createWallet({ name: "GCash", type: "e-wallet" });

    await recordTraitEvidence(bpi.id, { owed: 250, held: 0 });
    await recordTraitEvidence(gcash.id, { owed: 0, held: 150 });

    expect(await getTraitEvidence(bpi.id)).toEqual({
      owedScore: 250,
      heldScore: 0,
      sampleCount: 1,
    });
    expect(await getTraitEvidence(gcash.id)).toEqual({
      owedScore: 0,
      heldScore: 150,
      sampleCount: 1,
    });
  });
});

describe("verdicts", () => {
  test("a confident verdict flips the wallet without pinning it", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });

    expect(await applyOwedVerdict(wallet.id, { owed: true, confident: true })).toBe(true);

    const reloaded = await getWallet(wallet.id);
    expect(reloaded?.owedBalance).toBe(true);
    // Inferred, not answered — the user can still be asked, and a later run of
    // held evidence can still move it back.
    expect(reloaded?.owedPinned).toBe(false);
  });

  test("a verdict never overwrites a wallet the user settled", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    await setWalletOwed(wallet.id, false, { pinned: true });

    expect(await applyOwedVerdict(wallet.id, { owed: true, confident: true })).toBe(false);
    expect((await getWallet(wallet.id))?.owedBalance).toBe(false);
  });

  test("an unconfident verdict changes nothing, in either direction", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    await setWalletOwed(wallet.id, true, { pinned: false });

    expect(await applyOwedVerdict(wallet.id, { owed: false, confident: false })).toBe(false);
    expect((await getWallet(wallet.id))?.owedBalance).toBe(true);
  });

  test("a verdict that agrees with the stored value reports no change", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    expect(await applyOwedVerdict(wallet.id, { owed: false, confident: true })).toBe(false);
  });

  test("a verdict for a wallet that no longer exists is a no-op, not a throw", async () => {
    await expect(applyOwedVerdict("gone", { owed: true, confident: true })).resolves.toBe(false);
  });

  test("an explicit credit wallet arrives already pinned, so inference cannot move it", async () => {
    const card = await createWallet({ name: "Card", type: "credit" });
    expect(await applyOwedVerdict(card.id, { owed: false, confident: true })).toBe(false);
    expect((await getWallet(card.id))?.owedBalance).toBe(true);
  });
});

describe("asking at most once", () => {
  async function queueWalletKindItem(walletId: string, resolvedAt: number | null): Promise<void> {
    await db.runAsync(
      `INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at)
       VALUES (?, 'wallet-kind-unclear', ?, NULL, 1, NULL, ?)`,
      [`rq_${walletId}_${resolvedAt ?? "open"}`, JSON.stringify({ walletId }), resolvedAt],
    );
  }

  test("a wallet never asked about reports false", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    expect(await hasEverAskedWalletKind(wallet.id)).toBe(false);
  });

  test("an open question counts", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    await queueWalletKindItem(wallet.id, null);
    expect(await hasEverAskedWalletKind(wallet.id)).toBe(true);
  });

  test("a RESOLVED question still counts — dismissing is an answer", async () => {
    const wallet = await createWallet({ name: "BPI", type: "bank" });
    await queueWalletKindItem(wallet.id, 1_700_000_000_000);
    expect(await hasEverAskedWalletKind(wallet.id)).toBe(true);
  });

  test("another wallet's question does not count as this one's", async () => {
    const bpi = await createWallet({ name: "BPI", type: "bank" });
    const gcash = await createWallet({ name: "GCash", type: "e-wallet" });
    await queueWalletKindItem(gcash.id, null);

    expect(await hasEverAskedWalletKind(bpi.id)).toBe(false);
    expect(await hasEverAskedWalletKind(gcash.id)).toBe(true);
  });
});
