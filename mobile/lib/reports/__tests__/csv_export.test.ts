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
import { createCategory } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { parseDateIso } from "@/lib/dates";
import { freshDb } from "@/test_support/db";
import { buildTransactionsCsv, exportTransactionsCsv } from "../csv_export";
import type { TransactionExportRow } from "../csv_export";

const mockFileSystem = FileSystem as jest.Mocked<typeof FileSystem>;
const mockSharing = Sharing as jest.Mocked<typeof Sharing>;

const HEADER =
  "id,date,time,direction,amount,currency,wallet,wallet_type,category,category_parent,merchant,counterparty,reference,source,confidence,is_transfer,transfer_link_id,note";

// Column indices into a data line split on "," — safe for these tests
// because none of their field values contain a comma (the escaping tests
// below cover quoting separately, and don't use this helper).
const COLUMN = {
  id: 0,
  walletType: 7,
  category: 8,
  categoryParent: 9,
  isTransfer: 15,
  transferLinkId: 16,
} as const;

/** A well-formed row with no special characters, overridable per test. */
function row(overrides: Partial<TransactionExportRow> = {}): TransactionExportRow {
  return {
    id: "tx_1",
    date: "2026-08-15",
    time: "2:05 PM",
    direction: "out",
    amount: 12345,
    currency: "PHP",
    wallet: "GCash",
    walletType: "tracked",
    category: "Food & Dining",
    categoryParent: "",
    merchant: "Jollibee",
    counterparty: "",
    reference: "",
    source: "manual",
    confidence: 1,
    isTransfer: false,
    transferLinkId: "",
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
    row({ merchant: "Own GCash top-up", isTransfer: true, transferLinkId: "link_1" }),
    row({ merchant: "Landline bill", isTransfer: false }),
  ]);

  const lines = csv.trim().split("\r\n");
  expect(lines).toHaveLength(3); // header + two data rows — neither was dropped
  expect(lines[1]).toContain(",yes,");
  expect(lines[2]).toContain(",no,");
});

// docs/04-features/10-reports.md's decisive acceptance criterion:
// "Transfer-linked rows appear in the CSV with `is_transfer = true` and
// matching `transfer_link_id` values on both legs." Read by COLUMN INDEX,
// not `toContain`, so this fails loudly if `transfer_link_id` is ever
// dropped from the header again (a `toContain(",yes,")` check alone
// wouldn't notice a missing column).
test("both legs of a transfer carry the same non-empty transfer_link_id and is_transfer=yes", () => {
  const csv = buildTransactionsCsv([
    row({ id: "tx_out", merchant: "Own GCash top-up", isTransfer: true, transferLinkId: "link_abc" }),
    row({ id: "tx_in", merchant: "Own GCash top-up (received)", isTransfer: true, transferLinkId: "link_abc" }),
  ]);

  const [outLeg, inLeg] = csv.trim().split("\r\n").slice(1).map((line) => line.split(","));

  expect(outLeg[COLUMN.transferLinkId]).toBe("link_abc");
  expect(outLeg[COLUMN.transferLinkId]).not.toBe("");
  expect(outLeg[COLUMN.transferLinkId]).toBe(inLeg[COLUMN.transferLinkId]);
  expect(outLeg[COLUMN.isTransfer]).toBe("yes");
  expect(inLeg[COLUMN.isTransfer]).toBe("yes");
});

test("a non-transfer row has an empty transfer_link_id and is_transfer=no", () => {
  const csv = buildTransactionsCsv([row({ isTransfer: false, transferLinkId: "" })]);

  const [line] = csv.trim().split("\r\n").slice(1);
  const fields = line.split(",");

  expect(fields[COLUMN.isTransfer]).toBe("no");
  expect(fields[COLUMN.transferLinkId]).toBe("");
});

test("id round-trips the transaction's own id", () => {
  const csv = buildTransactionsCsv([row({ id: "tx_real_id_123" })]);

  const [line] = csv.trim().split("\r\n").slice(1);
  expect(line.split(",")[COLUMN.id]).toBe("tx_real_id_123");
});

test("a category with a parent emits the parent's name in category_parent; a top-level one emits empty", () => {
  const csv = buildTransactionsCsv([
    row({ id: "tx_child", category: "Fast Food", categoryParent: "Food & Dining" }),
    row({ id: "tx_top", category: "Transport", categoryParent: "" }),
  ]);

  const [childLine, topLine] = csv.trim().split("\r\n").slice(1).map((line) => line.split(","));

  expect(childLine[COLUMN.category]).toBe("Fast Food");
  expect(childLine[COLUMN.categoryParent]).toBe("Food & Dining");
  expect(topLine[COLUMN.category]).toBe("Transport");
  expect(topLine[COLUMN.categoryParent]).toBe("");
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

// The tests above pin buildTransactionsCsv's formatting from pre-resolved
// rows. The two below exercise the actual repo lookups exportTransactionsCsv
// performs — the id, wallet_type, and category_parent columns are only as
// good as those lookups, so they need real Wallets/Categories/Transactions,
// not hand-built TransactionExportRows.
test("wallet_type and category_parent are resolved from the real Wallet and Category rows", async () => {
  await freshDb();

  const wallet = await createWallet({ name: "GCash" });
  const parent = await createCategory({ name: "Food & Dining", icon: "utensils" });
  const child = await createCategory({ name: "Fast Food", icon: "burger", parentId: parent.id });
  const topLevel = await createCategory({ name: "Transport", icon: "car" });

  const childTx = await insertTransaction({
    walletId: wallet.id,
    categoryId: child.id,
    amount: 15000,
    direction: "out",
    occurredAt: parseDateIso("2026-08-10").getTime(),
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId: wallet.id,
    categoryId: topLevel.id,
    amount: 5000,
    direction: "out",
    occurredAt: parseDateIso("2026-08-11").getTime(),
    source: "manual",
    confidence: 1,
  });

  await exportTransactionsCsv({ from: "2026-08-01", to: "2026-08-31" }, "2026-08-31");

  const [, writtenContent] = mockFileSystem.writeAsStringAsync.mock.calls[0];
  const lines = (writtenContent as string).trim().split("\r\n").slice(1);
  const byId = new Map(lines.map((line) => {
    const fields = line.split(",");
    return [fields[COLUMN.id], fields];
  }));

  const childFields = byId.get(childTx.id)!;
  expect(childFields[COLUMN.category]).toBe("Fast Food");
  expect(childFields[COLUMN.categoryParent]).toBe("Food & Dining");
  // The column keeps its name and changes its vocabulary: it used to carry the
  // wallet type the user picked at onboarding, and now carries what the app
  // works out. Renaming the column would break every spreadsheet already
  // reading an export.
  //
  // `manual` because this fixture's wallet has no matchers — nothing routes to
  // it, which is the honest answer for a wallet created straight through the
  // repository with no notification source attached.
  expect(childFields[COLUMN.walletType]).toBe("manual");

  const topFields = [...byId.values()].find((fields) => fields[COLUMN.category] === "Transport")!;
  expect(topFields[COLUMN.categoryParent]).toBe("");
});

test("linked transfer legs export with matching transfer_link_id and is_transfer=yes", async () => {
  await freshDb();

  const sending = await createWallet({ name: "BPI", openingBalance: 100000 });
  const receiving = await createWallet({ name: "GCash" });
  const category = await createCategory({ name: "Transfer", icon: "arrow-right-left" });

  const outLeg = await insertTransaction({
    walletId: sending.id,
    categoryId: category.id,
    amount: 50000,
    direction: "out",
    occurredAt: parseDateIso("2026-08-05").getTime(),
    source: "manual",
    confidence: 1,
  });
  const inLeg = await insertTransaction({
    walletId: receiving.id,
    categoryId: category.id,
    amount: 50000,
    direction: "in",
    occurredAt: parseDateIso("2026-08-05").getTime(),
    source: "manual",
    confidence: 1,
  });
  const link = await linkTransfer(outLeg.id, inLeg.id, 0);

  await exportTransactionsCsv({ from: "2026-08-01", to: "2026-08-31" }, "2026-08-31");

  const [, writtenContent] = mockFileSystem.writeAsStringAsync.mock.calls[0];
  const lines = (writtenContent as string).trim().split("\r\n").slice(1);
  expect(lines).toHaveLength(2); // both legs are rows — decision 2, never excluded

  const rows = lines.map((line) => line.split(","));
  expect(rows.every((fields) => fields[COLUMN.isTransfer] === "yes")).toBe(true);
  expect(rows.every((fields) => fields[COLUMN.transferLinkId] === link.id)).toBe(true);
});
