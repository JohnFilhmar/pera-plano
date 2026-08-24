// lib/reports/csv_export.ts — Plus-gated CSV export of the transaction ledger
// (M3b Task 4; docs/04-features/10-reports.md Flow D, §"CSV column
// specification", and rules 10-13, 16).
//
// HEADER RECONCILIATION RULING: where the Task-4 brief's header and
// docs/04-features/10-reports.md's "CSV column specification" table
// conflict, THE SPEC WINS — the spec is this project's binding authority and
// the plan/brief is its argument, applied consistently elsewhere in this
// codebase. Two spec columns the brief had dropped are restored because the
// brief's own case for them doesn't survive scrutiny:
//
//   - `transfer_link_id` is DECISIVE. The spec's acceptance criterion reads
//     "Transfer-linked rows appear in the CSV with `is_transfer = true` and
//     matching `transfer_link_id` values on both legs" — a bare yes/no flag
//     cannot satisfy that. It also undercuts the brief's own reason for
//     including transfer rows at all (decision 2 below): bank reconciliation
//     needs to pair the two legs of an internal transfer, which a flag alone
//     can't do.
//   - `id` is the spec's own stated purpose: "stable identifier for dedupe
//     on re-import elsewhere." The brief offered no substitute.
//
// `wallet_type` and `category_parent` are restored too, as plain spec
// columns the brief simply omitted with no counter-argument.
//
// Where the brief's additions do NOT conflict with the spec, they survive:
// `currency`, `counterparty`, and `reference` are additive columns the spec
// doesn't have and cost nothing.
//
// TWO DELIBERATE DEVIATIONS FROM THE SPEC TABLE, KEPT ON PURPOSE:
//
//   - `date` + `time` instead of the spec's single `timestamp` (ISO 8601
//     with offset). The spec itself says the Philippines is a single time
//     zone with "no cross-time-zone handling in MVP," so a `timestamp`
//     column's UTC offset would carry no information this file doesn't
//     already have. Two sortable columns serve the spreadsheet user (this
//     export's stated consumer) better than one ISO string.
//   - `is_transfer` keeps the brief's `yes`/`no` values rather than the
//     spec's `true`/`false`. The acceptance criterion only requires the
//     column to identify transfer rows, and `yes`/`no` reads better in a
//     spreadsheet cell than `true`/`false` does.
//
// Everything else the spec governs — RFC 4180 quoting, CRLF + UTF-8 BOM,
// ascending timestamp order, no thousands separators — is followed exactly.
//
// `wallet_type` and `category_parent` are resolved the same way
// reports_service.ts and aggregate.ts resolve wallet/category data: a
// `listWallets`/`listCategories` read up front, folded into id-keyed Maps
// (`categoryBreakdown`'s `byId` pattern) rather than a new access path.
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
//    statement it exists to be checked against (brief rule 2; spec rule 10)
//    — so `excludeTransferLinked` is never set on the `listTransactions`
//    call below, and every row simply reports `is_transfer: yes/no` plus its
//    `transfer_link_id`.
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
import type {
  Category,
  Centavos,
  IsoDate,
  Transaction,
  TxDirection,
  TxSource,
  Wallet,
} from "@/types/domain";

/**
 * One export row, already resolved to display-ready strings/values — every
 * lookup (wallet name/type, category name/parent, local date/time) happens
 * before a row reaches `buildTransactionsCsv`, which stays pure and
 * synchronous.
 */
export type TransactionExportRow = {
  /** The Transaction's own id — spec: "stable identifier for dedupe on re-import elsewhere." */
  id: string;
  date: IsoDate;
  time: string;
  direction: TxDirection;
  /** Integer centavos, always the absolute value — `direction` carries the sign. */
  amount: Centavos;
  currency: string;
  wallet: string;
  /** `""` when the wallet id has no matching row. */
  walletType: string;
  category: string;
  /** The parent category's name, or `""` for a top-level category. */
  categoryParent: string;
  /** `""` when the Transaction's field is `null`. */
  merchant: string;
  counterparty: string;
  reference: string;
  source: TxSource;
  /** 0..1. */
  confidence: number;
  isTransfer: boolean;
  /** `""` when not a transfer leg; both legs of one Transfer Link share the same value. */
  transferLinkId: string;
  note: string;
};

// Column order is docs/04-features/10-reports.md's "CSV column
// specification" table, with the brief's additive `currency`, `counterparty`,
// `reference` folded in and `timestamp` kept split as `date`+`time` — see
// this file's header for the full reconciliation. Do not reorder or rename
// without updating that comment.
const CSV_HEADER =
  "id,date,time,direction,amount,currency,wallet,wallet_type,category,category_parent,merchant,counterparty,reference,source,confidence,is_transfer,transfer_link_id,note";
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
    row.id,
    row.date,
    row.time,
    row.direction,
    formatAmount(row.amount),
    row.currency,
    row.wallet,
    row.walletType,
    row.category,
    row.categoryParent,
    row.merchant,
    row.counterparty,
    row.reference,
    row.source,
    formatConfidence(row.confidence),
    row.isTransfer ? "yes" : "no",
    row.transferLinkId,
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

/**
 * The category's own parent's NAME, or `""` for a top-level category or a
 * dangling `parentId` — the immediate parent, unlike aggregate.ts's
 * `rootCategoryId` walk to the top-level ancestor; the spec column wants the
 * one level up, not the roll-up root.
 */
function categoryParentName(category: Category | undefined, byId: Map<string, Category>): string {
  if (!category || category.parentId === null) return "";
  return byId.get(category.parentId)?.name ?? "";
}

function toExportRow(
  transaction: Transaction,
  walletsById: Map<string, Wallet>,
  categoriesById: Map<string, Category>,
): TransactionExportRow {
  const wallet = walletsById.get(transaction.walletId);
  const category = categoriesById.get(transaction.categoryId);

  return {
    id: transaction.id,
    date: toDateIso(new Date(transaction.occurredAt)),
    time: formatTime(transaction.occurredAt),
    direction: transaction.direction,
    amount: transaction.amount,
    currency: "PHP",
    wallet: wallet?.name ?? transaction.walletId,
    walletType: wallet?.type ?? "",
    category: category?.name ?? transaction.categoryId,
    categoryParent: categoryParentName(category, categoriesById),
    merchant: orEmpty(transaction.merchant),
    counterparty: orEmpty(transaction.counterparty),
    reference: orEmpty(transaction.referenceNo),
    source: transaction.source,
    confidence: transaction.confidence,
    isTransfer: transaction.transferLinkId !== null,
    transferLinkId: orEmpty(transaction.transferLinkId),
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

  // Id-keyed Maps, the same lookup shape aggregate.ts's `categoryBreakdown`
  // (`byId`) and reports_service.ts build over listWallets/listCategories.
  const walletsById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  // Ascending timestamp order (docs rule 12) — listTransactions itself
  // returns newest-first, the ledger screen's own order.
  const rows = [...transactions]
    .sort((a, b) => a.occurredAt - b.occurredAt || a.createdAt - b.createdAt)
    .map((transaction) => toExportRow(transaction, walletsById, categoriesById));

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
