// app/__tests__/transaction_detail.test.tsx — m1c plan Task 7's route,
// app/transaction/[id].tsx, against a REAL database.
//
// The panel's presentation is pinned next door
// (components/transactions/__tests__/why_recorded_panel.test.tsx). What lives
// HERE is everything that can only be true end to end — the screen reading the
// stored expiry rather than deriving one, and the two write paths whose damage
// is invisible in a component test:
//
//   THE CHECKBOX THE USER UNCHECKED MUST CREATE NO RULE. Asserted with
//   `listUserRules()`, not with a spy. A user who declines "always categorize
//   Jollibee as Transport" has said something specific about every future
//   Jollibee row; quietly making the rule anyway recategorizes transactions
//   they never looked at, and they find out weeks later from a report.
//
//   UNLINKING MUST RESTORE THE LEGS TO THE TOTALS. Asserted with `sumSpend`,
//   not by checking that the link row went away. `sumSpend` excludes
//   `transfer_link_id IS NOT NULL`, so a dissolved link whose legs were left
//   stamped is money the user can see in the ledger and cannot find in any
//   total — the ledger and the totals disagreeing, with nothing on screen
//   admitting it.
//
//   A ROW WRITE THAT FAILS MUST TEACH NOTHING. The correction and the rule are
//   two writes against two aggregates, and only one order between them is safe:
//   the rule is only true because the row moved. See the flag and the call
//   counter below.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
}));

// A repository call that REFUSES, and a count of how many times a repository
// call actually ran — the same passthrough-mock shape
// app/__tests__/wallet_routes.test.tsx uses for the wallet form's paired
// writes.
//
// PASSTHROUGH MOCKS, NOT STUBS. Everything else in both modules is the real
// implementation, so every other assertion in this file goes on running
// against the real schema. Only `updateTransaction` changes behaviour, and
// only while the flag says so.
//
// THE FAILURE CANNOT BE PRODUCED ANY OTHER WAY at this level: every category
// the picker can offer is a valid `category_id`, so `updateTransaction`
// succeeds for anything this screen can construct — and "the row write failed"
// is precisely the state the screen was mishandling.
//
// THE CALL COUNT IS NOT DECORATION. Before the fix both mutations were fired
// in the SAME tick, so a test that only checked `user_rules` could outrun the
// INSERT and pass over the very bug it exists to catch. `createUserRule` never
// being CALLED is the assertion that cannot pass by timing.
let mockFailUpdateTransaction = false;
const mockRepoCalls = { updateTransaction: 0, createUserRule: 0 };

jest.mock("@/lib/db/repos/transactions_repo", () => {
  const actual = jest.requireActual<typeof import("@/lib/db/repos/transactions_repo")>(
    "@/lib/db/repos/transactions_repo",
  );
  return {
    ...actual,
    updateTransaction: (...args: Parameters<typeof actual.updateTransaction>) => {
      mockRepoCalls.updateTransaction += 1;
      return mockFailUpdateTransaction
        ? Promise.reject(new Error("the category could not be saved"))
        : actual.updateTransaction(...args);
    },
  };
});

jest.mock("@/lib/db/repos/user_rules_repo", () => {
  const actual = jest.requireActual<typeof import("@/lib/db/repos/user_rules_repo")>(
    "@/lib/db/repos/user_rules_repo",
  );
  return {
    ...actual,
    createUserRule: (...args: Parameters<typeof actual.createUserRule>) => {
      mockRepoCalls.createUserRule += 1;
      return actual.createUserRule(...args);
    },
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  MANUAL_SOURCE_NOTE,
  RAW_CAPTURE_EXPIRED_NOTICE,
  WHY_RECORDED_TITLE,
} from "@/components/transactions/why_recorded_panel";
import { closeDatabase } from "@/lib/db/database";
import { createBill, getCycle, recordBillPayment } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createLoan, outstandingBalance, recordPayment } from "@/lib/db/repos/loans_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import {
  purgeExpiredRawCaptures,
  RAW_CAPTURE_TTL_MS,
  storeRawCapture,
} from "@/lib/db/repos/raw_notifications_repo";
import { getTransaction, insertTransaction, sumSpend } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { listUserRules } from "@/lib/db/repos/user_rules_repo";
import { archiveWallet, createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { formatDateTime } from "@/lib/datetime";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { RawCapture, Transaction, Wallet } from "@/types/domain";

import TransactionDetailScreen from "../transaction/[id]";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { id: string } = { id: "" };

const DAY_MS = 24 * 60 * 60 * 1000;
const GCASH_PACKAGE = "com.globe.gcash.android";
const FOOD = "cat_food_dining";
const TRANSPORT = "cat_transport";

/**
 * The screen reads the wall clock for its countdown, so the fixtures are
 * positioned RELATIVE to it. A capture stored 18 days ago expires in 12,
 * whatever day this suite runs on.
 */
const NOW = Date.now();

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

async function renderDetail(transactionId: string): Promise<void> {
  mockParams = { id: transactionId };
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<TransactionDetailScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId("transaction-detail")).toBeTruthy());
}

// Device-testing fix, Task 2 follow-up (2026-08-18): this screen's insets
// used to sit on the ScrollView's `style`, its outer frame rather than its
// scrolling content — same defect, same fix, same verification shape as
// app/wallet/[id].tsx, app/wallet/new.tsx and app/wallet/[id]/edit.tsx in
// app/__tests__/wallet_routes.test.tsx. A real `SafeAreaProvider` with
// deliberately non-zero, UNEQUAL insets is what turns "padded for both
// bars" into an observable fact instead of two zeros that happen to agree.
const INSET_TOP = 24;
const INSET_BOTTOM = 48;

function renderDetailWithInsets(transactionId: string): void {
  mockParams = { id: transactionId };
  const client = makeTestClient();
  render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 320, height: 640 },
          insets: { top: INSET_TOP, bottom: INSET_BOTTOM, left: 0, right: 0 },
        }}
      >
        <TransactionDetailScreen />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

/** The padding actually applied, after NativeWind's `className` styles and
 * any `style` prop have been merged the way React Native merges them. */
function paddingOf(element: { props: { style?: unknown } }) {
  const flat = StyleSheet.flatten(element.props.style as never) ?? {};
  return {
    top: (flat as { paddingTop?: number }).paddingTop,
    bottom: (flat as { paddingBottom?: number }).paddingBottom,
  };
}

function capture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: "cap-1",
    packageName: GCASH_PACKAGE,
    title: "GCash",
    text: "You have sent PHP 500.00 to JUAN D. Ref. 1234567",
    subText: null,
    bigText: null,
    postedAt: NOW - 18 * DAY_MS,
    capturedAt: NOW - 18 * DAY_MS,
    ...overrides,
  };
}

let gcash: Wallet;
let bpi: Wallet;

beforeEach(async () => {
  jest.clearAllMocks();
  mockFailUpdateTransaction = false;
  mockRepoCalls.updateTransaction = 0;
  mockRepoCalls.createUserRule = 0;
  await freshDb();
  await seedDefaultCategories();
  await upsertRuleset({
    version: 1,
    providers: [
      {
        providerKey: "gcash",
        packageNames: [GCASH_PACKAGE],
        version: 1,
        channel: "push",
        templates: [],
      },
    ],
    tunables: {},
  });
  gcash = await createWallet({ name: "GCash", openingBalance: 500_000 });
  bpi = await createWallet({ name: "BPI Savings", openingBalance: 1_000_000 });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// "Counts toward" — the owner's 2026-08-30 report, "wallet adjust balance
// counts as expense".
//
// The reported screenshot was THIS row: a starting-balance correction whose
// detail sheet read "Counts toward: Spending". The label was not lying; the
// row really was in every spend total. Both halves are pinned here — the
// sentence the user reads, and the figure behind it.
// ---------------------------------------------------------------------------

describe("counts toward", () => {
  test("a balance adjustment says it is not counted, and is not", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 496_460,
      direction: "out",
      occurredAt: NOW,
      source: "manual",
      confidence: 1,
      note: "Starting balance / manual correction",
      isAdjustment: true,
    });

    await renderDetail(tx.id);

    // A regex, not a string: the ListRow renders title AND subtitle, so its
    // text content is "Not counted — balance adjustmentCounts toward" and an
    // exact match would fail on the label the row is supposed to carry.
    expect(screen.getByTestId("transaction-detail-counts-toward")).toHaveTextContent(
      /Not counted — balance adjustment/,
    );
    expect(await sumSpend({ from: NOW - DAY_MS, to: NOW + DAY_MS })).toBe(0);
  });

  test("an ordinary outflow still says Spending", async () => {
    // The other direction of the rule: a fix that labelled everything
    // "not counted" would understate what the user is spending.
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 66_261,
      direction: "out",
      occurredAt: NOW,
      source: "manual",
      confidence: 1,
    });

    await renderDetail(tx.id);

    // `^Spending` anchors it: "Not counted — balance adjustment" does not
    // contain the word, but an unanchored /Spending/ would also pass against a
    // row that said "Not counted as Spending", which is not what this asserts.
    expect(screen.getByTestId("transaction-detail-counts-toward")).toHaveTextContent(
      /^Spending/,
    );
    expect(await sumSpend({ from: NOW - DAY_MS, to: NOW + DAY_MS })).toBe(66_261);
  });

  test("an incoming adjustment is not reported as Income either", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 499_500,
      direction: "in",
      occurredAt: NOW,
      source: "manual",
      confidence: 1,
      isAdjustment: true,
    });

    await renderDetail(tx.id);

    expect(screen.getByTestId("transaction-detail-counts-toward")).toHaveTextContent(
      /Not counted — balance adjustment/,
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — every field
// ---------------------------------------------------------------------------

describe("the detail screen", () => {
  test("renders every field, each with its own distinct value", async () => {
    // Every value below is unique, so a screen that cross-wires two fields
    // (the merchant into the note, the reference into the counterparty) fails
    // instead of passing on a shared placeholder.
    const occurredAt = new Date(2026, 7, 11, 14, 5).getTime();
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 123_456,
      direction: "out",
      occurredAt,
      merchant: "Jollibee Katipunan",
      counterparty: null,
      referenceNo: "REF-778899",
      source: "notification",
      confidence: 0.95,
      note: "lunch with Ana",
    });

    await renderDetail(tx.id);

    // U+2212 MINUS, not a hyphen: the sign IS the direction, and `AmountText`
    // renders it for any amount given one.
    expect(screen.getByTestId("transaction-detail-amount")).toHaveTextContent("−₱1,234.56");
    expect(screen.getByTestId("transaction-detail-direction")).toHaveTextContent(/out/i);
    expect(screen.getByTestId("transaction-detail-datetime")).toHaveTextContent(
      "Aug 11, 2026 at 2:05 PM",
    );
    expect(screen.getByTestId("transaction-detail-wallet")).toHaveTextContent("GCash");
    expect(screen.getByTestId("transaction-detail-category")).toHaveTextContent(/Food & Dining/);
    expect(screen.getByTestId("transaction-detail-merchant")).toHaveTextContent(
      "Jollibee Katipunan",
    );
    expect(screen.getByTestId("transaction-detail-reference")).toHaveTextContent("REF-778899");
    expect(screen.getByTestId("transaction-detail-note-input").props.value).toBe("lunch with Ana");
    expect(screen.getByTestId("transaction-detail-source")).toHaveTextContent(/notification/i);
  });

  test("an unknown id says so rather than rendering a blank screen", async () => {
    mockParams = { id: "no-such-transaction" };
    const client = makeTestClient();
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    render(<TransactionDetailScreen />, { wrapper: Wrapper });

    expect(await screen.findByTestId("transaction-detail-missing")).toBeTruthy();
  });

  test("editing the note writes it, and leaves every other field alone", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 50_000,
      direction: "out",
      occurredAt: NOW - DAY_MS,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.9,
    });

    await renderDetail(tx.id);

    const input = screen.getByTestId("transaction-detail-note-input");
    fireEvent.changeText(input, "split with Ben");
    fireEvent(input, "blur");

    await waitFor(async () => {
      expect((await getTransaction(tx.id))?.note).toBe("split with Ben");
    });
    const after = await getTransaction(tx.id);
    expect(after?.merchant).toBe("Jollibee");
    expect(after?.categoryId).toBe(FOOD);
    expect(after?.amount).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// Rules 2–4 — "Why was this recorded?"
// ---------------------------------------------------------------------------

describe("the transparency panel", () => {
  async function notificationTransaction(
    storedAt: number,
    overrides: Partial<RawCapture> = {},
  ): Promise<Transaction> {
    const stored = capture(overrides);
    await storeRawCapture(stored, storedAt);
    return insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 50_000,
      direction: "out",
      occurredAt: stored.capturedAt,
      merchant: "Juan D",
      source: "notification",
      confidence: 0.95,
      rawNotificationId: stored.id,
    });
  }

  test("shows the captured text and the provider NAME, not the package", async () => {
    const tx = await notificationTransaction(NOW - 18 * DAY_MS);
    await renderDetail(tx.id);

    fireEvent.press(screen.getByTestId("why-recorded-toggle"));

    await screen.findByTestId("why-recorded-text");
    // A whole-node match: a truncated or reworded rendering of what was read is
    // not what was read.
    expect(screen.getByText("You have sent PHP 500.00 to JUAN D. Ref. 1234567")).toBeTruthy();
    expect(screen.getByTestId("why-recorded-provider")).toHaveTextContent("GCash");
    // A user who is shown "com.globe.gcash.android" has not been told which app
    // was read — which is the only question this panel exists to answer.
    expect(screen.queryByText(new RegExp(GCASH_PACKAGE.replace(/\./g, "\\.")))).toBeNull();
  });

  test("the countdown is the STORED expiry, not capturedAt + the TTL", async () => {
    // Captured 25 days ago, stored 18 days ago — a capture that sat in the
    // native buffer while the app was locked, then drained. It has 12 days
    // left. Derived from `capturedAt` the screen would say 5, and would be
    // announcing a deletion a week before the database performs it.
    const tx = await notificationTransaction(NOW - 18 * DAY_MS, {
      capturedAt: NOW - 25 * DAY_MS,
      postedAt: NOW - 25 * DAY_MS,
    });
    await renderDetail(tx.id);

    fireEvent.press(screen.getByTestId("why-recorded-toggle"));

    const expiry = await screen.findByTestId("why-recorded-expiry");
    expect(expiry).toHaveTextContent("This capture is deleted in 12 days");
    expect(expiry).not.toHaveTextContent("5 days");
    // Belt and braces on the fixture itself: the two candidate answers really
    // are different, so the assertion above is discriminating.
    expect(NOW - 18 * DAY_MS + RAW_CAPTURE_TTL_MS).not.toBe(
      NOW - 25 * DAY_MS + RAW_CAPTURE_TTL_MS,
    );
  });

  test("a purged capture renders the expired notice, not an empty box", async () => {
    const tx = await notificationTransaction(NOW - 40 * DAY_MS);
    // Day 31: the bootstrap purge deletes the row and nulls the pointer.
    expect(await purgeExpiredRawCaptures(NOW)).toBe(1);
    expect((await getTransaction(tx.id))?.rawNotificationId).toBeNull();

    await renderDetail(tx.id);
    fireEvent.press(screen.getByTestId("why-recorded-toggle"));

    expect(await screen.findByTestId("why-recorded-body")).toHaveTextContent(
      RAW_CAPTURE_EXPIRED_NOTICE,
    );
    // Spec rule 6: no auto-committed Transaction is ever unexplainable. The
    // parsed fields outlive the text.
    expect(screen.getByTestId("transaction-detail-amount")).toHaveTextContent("−₱500.00");
  });

  test("a MANUAL transaction renders the manual note and no panel at all", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 20_000,
      direction: "out",
      occurredAt: NOW - DAY_MS,
      source: "manual",
      confidence: 1,
    });

    await renderDetail(tx.id);

    expect(screen.getByTestId("transaction-manual-note")).toHaveTextContent(MANUAL_SOURCE_NOTE);
    expect(screen.queryByTestId("why-recorded-panel")).toBeNull();
    expect(screen.queryByText(WHY_RECORDED_TITLE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — the category edit, and the rule it does or does not create
// ---------------------------------------------------------------------------

describe("changing the category", () => {
  async function jollibee(): Promise<Transaction> {
    return insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 30_000,
      direction: "out",
      occurredAt: NOW - DAY_MS,
      merchant: "Jollibee Katipunan",
      source: "notification",
      confidence: 0.9,
    });
  }

  async function openPicker(tx: Transaction): Promise<void> {
    await renderDetail(tx.id);
    fireEvent.press(screen.getByTestId("transaction-detail-category"));
    await waitFor(() => expect(screen.getByTestId("category-picker")).toBeTruthy());
  }

  test("the rule checkbox is CHECKED by default and names the merchant and the category", async () => {
    const tx = await jollibee();
    await openPicker(tx);

    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));

    const checkbox = screen.getByTestId("category-rule-checkbox");
    expect(checkbox.props.accessibilityState?.checked).toBe(true);
    expect(checkbox).toHaveTextContent("Always categorize Jollibee Katipunan as Transport");
  });

  test("saving with it checked recategorizes the row AND creates the rule", async () => {
    const tx = await jollibee();
    await openPicker(tx);

    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));

    await waitFor(async () => {
      expect((await getTransaction(tx.id))?.categoryId).toBe(TRANSPORT);
    });

    await waitFor(async () => expect(await listUserRules()).toHaveLength(1));
    const [rule] = await listUserRules();
    // The SHIPPED UserRule shape (types/domain.ts): a matcher/action pair.
    // There is no "kind: merchant_category" anywhere in this codebase.
    expect(rule.matcher).toEqual({ merchantPattern: "Jollibee Katipunan" });
    expect(rule.action).toEqual({ kind: "set-category", categoryId: TRANSPORT });
    // Invariant I15: every rule is traceable to what created it.
    expect(rule.createdFrom).toBe(tx.id);
    expect(rule.isEnabled).toBe(true);
  });

  test("UNCHECKING it changes only this transaction and creates NO rule", async () => {
    const tx = await jollibee();
    await openPicker(tx);

    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-rule-checkbox"));
    expect(screen.getByTestId("category-rule-checkbox").props.accessibilityState?.checked).toBe(
      false,
    );
    fireEvent.press(screen.getByTestId("category-picker-save"));

    await waitFor(async () => {
      expect((await getTransaction(tx.id))?.categoryId).toBe(TRANSPORT);
    });
    // The user said no. `listUserRules()` is the assertion, not a spy: this is
    // the state that decides whether next month's Jollibee rows move on their
    // own.
    expect(await listUserRules()).toEqual([]);
  });

  test("a row write that FAILS teaches nothing — no rule, not even attempted", async () => {
    const tx = await jollibee();
    await openPicker(tx);

    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    // Checked by default, so this is the ordinary "yes, always" path — the one
    // that used to write the rule whatever happened to the row.
    expect(screen.getByTestId("category-rule-checkbox").props.accessibilityState?.checked).toBe(
      true,
    );

    mockFailUpdateTransaction = true;
    fireEvent.press(screen.getByTestId("category-picker-save"));

    await waitFor(() => expect(mockRepoCalls.updateTransaction).toBe(1));

    // The row is still Food & Dining: the correction the user made did not
    // land, and the global failure toast (GAP-013) is what says so.
    expect((await getTransaction(tx.id))?.categoryId).toBe(FOOD);
    // So NOTHING may claim it did. The rule write must never have been
    // attempted — the assertion that cannot pass by timing, because the two
    // mutations were previously fired in the same tick.
    expect(mockRepoCalls.createUserRule).toBe(0);

    // And the table, which is the state that decides whether next month's
    // Jollibee rows move on their own. Given time for an INSERT to land first,
    // so "no row" means the write never happened rather than that this line
    // outran it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(await listUserRules()).toEqual([]);
    expect(mockRepoCalls.createUserRule).toBe(0);
  });

  test("a transaction with no merchant is offered no rule at all", async () => {
    // `merchantPattern` is a case-insensitive SUBSTRING test, and a blank
    // pattern fails closed in the categorizer — so a rule built from a null
    // merchant would be a rule that can never fire, sitting in the user's
    // settings looking as though it might.
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 30_000,
      direction: "out",
      occurredAt: NOW - DAY_MS,
      merchant: null,
      counterparty: "Maria S",
      source: "notification",
      confidence: 0.9,
    });
    await openPicker(tx);

    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    expect(screen.queryByTestId("category-rule-checkbox")).toBeNull();

    fireEvent.press(screen.getByTestId("category-picker-save"));
    await waitFor(async () => {
      expect((await getTransaction(tx.id))?.categoryId).toBe(TRANSPORT);
    });
    expect(await listUserRules()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — transfer link actions
// ---------------------------------------------------------------------------

describe("transfer links", () => {
  /** An out-leg in BPI and its matching in-leg in GCash, plus two decoys. */
  async function transferLegs(): Promise<{
    out: Transaction;
    in: Transaction;
    sameWallet: Transaction;
    sameDirection: Transaction;
  }> {
    const outLeg = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "out",
      occurredAt: NOW - 2 * 60 * 60 * 1000,
      merchant: "Transfer to GCash",
      source: "notification",
      confidence: 0.9,
    });
    const inLeg = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "in",
      occurredAt: NOW - 2 * 60 * 60 * 1000 + 30_000,
      merchant: "Cash in from BPI",
      source: "notification",
      confidence: 0.9,
    });
    // Same wallet as the subject, opposite direction. The detector would never
    // pair these (§7 rule 1: different Wallets), so offering it invites the
    // user to create a link the app itself would refuse to make.
    const sameWallet = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "in",
      occurredAt: NOW - 3 * 60 * 60 * 1000,
      merchant: "Interest credit",
      source: "notification",
      confidence: 0.9,
    });
    // Different wallet, SAME direction. Two outs are not a transfer; linking
    // them would take two real expenses out of every total at once.
    const sameDirection = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "out",
      occurredAt: NOW - 90 * 60 * 1000,
      merchant: "Grab ride",
      source: "notification",
      confidence: 0.9,
    });
    return { out: outLeg, in: inLeg, sameWallet, sameDirection };
  }

  test("`Link as transfer` offers only opposite-direction rows from OTHER wallets", async () => {
    const legs = await transferLegs();
    await renderDetail(legs.out.id);

    fireEvent.press(screen.getByTestId("transfer-link-open"));
    await waitFor(() => expect(screen.getByTestId("transfer-candidate-picker")).toBeTruthy());

    expect(screen.getByTestId(`transfer-candidate-${legs.in.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`transfer-candidate-${legs.sameWallet.id}`)).toBeNull();
    expect(screen.queryByTestId(`transfer-candidate-${legs.sameDirection.id}`)).toBeNull();
    // And never itself.
    expect(screen.queryByTestId(`transfer-candidate-${legs.out.id}`)).toBeNull();
  });

  test("a transfer candidate's wallet-and-date caption does not clip to one line", async () => {
    // App-wide sweep for branch-review-correctness.md F2's defect class.
    // Wallet name has no length ceiling, and `formatDateTime` alone already
    // runs past 20 characters, so the combined caption can clip past one
    // line for a realistic wallet name — losing the date that disambiguates
    // same-wallet candidates. RNTL never simulates a device's line-clamp, so
    // only the rendered node's own `numberOfLines` proves it.
    const legs = await transferLegs();
    await renderDetail(legs.out.id);

    fireEvent.press(screen.getByTestId("transfer-link-open"));
    await waitFor(() => expect(screen.getByTestId("transfer-candidate-picker")).toBeTruthy());

    const caption = screen.getByText(`GCash · ${formatDateTime(legs.in.occurredAt)}`);
    expect(caption.props.numberOfLines).toBeGreaterThan(1);
  });

  test("linking takes the out-leg out of spend, and unlinking puts it back", async () => {
    const legs = await transferLegs();
    const window = { from: NOW - 7 * DAY_MS, to: NOW + DAY_MS };

    // Baseline: the out-leg and the same-direction decoy are both spend.
    const before = await sumSpend(window);
    expect(before).toBe(1_000_000);

    await renderDetail(legs.out.id);
    fireEvent.press(screen.getByTestId("transfer-link-open"));
    await waitFor(() => expect(screen.getByTestId("transfer-candidate-picker")).toBeTruthy());
    fireEvent.press(screen.getByTestId(`transfer-candidate-${legs.in.id}`));

    await waitFor(async () => expect(await sumSpend(window)).toBe(500_000));
    // Both legs carry the stamp — the stamp IS the exclusion.
    const linkedOut = await getTransaction(legs.out.id);
    const linkedIn = await getTransaction(legs.in.id);
    expect(linkedOut?.transferLinkId).not.toBeNull();
    expect(linkedIn?.transferLinkId).toBe(linkedOut?.transferLinkId);

    // …and now dissolve it.
    await waitFor(() => expect(screen.getByTestId("transfer-unlink")).toBeTruthy());
    fireEvent.press(screen.getByTestId("transfer-unlink"));

    // THE ASSERTION THAT MATTERS. `sumSpend` filters
    // `transfer_link_id IS NULL`, so a dissolved link whose legs were left
    // stamped leaves this figure at 500,000 — the ledger showing a ₱5,000
    // expense that no total in the app can account for.
    await waitFor(async () => expect(await sumSpend(window)).toBe(before));
    expect((await getTransaction(legs.out.id))?.transferLinkId).toBeNull();
    // `sumSpend` counts `direction = 'out'` only, so it cannot speak for the
    // in-leg at all. Its restoration is asserted directly: an unstamped leg is
    // one every income and day-net total counts again (invariant I2).
    expect((await getTransaction(legs.in.id))?.transferLinkId).toBeNull();
  });

  test("an already-linked transaction is offered Unlink, never a second link", async () => {
    const legs = await transferLegs();
    await linkTransfer(legs.out.id, legs.in.id, 0, { detectedBy: "auto", confidence: 0.95 });

    await renderDetail(legs.out.id);

    expect(screen.getByTestId("transfer-unlink")).toBeTruthy();
    // Two links over one leg is the state `sumSpend` cannot express and the
    // user cannot undo in one action.
    expect(screen.queryByTestId("transfer-link-open")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ARCHIVING IS THE ONLY REMOVAL PATH (wallets_repo has no delete), so an
// archived wallet's rows stay in the ledger for good. This screen used to call
// `useWallets()` — active wallets only — and every one of those rows read
// "Unknown wallet" on a wallet the app could name perfectly well. GAP-076.
// ---------------------------------------------------------------------------

describe("a row whose wallet has been archived", () => {
  test("names the wallet and marks it archived, rather than claiming it is unknown", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 50_000,
      direction: "out",
      occurredAt: NOW,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.95,
    });
    await archiveWallet(gcash.id);

    await renderDetail(tx.id);

    // A regex, not the exact string the active-wallet assertion above uses:
    // the row now carries the ARCHIVED chip alongside the name.
    expect(screen.getByTestId("transaction-detail-wallet")).toHaveTextContent(/GCash/);
    expect(screen.getByTestId("transaction-detail-wallet")).not.toHaveTextContent(
      /Unknown wallet/,
    );
    expect(screen.getByTestId("transaction-detail-wallet")).toHaveTextContent(/ARCHIVED/);
  });

  test("a transfer candidate in an archived wallet still carries its wallet name", async () => {
    const outLeg = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "out",
      occurredAt: NOW - 2 * 60 * 60 * 1000,
      merchant: "Transfer to GCash",
      source: "notification",
      confidence: 0.9,
    });
    const inLeg = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "in",
      occurredAt: NOW - 2 * 60 * 60 * 1000 + 30_000,
      merchant: "Cash in from BPI",
      source: "notification",
      confidence: 0.9,
    });
    await archiveWallet(gcash.id);

    await renderDetail(outLeg.id);

    fireEvent.press(screen.getByTestId("transfer-link-open"));
    await waitFor(() => expect(screen.getByTestId("transfer-candidate-picker")).toBeTruthy());

    // The candidate is still offered — the counterpart of a transfer is by
    // definition in another wallet, and an archived one is still a wallet the
    // money really moved through. Only its NAME was missing.
    expect(screen.getByTestId(`transfer-candidate-${inLeg.id}`)).toHaveTextContent(/GCash/);
    expect(screen.getByTestId(`transfer-candidate-${inLeg.id}`)).not.toHaveTextContent(
      /Unknown wallet/,
    );
  });
});

// ---------------------------------------------------------------------------
// Deleting a transaction (GAP-108) — the ledger half of review-queue rule 9,
// "committed results remain editable in the ledger indefinitely afterward".
//
// Rule 10 forbids the queue from ever deleting a committed row, so this screen
// is the ONLY way back from a mis-tapped Confirm. What is pinned here is what
// can only be true end to end: that the confirmation names what is about to go,
// that confirming it actually moves the wallet balance back, and that a leg the
// database will refuse is refused ON SCREEN with a sentence naming the transfer
// rather than as a foreign-key error the user cannot act on.
// ---------------------------------------------------------------------------

describe("deleting a transaction", () => {
  /** The button is disabled until the deletion plan has been read. */
  async function pressDelete(): Promise<void> {
    await waitFor(() =>
      expect(screen.getByTestId("transaction-delete").props.accessibilityState.disabled).toBe(
        false,
      ),
    );
    fireEvent.press(screen.getByTestId("transaction-delete"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeTruthy());
  }

  test("the confirmation names the row, the wallet and the balance consequence", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 66_261,
      direction: "out",
      occurredAt: NOW,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.95,
    });

    await renderDetail(tx.id);
    await pressDelete();

    // Amount, counterparty and wallet — the three things the user identifies
    // the row by. A dialog that only said "Delete this transaction?" would be
    // asking them to confirm from memory which row they had open.
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(/₱662\.61/);
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(/Jollibee/);
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(/GCash/);
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(
      /balance goes back to what it was/,
    );
  });

  test("confirming removes the row and gives the wallet its money back", async () => {
    const before = (await getWallet(gcash.id))?.balance ?? 0;
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 66_261,
      direction: "out",
      occurredAt: NOW,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.95,
    });
    expect((await getWallet(gcash.id))?.balance).toBe(before - 66_261);

    await renderDetail(tx.id);
    await pressDelete();
    await act(async () => {
      fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
    });

    // The database, not the screen: the row is what every total reads.
    await waitFor(async () => expect(await getTransaction(tx.id)).toBeNull());
    expect((await getWallet(gcash.id))?.balance).toBe(before);
    expect(await sumSpend({ from: NOW - DAY_MS, to: NOW + DAY_MS })).toBe(0);
    // And the screen leaves, because there is nothing left on it to show.
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  test("cancelling leaves the row exactly where it was", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 66_261,
      direction: "out",
      occurredAt: NOW,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.95,
    });
    const balance = (await getWallet(gcash.id))?.balance;

    await renderDetail(tx.id);
    await pressDelete();
    fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));

    expect(await getTransaction(tx.id)).not.toBeNull();
    expect((await getWallet(gcash.id))?.balance).toBe(balance);
    expect(mockBack).not.toHaveBeenCalled();
  });

  test("a row matched to a loan says the loan balance goes back up", async () => {
    const loan = await createLoan({
      direction: "i-owe",
      counterparty: "Juan Dela Cruz",
      principal: 500_000,
    });
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 50_000,
      direction: "out",
      occurredAt: NOW,
      merchant: "JUAN D",
      source: "notification",
      confidence: 0.95,
    });
    await recordPayment({ loanId: loan.id, transactionId: tx.id });

    await renderDetail(tx.id);
    await pressDelete();

    // Naming the counterparty is the point: "a loan payment is removed" gives
    // the user no way to tell whether it is the loan they meant.
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(/Juan Dela Cruz/);

    await act(async () => {
      fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
    });

    await waitFor(async () => expect(await getTransaction(tx.id)).toBeNull());
    expect(await outstandingBalance(loan.id)).toBe(500_000);
  });

  test("a row matched to a bill says the cycle goes back to unpaid", async () => {
    const bill = await createBill({
      name: "Meralco",
      amount: 235_000,
      amountMode: "estimated",
      dueRule: { kind: "day-of-month", day: 20 },
    });
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 235_000,
      direction: "out",
      occurredAt: NOW,
      merchant: "MERALCO",
      source: "notification",
      confidence: 0.95,
    });
    await recordBillPayment({ billId: bill.id, dueDate: "2026-09-20", transactionId: tx.id });

    await renderDetail(tx.id);
    await pressDelete();

    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(/Meralco/);
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(/back to unpaid/);

    await act(async () => {
      fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
    });

    await waitFor(async () => expect(await getTransaction(tx.id)).toBeNull());
    expect(await getCycle(bill.id, "2026-09-20")).toBeNull();
  });

  test("a transfer leg refuses on screen, naming the wallet on the other side", async () => {
    const outLeg = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "out",
      occurredAt: NOW - 60_000,
      merchant: "Transfer to GCash",
      source: "notification",
      confidence: 0.9,
    });
    const inLeg = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "in",
      occurredAt: NOW,
      merchant: "Cash in from BPI",
      source: "notification",
      confidence: 0.9,
    });
    await linkTransfer(outLeg.id, inLeg.id, 0);

    await renderDetail(outLeg.id);

    // THE SENTENCE IS THE TEST. `transfer_links` holds two NOT NULL foreign
    // keys onto `transactions(id)` with no ON DELETE action, so the alternative
    // to this notice is "FOREIGN KEY constraint failed" on a toast — a message
    // naming nothing the user can do anything about.
    await waitFor(() =>
      expect(screen.getByTestId("transaction-delete-blocked")).toHaveTextContent(/GCash/),
    );
    expect(screen.getByTestId("transaction-delete-blocked")).toHaveTextContent(
      /Not a transfer/,
    );
    // And the button cannot be taken up on an offer it would have to break.
    expect(screen.getByTestId("transaction-delete").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("transaction-delete"));
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(await getTransaction(outLeg.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Device-testing fix, Task 2 follow-up (2026-08-18) — the survey run for
// Task 2 (app/__tests__/wallet_routes.test.tsx) found this screen applying
// the same defect: safe-area insets on the ScrollView's `style` prop, which
// pads the outer frame rather than the scrolling content, so the header
// could render under the status bar and the panel's bottom could scroll in
// behind Android's navigation bar. See app/transaction/[id].tsx for the fix.
//
// ON-DEVICE GATE: this asserts the inset values reach the outer View's
// `style` — the prop React Native actually reads to size and position it.
// It cannot prove content is physically above the nav bar; that is an A54
// screenshot check.
// ---------------------------------------------------------------------------

describe("system-bar clearance", () => {
  test("transaction detail pads its content for both system bars", async () => {
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 50_000,
      direction: "out",
      occurredAt: NOW,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.95,
    });

    renderDetailWithInsets(tx.id);
    await waitFor(() => expect(screen.getByTestId("transaction-detail")).toBeTruthy());

    expect(paddingOf(screen.getByTestId("transaction-detail"))).toEqual({
      top: INSET_TOP,
      bottom: INSET_BOTTOM,
    });
    // NOT on the ScrollView: `style` there pads its OUTER FRAME, not the
    // content that scrolls inside it — the exact defect this fixes. A
    // same-valued assertion on `testID="transaction-detail"` alone would
    // pass whether the insets sit on the ScrollView or the outer View
    // around it; this is what actually tells the two apart.
    expect(paddingOf(screen.UNSAFE_getByType(ScrollView))).toEqual({
      top: undefined,
      bottom: undefined,
    });
  });
});
