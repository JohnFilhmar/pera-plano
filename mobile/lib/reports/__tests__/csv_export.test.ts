// lib/reports/__tests__/csv_export.test.ts — M3b Task 4.
//
// Each test is named after the rule it pins (task-4 brief step 1's ten named
// tests) rather than the mechanics — see csv_export.ts's header for the four
// decisions these protect (bare decimal amount, transfer INCLUSION, the
// half-open<->inclusive range conversion, local time only).
//
// The escaping tests (comma / double-quote / newline) are the heart of this
// file: each asserts the RFC 4180-quoted substring is present, which a naive
// `fields.join(",")` implementation — no quoting at all — could never
// produce. Verified by hand against exactly that naive implementation before
// this file was written against the real one.
//
// expo-file-system and expo-sharing are native modules Jest cannot require
// under this project's config — mocked with their own jest.fn()s, the same
// pattern lib/alerts/__tests__/alerts_service.test.ts uses for
// expo-notifications, rather than the real package.
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { UTF8: "utf8" },
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { closeDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import { buildTransactionsCsv, exportTransactionsCsv } from "../csv_export";
import type { TransactionExportRow } from "../csv_export";

const mockFileSystem = FileSystem as jest.Mocked<typeof FileSystem>;
const mockSharing = Sharing as jest.Mocked<typeof Sharing>;

const HEADER =
  "date,time,direction,amount,currency,wallet,category,merchant,counterparty,reference,source,confidence,transfer,note";

/** A well-formed row with no special characters, overridable per test. */
function row(overrides: Partial<TransactionExportRow> = {}): TransactionExportRow {
  return {
    date: "2026-08-15",
    time: "2:05 PM",
    direction: "out",
    amount: 12345,
    currency: "PHP",
    wallet: "GCash",
    category: "Food & Dining",
    merchant: "Jollibee",
    counterparty: "",
    reference: "",
    source: "manual",
    confidence: 1,
    transfer: false,
    note: "",
    ...overrides,
  };
}

afterEach(async () => {
  jest.clearAllMocks();
  await closeDatabase();
});

test("the header matches the column specification exactly", () => {
  const csv = buildTransactionsCsv([]);

  // Strip the BOM (pinned separately below) before checking the header line.
  const [headerLine] = csv.slice(1).split("\r\n");
  expect(headerLine).toBe(HEADER);
});

test("amounts render with exactly two decimals and no currency symbol", () => {
  // ₱1,000,000.00 — large enough that a reused formatCentavos would insert
  // thousands separators, and any peso sign would be immediately visible.
  const csv = buildTransactionsCsv([row({ amount: 100_000_000 })]);

  expect(csv).toContain(",1000000.00,");
  expect(csv).not.toContain("₱");
  expect(csv).not.toContain("1,000,000");
});

test("a merchant containing a comma is quoted", () => {
  const csv = buildTransactionsCsv([row({ merchant: "Jollibee, SM North EDSA" })]);

  // A naive `fields.join(",")` would leave this comma bare, splitting the
  // merchant across two columns instead of producing this quoted field.
  expect(csv).toContain("\"Jollibee, SM North EDSA\"");
});

test("a field containing a double quote has it doubled and is quoted", () => {
  const csv = buildTransactionsCsv([row({ merchant: "Tita's \"Sari-Sari\" Store" })]);

  // A naive join would leave the inner quotes un-doubled and the field
  // unwrapped — both corrupt the row for any RFC 4180 reader.
  expect(csv).toContain("\"Tita's \"\"Sari-Sari\"\" Store\"");
});

test("a note containing a newline is quoted", () => {
  const csv = buildTransactionsCsv([row({ note: "Split the bill\nwith Ana" })]);

  // A naive join would leave the embedded newline bare, splitting one row
  // of data into two lines of the file.
  expect(csv).toContain("\"Split the bill\nwith Ana\"");
});

test("transfer rows are included with yes, non-transfer rows with no", () => {
  const csv = buildTransactionsCsv([
    row({ merchant: "Own GCash top-up", transfer: true }),
    row({ merchant: "Landline bill", transfer: false }),
  ]);

  const lines = csv.trim().split("\r\n");
  expect(lines).toHaveLength(3); // header + two data rows — neither was dropped
  expect(lines[1]).toContain(",yes,");
  expect(lines[2]).toContain(",no,");
});

test("line endings are CRLF throughout", () => {
  const csv = buildTransactionsCsv([row(), row({ merchant: "7-Eleven" })]);

  // Strip every correctly-paired CRLF; anything left behind is a bare "\n"
  // that a plain join("\n") would have produced instead.
  expect(csv.replaceAll("\r\n", "").includes("\n")).toBe(false);
  expect(csv.split("\r\n")).toHaveLength(4); // header + 2 rows + trailing empty
});

test("the output starts with a UTF-8 BOM", () => {
  const csv = buildTransactionsCsv([]);

  expect(csv.charCodeAt(0)).toBe(0xfeff);
});

test("an empty range produces a header-only file", async () => {
  await freshDb();

  const uri = await exportTransactionsCsv({ from: "2026-08-01", to: "2026-08-31" }, "2026-08-31");

  expect(uri).toBe("file:///cache/peraplano-transactions-2026-08-31.csv");
  expect(mockFileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
  const [writtenUri, writtenContent] = mockFileSystem.writeAsStringAsync.mock.calls[0];
  expect(writtenUri).toBe(uri);
  expect(writtenContent).toBe(buildTransactionsCsv([]));
  expect(mockSharing.shareAsync).toHaveBeenCalledTimes(1);
});

test("a peso sign in a note survives the round trip", () => {
  const csv = buildTransactionsCsv([row({ note: "Kuya's ₱50 tip" })]);

  expect(csv).toContain("Kuya's ₱50 tip");
});
