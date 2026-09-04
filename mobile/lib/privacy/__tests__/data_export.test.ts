// lib/privacy/__tests__/data_export.test.ts — m3b Task 6 Step 1.
//
// The brief's own named tests ("the bundle includes every table", "it
// includes a schema version", "it is valid JSON for a populated database")
// are covered below. Its fourth — "it includes raw captures" — is INVERTED
// on the coordinator's explicit instruction: the M3 Global Constraints state
// raw notification text never leaves the device, excluded from CSV export,
// export-everything, and telemetry (docs/07-privacy-and-compliance.md §4 row
// 7, §5 rule 2; docs/04-features/11-settings-privacy.md Flow E step 2's
// inclusion list never names raw_notifications). "seeds a raw capture,
// asserts its text is absent from the export" is the test that actually
// proves this file honours that rule — that is this file's whole point.
//
// expo-file-system and expo-sharing are native modules Jest cannot require —
// mocked the same way lib/reports/__tests__/csv_export.test.ts mocks them.
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { UTF8: "utf8" },
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { closeDatabase } from "@/lib/db/database";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { storeRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import { freshDb } from "@/test_support/db";
import { toDateIso } from "@/lib/dates";
import { buildDataExportBundle, exportAllData } from "../data_export";

const mockFileSystem = FileSystem as jest.Mocked<typeof FileSystem>;
const mockSharing = Sharing as jest.Mocked<typeof Sharing>;

const NOW = 1_786_000_000_000;
const CATEGORY_ID = "cat_food_dining";

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
});

afterEach(async () => {
  await closeDatabase();
});

test("the bundle includes every user-data table except raw_notifications", async () => {
  const bundle = await buildDataExportBundle(NOW);

  const tables = Object.keys(bundle.data);
  expect(tables).toEqual(expect.arrayContaining([
    "wallets",
    "transactions",
    "transfer_links",
    "categories",
    "limits",
    "income_profiles",
    "goals",
    "loans",
    "bills",
    "recurring_patterns",
    "user_rules",
    "app_settings",
  ]));
  expect(tables).not.toContain("raw_notifications");
  expect(tables).not.toContain("schema_migrations");
});

test("the bundle includes a schema version", async () => {
  const bundle = await buildDataExportBundle(NOW);

  // Every migration this app ships has run against a freshDb(), so the
  // highest applied version is at least the current migration count.
  expect(bundle.schemaVersion).toBeGreaterThan(0);
  expect(typeof bundle.schemaVersion).toBe("number");
});

test("a raw capture's text never appears anywhere in the export payload", async () => {
  await seedDefaultCategories();
  const wallet = await createWallet({ name: "GCash" });
  const secretText = "You have sent PHP 500.00 to JUAN D. Ref. 1234567 UNMISTAKABLE-MARKER";
  await storeRawCapture(
    {
      id: "cap-1",
      packageName: "com.globe.gcash.android",
      title: "GCash",
      text: secretText,
      subText: null,
      bigText: null,
      postedAt: NOW,
      capturedAt: NOW,
    },
    NOW,
  );
  await insertTransaction({
    walletId: wallet.id,
    categoryId: CATEGORY_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW,
    source: "notification",
    confidence: 0.95,
    rawNotificationId: "cap-1",
  });

  const bundle = await buildDataExportBundle(NOW);

  // Whole-table exclusion, the strongest form of the assertion: not merely
  // "the text field is blank on a row", but the table itself is absent.
  expect(bundle.data.raw_notifications).toBeUndefined();
  // Belt and braces — serialize the entire bundle and confirm the exact
  // captured sentence cannot be found ANYWHERE in it, including inside some
  // other table's JSON blob it has no business appearing in.
  expect(JSON.stringify(bundle)).not.toContain(secretText);
  expect(JSON.stringify(bundle)).not.toContain("UNMISTAKABLE-MARKER");
});

test("buildDataExportBundle produces valid, round-trippable JSON for a populated database", async () => {
  await seedDefaultCategories();
  const wallet = await createWallet({ name: "BPI" });
  await insertTransaction({
    walletId: wallet.id,
    categoryId: CATEGORY_ID,
    amount: 12345,
    direction: "in",
    occurredAt: NOW,
    source: "manual",
    confidence: 1,
  });

  const bundle = await buildDataExportBundle(NOW);
  const json = JSON.stringify(bundle);

  expect(() => JSON.parse(json)).not.toThrow();
  const parsed = JSON.parse(json);
  expect(parsed.data.wallets).toHaveLength(1);
  expect(parsed.data.transactions).toHaveLength(1);
});

test("exportAllData writes the bundle to the cache directory and returns its uri", async () => {
  const fileUri = await exportAllData(NOW);

  expect(fileUri).toBe(`file:///cache/peraplano-export-${toDateIso(new Date(NOW))}.json`);
  expect(mockFileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    fileUri,
    expect.any(String),
    expect.objectContaining({ encoding: "utf8" }),
  );
  const written = mockFileSystem.writeAsStringAsync.mock.calls[0][1];
  expect(() => JSON.parse(written)).not.toThrow();
});

// The exported file is a plaintext copy of EVERY exportable table — wallets,
// transactions, loans, settings — written next to the ENCRYPTED database
// docs/12-encryption-and-app-lock.md promises is the only copy at rest.
// Nothing else on the device deletes it, and the name is keyed on the date,
// so before these tests a week of exports meant a week of full plaintext
// databases waiting for Android to evict the cache. Mirrors the three
// lifecycle tests lib/reports/__tests__/csv_export.test.ts pins on the CSV
// path, so the two export flows cannot drift apart.
test("the written file is deleted once the share sheet has been handed it", async () => {
  const fileUri = await exportAllData(NOW);

  expect(mockSharing.shareAsync).toHaveBeenCalledTimes(1);
  expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(fileUri, { idempotent: true });
});

test("the written file is deleted even when the share itself fails", async () => {
  mockSharing.shareAsync.mockRejectedValueOnce(new Error("no activity found to handle intent"));

  await expect(exportAllData(NOW)).rejects.toThrow("no activity found to handle intent");

  expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(
    `file:///cache/peraplano-export-${toDateIso(new Date(NOW))}.json`,
    { idempotent: true },
  );
});

test("an unavailable share sheet raises instead of reporting a silent success", async () => {
  mockSharing.isAvailableAsync.mockResolvedValueOnce(false);

  await expect(exportAllData(NOW)).rejects.toThrow(/sharing is unavailable/u);

  expect(mockSharing.shareAsync).not.toHaveBeenCalled();
  // Asked before the write, so there is no plaintext copy to clean up either.
  expect(mockFileSystem.writeAsStringAsync).not.toHaveBeenCalled();
});
