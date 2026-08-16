// lib/reports/csv_export.ts — Plus-gated CSV export of the transaction ledger
// (M3b Task 4; docs/04-features/10-reports.md Flow D and rules 10-13, 16).
//
// THE HEADER BELOW IS THE TASK-4 BRIEF'S, VERBATIM, NOT docs/04-features/
// 10-reports.md's older 14-column table (`id`, `timestamp`, `wallet_type`,
// `category_parent`, `is_transfer`, `transfer_link_id`, ...). The brief is
// the newer, authoritative source for this task; the docs table is stale and
// gets reconciled separately. Everything the docs table still governs and
// the brief does not override — RFC 4180 quoting, CRLF + UTF-8 BOM,
// ascending timestamp order, no thousands separators — is followed exactly.
//
// ---------------------------------------------------------------------------
// FOUR DECISIONS THAT ARE EASY TO GET WRONG
// ---------------------------------------------------------------------------
// 1. AMOUNT IS NOT `formatCentavos`. components/ui/amount_text.tsx's
//    formatter produces `"₱1,234.56"` for on-screen reading — a peso sign
//    and a thousands separator that would corrupt every numeric column a
//    spreadsheet tries to parse (brief rule 1). `direction` alone carries
//    the sign, so `amount` here is always the absolute value, and the
//    centavos→decimal split below is integer arithmetic for the same reason
//    formatCentavos avoids float division: 123456 / 100 can print as
//    1234.5600000000001 in IEEE 754.
//
// 2. TRANSFERS ARE INCLUDED. aggregate.ts's whole point (see that file's
//    header) is EXCLUDING transfer-linked rows from every reports figure. An
//    export is a record of everything a Wallet touched, and dropping a
//    transfer leg would make the file irreconcilable with the bank
//    statement it exists to be checked against (brief rule 2) — so
//    `excludeTransferLinked` is never set on the `listTransactions` call
//    below, and every row simply reports `transfer: yes/no`.
//
// 3. THE HALF-OPEN CONVERSION mirrors reports_service.ts's
//    `fetchTransactions` exactly. `range` is aggregate.ts's `DateRange` —
//    inclusive `'YYYY-MM-DD'` calendar dates — but `listTransactions` wants
//    a half-open `[from, to)` millisecond window (interface contract §3).
//    `range.to`'s local midnight names the day itself, not the day after, so
//    it goes through `endOfLocalDay` to become the EXCLUSIVE bound that
//    names the day after — matching straight through with `parseDateIso`
//    would silently drop every transaction on the range's last day.
//
// 4. LOCAL TIME ONLY, NEVER `toISOString()`. The Philippines is UTC+8, so
//    the ISO/UTC form reports the PREVIOUS day for anything before 8am
//    local — every early-morning row would misdate. `date` goes through
//    `toDateIso` (lib/dates.ts) and `time` through `formatTime`
//    (lib/datetime.ts), the same two helpers aggregate.ts and the rest of
//    the app already use for local-time reads.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { listCategories } from "@/lib/db/repos/categories_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { listWallets } from "@/lib/db/repos/wallets_repo";
import { endOfLocalDay, parseDateIso, toDateIso } from "@/lib/dates";
import { formatTime } from "@/lib/datetime";
import type { DateRange } from "@/lib/reports/aggregate";
import type { Centavos, IsoDate, Transaction, TxDirection, TxSource } from "@/types/domain";

/**
 * One export row, already resolved to display-ready strings/values — every
 * lookup (wallet name, category name, local date/time) happens before a row
 * reaches `buildTransactionsCsv`, which stays pure and synchronous.
 */
export type TransactionExportRow = {
  date: IsoDate;
  time: string;
  direction: TxDirection;
  /** Integer centavos, always the absolute value — `direction` carries the sign. */
  amount: Centavos;
  currency: string;
  wallet: string;
  category: string;
  /** `""` when the Transaction's field is `null`. */
  merchant: string;
  counterparty: string;
  reference: string;
  source: TxSource;
  /** 0..1. */
  confidence: number;
  transfer: boolean;
  note: string;
};

// Column order is the brief's spec, VERBATIM — do not reorder or rename.
const CSV_HEADER =
  "date,time,direction,amount,currency,wallet,category,merchant,counterparty,reference,source,confidence,transfer,note";
const CRLF = "\r\n";
// U+FEFF via fromCharCode, not a pasted literal — a literal BOM glyph is
// invisible in source and an editor or future edit could silently mangle or
// normalize it away (brief rule 4: Excel needs this to render ₱ correctly).
const BOM = String.fromCharCode(0xfeff);

/** RFC 4180 §2: quote a field iff it contains a comma, a double quote, or a newline. */
function needsQuoting(value: string): boolean {
  return /[",\r\n]/u.test(value);
}

/** Wraps in double quotes and doubles any internal ones — RFC 4180 §2, brief rule 3. */
function escapeField(value: string): string {
  return needsQuoting(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

/**
 * Centavos → bare decimal pesos, e.g. `123456` → `"1234.56"`. See this
 * file's header, decision 1, for why this is not `formatCentavos`.
 */
function formatAmount(amount: Centavos): string {
  const absolute = Math.abs(amount);
  const pesos = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${pesos}.${fraction}`;
}

/** `0.9714` → `"0.97"`; `1` → `"1.00"` — docs' column table example. */
function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}

function rowToCsvLine(row: TransactionExportRow): string {
  const fields = [
    row.date,
    row.time,
    row.direction,
    formatAmount(row.amount),
    row.currency,
    row.wallet,
    row.category,
    row.merchant,
    row.counterparty,
    row.reference,
    row.source,
    formatConfidence(row.confidence),
    row.transfer ? "yes" : "no",
    row.note,
  ];
  return fields.map(escapeField).join(",");
}

/**
 * Rows → the finished CSV text: a UTF-8 BOM, the header, then one
 * CRLF-terminated line per row (brief rules 3-4; docs rule 12). Pure and
 * synchronous — safe to unit test with plain arrays, no I/O.
 */
export function buildTransactionsCsv(rows: TransactionExportRow[]): string {
  const lines = [CSV_HEADER, ...rows.map(rowToCsvLine)];
  return BOM + lines.join(CRLF) + CRLF;
}

/** `null` → `""` for the string columns a Transaction may leave absent. */
function orEmpty(value: string | null): string {
  return value ?? "";
}

function toExportRow(
  transaction: Transaction,
  walletNames: Map<string, string>,
  categoryNames: Map<string, string>,
): TransactionExportRow {
  return {
    date: toDateIso(new Date(transaction.occurredAt)),
    time: formatTime(transaction.occurredAt),
    direction: transaction.direction,
    amount: transaction.amount,
    currency: "PHP",
    wallet: walletNames.get(transaction.walletId) ?? transaction.walletId,
    category: categoryNames.get(transaction.categoryId) ?? transaction.categoryId,
    merchant: orEmpty(transaction.merchant),
    counterparty: orEmpty(transaction.counterparty),
    reference: orEmpty(transaction.referenceNo),
    source: transaction.source,
    confidence: transaction.confidence,
    transfer: transaction.transferLinkId !== null,
    note: orEmpty(transaction.note),
  };
}

/**
 * Writes the CSV for every committed Transaction in `range` (aggregate.ts's
 * inclusive `DateRange`) to the app's cache directory and hands it to the OS
 * share sheet, returning the written file's uri.
 *
 * NO ENTITLEMENT CHECK HERE — the same call-site discipline
 * hooks/mutations/use_create_goal.ts documents for `canCreateGoal`: gating is
 * components/reports/export_button.tsx's job (PlusGate plus
 * `hasCsvExport()`), not this data/IO function's.
 *
 * `today` names the file (brief rule 5, step 5's naming convention) — it is
 * a parameter rather than `Date.now()` per the global "no bare Date.now() in
 * testable paths" constraint.
 */
export async function exportTransactionsCsv(range: DateRange, today: string): Promise<string> {
  const from = parseDateIso(range.from).getTime();
  const to = endOfLocalDay(parseDateIso(range.to).getTime());

  const [transactions, wallets, categories] = await Promise.all([
    // excludeTransferLinked is deliberately NOT set — decision 2 above.
    listTransactions({ from, to }),
    listWallets({ includeArchived: true }),
    listCategories({ includeHidden: true }),
  ]);

  const walletNames = new Map(wallets.map((wallet) => [wallet.id, wallet.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  // Ascending timestamp order (docs rule 12) — listTransactions itself
  // returns newest-first, the ledger screen's own order.
  const rows = [...transactions]
    .sort((a, b) => a.occurredAt - b.occurredAt || a.createdAt - b.createdAt)
    .map((transaction) => toExportRow(transaction, walletNames, categoryNames));

  const csv = buildTransactionsCsv(rows);

  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error("csv_export: expo-file-system reports no cache directory");
  }
  // The cache directory, never documents — brief rule 5: "never writes to a
  // location the app cannot clean up."
  const fileUri = `${cacheDirectory}peraplano-transactions-${today}.csv`;

  await FileSystem.writeAsStringAsync(fileUri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: "text/csv",
      dialogTitle: "Export transactions",
    });
  }

  return fileUri;
}
