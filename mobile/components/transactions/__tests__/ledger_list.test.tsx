// components/transactions/__tests__/ledger_list.test.tsx — m1c plan Task 6.
//
// THE LEDGER IS THE SCREEN THE WHOLE PRODUCT EXISTS TO PRODUCE. The listener,
// the nine pipeline stages and the encryption are all machinery for putting
// correct rows on this list, so the assertions here are the ones that decide
// whether any of that was worth doing.
//
// FOUR OF THEM MATTER MORE THAN THE REST:
//
//   A TRANSFER LEG IS MUTED *AND* LABELLED. Both halves, always. Muting alone
//   is a convention the user has to learn; the sentence "Transfer — not counted
//   as spending" explains it once. A user who believes moving ₱5,000 from BPI to
//   GCash is spending will not trust any total in this app, and they would be
//   right not to — their arithmetic and the app's would permanently disagree.
//
//   A TRANSFER LEG IS NOT IN THE DAY'S NET. If it were, the header would
//   contradict the label on the row directly beneath it.
//
//   THE DAY'S NET IS SIGNED. ₱100 in and ₱100 out is ₱0.00, not ₱200.00.
//
//   THE TWO EMPTY STATES ARE NEVER CONFLATED. Telling a user with a full ledger
//   that nothing was tracked, because a filter happened to match nothing, is the
//   most alarming false statement a money app can make. Each case asserts the
//   OTHER one's copy is absent.
//
// Everything here is presentational: rows, categories and wallets arrive as
// props and no database is opened. Timestamps are built with `new Date(y, m, d)`
// — LOCAL time, matching the local calendar grouping under test, so the file
// passes in any timezone.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import { Text } from "react-native";

import { __setTierForTests } from "@/lib/entitlements";
import type { Category, Transaction, Wallet } from "@/types/domain";

import {
  dayNet,
  groupByDay,
  LEDGER_EMPTY_BODY,
  LEDGER_EMPTY_TITLE,
  LEDGER_FILTERED_EMPTY_TITLE,
  LedgerList,
  localDateKey,
  matchesSearch,
} from "../ledger_list";
import { TRANSFER_LABEL } from "../transaction_row";

const MINUS = "−";

const AUG_13_9AM = new Date(2026, 7, 13, 9, 0).getTime();
const AUG_13_6PM = new Date(2026, 7, 13, 18, 0).getTime();
const AUG_12_NOON = new Date(2026, 7, 12, 12, 0).getTime();
const AUG_11_NOON = new Date(2026, 7, 11, 12, 0).getTime();
/** The clock the header labels "Today" from. Injected, never `Date.now()`. */
const NOW = new Date(2026, 7, 13, 21, 0).getTime();

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    walletId: "w1",
    categoryId: "cat_food_dining",
    amount: 10_000,
    direction: "out",
    occurredAt: AUG_13_9AM,
    merchant: "Jollibee",
    counterparty: null,
    referenceNo: null,
    source: "notification",
    confidence: 0.9,
    rawNotificationId: null,
    transferLinkId: null,
    note: null,
    balanceAfter: null,
    computedBalance: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const WALLETS: Wallet[] = [
  {
    id: "w1",
    name: "GCash",
    type: "e-wallet",
    balance: 100_000,
    currency: "PHP",
    isArchived: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "w2",
    name: "BPI",
    type: "bank",
    balance: 500_000,
    currency: "PHP",
    isArchived: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
];

const CATEGORIES: Category[] = [
  {
    id: "cat_food_dining",
    name: "Food & Dining",
    parentId: null,
    icon: "utensils",
    isSystem: true,
    isHidden: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "cat_transport",
    name: "Transport",
    parentId: null,
    icon: "bus",
    isSystem: true,
    isHidden: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
];

function renderLedger(
  transactions: Transaction[] | undefined,
  props: Partial<ComponentProps<typeof LedgerList>> = {},
) {
  return render(
    <LedgerList
      transactions={transactions}
      wallets={WALLETS}
      categories={CATEGORIES}
      now={NOW}
      {...props}
    />,
  );
}

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

afterEach(() => {
  __setTierForTests(null);
});

// ---------------------------------------------------------------------------
// Grouping — the pure functions, then the rendered order
// ---------------------------------------------------------------------------

describe("localDateKey", () => {
  test("keys by the LOCAL calendar day, not by UTC", () => {
    // `new Date(ms).toISOString().slice(0, 10)` is the tempting one-liner and it
    // is wrong east of Greenwich: 7am in Manila is the PREVIOUS day in UTC, so a
    // morning coffee would file itself under yesterday for every user in the
    // country this app is built for.
    const nineAm = new Date(2026, 7, 13, 9, 0);
    expect(localDateKey(nineAm.getTime())).toBe("2026-08-13");
  });

  test("pads month and day so keys sort lexically", () => {
    expect(localDateKey(new Date(2026, 0, 5, 12, 0).getTime())).toBe("2026-01-05");
  });
});

describe("groupByDay", () => {
  test("orders days newest first and rows newest first inside a day", () => {
    // SEEDED OUT OF ORDER on purpose. Given already-sorted input, an
    // implementation that merely preserves insertion order passes — and then
    // silently reverses the ledger the first time a caller hands it anything
    // else.
    const groups = groupByDay([
      tx({ id: "t-old", occurredAt: AUG_11_NOON }),
      tx({ id: "t-morning", occurredAt: AUG_13_9AM }),
      tx({ id: "t-mid", occurredAt: AUG_12_NOON }),
      tx({ id: "t-evening", occurredAt: AUG_13_6PM }),
    ]);

    expect(groups.map((group) => group.date)).toEqual(["2026-08-13", "2026-08-12", "2026-08-11"]);
    expect(groups[0].transactions.map((row) => row.id)).toEqual(["t-evening", "t-morning"]);
  });

  test("breaks an occurredAt tie with createdAt, newest first", () => {
    // Two notifications for the same instant — the second one to arrive is the
    // one the user just watched happen, so it belongs on top.
    const groups = groupByDay([
      tx({ id: "first", occurredAt: AUG_13_9AM, createdAt: 1_000 }),
      tx({ id: "second", occurredAt: AUG_13_9AM, createdAt: 2_000 }),
    ]);

    expect(groups[0].transactions.map((row) => row.id)).toEqual(["second", "first"]);
  });

  test("does not mutate the caller's array", () => {
    const rows = [tx({ id: "a", occurredAt: AUG_11_NOON }), tx({ id: "b", occurredAt: AUG_13_9AM })];
    groupByDay(rows);
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("dayNet", () => {
  test("is SIGNED — ₱100 in and ₱100 out is zero, not ₱200", () => {
    // The single arithmetic bug that would make every day header in the app
    // read as a gross turnover figure while looking perfectly plausible.
    expect(
      dayNet([
        tx({ id: "in", direction: "in", amount: 10_000 }),
        tx({ id: "out", direction: "out", amount: 10_000 }),
      ]),
    ).toBe(0);
  });

  test("a spending day is negative", () => {
    expect(dayNet([tx({ direction: "out", amount: 10_000 })])).toBe(-10_000);
  });

  test("EXCLUDES transfer legs (invariant I2)", () => {
    // Otherwise the header contradicts the label on the row beneath it.
    expect(
      dayNet([
        tx({ id: "spend", direction: "out", amount: 10_000 }),
        tx({ id: "leg", direction: "out", amount: 500_000, transferLinkId: "link-1" }),
      ]),
    ).toBe(-10_000);
  });
});

describe("matchesSearch", () => {
  test("matches the merchant", () => {
    expect(matchesSearch(tx({ merchant: "Jollibee" }), "jolli")).toBe(true);
  });

  test("matches the NOTE as well as the merchant", () => {
    // Searching one field only is the failure this guards: the user reads an
    // empty result as "I never spent that".
    expect(matchesSearch(tx({ merchant: null, note: "birthday gift" }), "birthday")).toBe(true);
  });

  test("matches the counterparty, which can be the row's own title", () => {
    expect(matchesSearch(tx({ merchant: null, counterparty: "Juan Dela Cruz" }), "juan")).toBe(true);
  });

  test("is case-insensitive and ignores surrounding whitespace", () => {
    expect(matchesSearch(tx({ merchant: "Jollibee" }), "  JOLLIBEE ")).toBe(true);
  });

  test("an empty query matches everything", () => {
    expect(matchesSearch(tx({ merchant: null, note: null }), "")).toBe(true);
    expect(matchesSearch(tx({ merchant: null, note: null }), "   ")).toBe(true);
  });

  test("a miss is a miss", () => {
    expect(matchesSearch(tx({ merchant: "Jollibee", note: "lunch" }), "meralco")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The rendered list
// ---------------------------------------------------------------------------

describe("day grouping on screen", () => {
  test("renders one header per day, newest day first, rows newest first within it", () => {
    renderLedger([
      tx({ id: "t3", occurredAt: AUG_11_NOON, merchant: "Grab" }),
      tx({ id: "t1", occurredAt: AUG_13_9AM, merchant: "Jollibee" }),
      tx({ id: "t2", occurredAt: AUG_13_6PM, merchant: "Meralco" }),
    ]);

    const headers = screen.getAllByTestId(/^day-group-\d{4}-\d{2}-\d{2}$/);
    expect(headers.map((header) => header.props.testID)).toEqual([
      "day-group-2026-08-13",
      "day-group-2026-08-11",
    ]);

    const rows = screen.getAllByTestId(/^transaction-row-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      "transaction-row-t2",
      "transaction-row-t1",
      "transaction-row-t3",
    ]);
  });

  test("today's header says Today, and yesterday's says Yesterday", () => {
    renderLedger([
      tx({ id: "t1", occurredAt: AUG_13_9AM }),
      tx({ id: "t2", occurredAt: AUG_12_NOON }),
    ]);

    // Regexes, not strings: `toHaveTextContent` matches a string EXACTLY, and
    // the header also carries "Net" and the day's figure.
    expect(screen.getByTestId("day-group-2026-08-13")).toHaveTextContent(/^Today/);
    expect(screen.getByTestId("day-group-2026-08-12")).toHaveTextContent(/^Yesterday/);
  });

  test("an older day carries its full date, year included", () => {
    // The year is not decoration: a ledger scrolled back past a January stops
    // being unambiguous without it.
    renderLedger([tx({ id: "t1", occurredAt: AUG_11_NOON })]);
    expect(screen.getByTestId("day-group-2026-08-11")).toHaveTextContent(/^Aug 11, 2026/);
  });

  test("the header shows the day's NET, signed", () => {
    renderLedger([
      tx({ id: "in", direction: "in", amount: 10_000, occurredAt: AUG_13_9AM }),
      tx({ id: "out", direction: "out", amount: 10_000, occurredAt: AUG_13_6PM }),
    ]);

    // ₱200.00 here means the day is being summed without signs.
    expect(screen.getByTestId("day-group-2026-08-13-net")).toHaveTextContent("₱0.00");
  });

  test("a transfer leg's amount is NOT added to the day's net", () => {
    // The header would otherwise contradict the label on the row below it.
    renderLedger([
      tx({ id: "spend", direction: "out", amount: 10_000, occurredAt: AUG_13_9AM }),
      tx({
        id: "leg",
        direction: "out",
        amount: 500_000,
        occurredAt: AUG_13_6PM,
        transferLinkId: "link-1",
      }),
    ]);

    expect(screen.getByTestId("day-group-2026-08-13-net")).toHaveTextContent("-₱100.00");
    expect(screen.getByTestId("day-group-2026-08-13-net")).not.toHaveTextContent("₱5,100.00");
  });
});

describe("a transaction row", () => {
  test("shows the merchant, the category chip, the wallet and the signed amount", () => {
    renderLedger([tx({ id: "t1", merchant: "Jollibee", amount: 12_345 })]);

    expect(screen.getByText("Jollibee")).toBeTruthy();
    expect(screen.getByTestId("transaction-category-t1")).toHaveTextContent("Food & Dining");
    expect(screen.getByText("GCash")).toBeTruthy();
    expect(screen.getByTestId("transaction-amount-t1")).toHaveTextContent(`${MINUS}₱123.45`);
  });

  test("an `out` row renders a true minus, never a hyphen", () => {
    renderLedger([tx({ id: "t1", direction: "out", amount: 12_345 })]);

    const amount = screen.getByTestId("transaction-amount-t1");
    expect(amount).toHaveTextContent(`${MINUS}₱123.45`);
    expect(String(amount.props.children)).not.toContain("-₱");
  });

  test("an `in` row renders a plus and the brand colour", () => {
    renderLedger([tx({ id: "t1", direction: "in", amount: 12_345 })]);

    expect(screen.getByTestId("transaction-amount-t1")).toHaveTextContent("+₱123.45");
    expect(classesOf("transaction-amount-t1")).toContain("text-brand");
  });

  test("falls back to the counterparty when there is no merchant", () => {
    renderLedger([tx({ id: "t1", merchant: null, counterparty: "Juan Dela Cruz" })]);
    expect(screen.getByText("Juan Dela Cruz")).toBeTruthy();
  });

  test("falls back to the CATEGORY NAME when there is neither, never to blank", () => {
    renderLedger([
      tx({ id: "t1", merchant: null, counterparty: null, categoryId: "cat_transport" }),
    ]);
    // Rule 2's last fallback. A blank title on a money row is a row the user
    // cannot identify at all.
    //
    // TWICE, and the count is the assertion: once as the row's title and once
    // in the category chip. A row that fell back to a placeholder like
    // "Transaction", or to nothing, leaves only the chip.
    expect(screen.getAllByText("Transport")).toHaveLength(2);
  });

  test("an unknown category still renders a chip rather than an empty pill", () => {
    renderLedger([tx({ id: "t1", categoryId: "cat_not_loaded_yet" })]);
    expect(screen.getByTestId("transaction-category-t1")).toHaveTextContent("Uncategorized");
  });
});

describe("a transfer leg — the single most important row state", () => {
  const LEG = tx({
    id: "t1",
    direction: "out",
    amount: 500_000,
    transferLinkId: "link-1",
    merchant: "Transfer to BPI",
  });

  test("renders MUTED and carries the not-counted label — both halves", () => {
    // Muting alone is a convention the user has to learn. The sentence explains
    // it once. Either half missing fails here.
    renderLedger([LEG]);

    expect(classesOf("transaction-amount-t1")).toContain("text-fg-2");
    expect(classesOf("transaction-amount-t1")).not.toContain("text-fg dark:text-fg-dark");
    expect(screen.getByTestId("transaction-transfer-t1")).toHaveTextContent(
      "Transfer — not counted as spending",
    );
  });

  test("the label is the exact spec sentence", () => {
    renderLedger([LEG]);
    expect(TRANSFER_LABEL).toBe("Transfer — not counted as spending");
    expect(screen.getByText(TRANSFER_LABEL)).toBeTruthy();
  });

  test("an ordinary row is NOT muted and carries no such label", () => {
    // The other direction of the same rule: labelling ordinary spending as
    // "not counted" would understate what the user is spending.
    renderLedger([tx({ id: "t1", transferLinkId: null })]);

    expect(classesOf("transaction-amount-t1")).not.toContain("text-fg-2");
    expect(screen.queryByTestId("transaction-transfer-t1")).toBeNull();
    expect(screen.queryByText(TRANSFER_LABEL)).toBeNull();
  });

  test("an INCOMING leg is muted too — a transfer is not income either", () => {
    renderLedger([tx({ id: "t1", direction: "in", amount: 500_000, transferLinkId: "link-1" })]);

    expect(classesOf("transaction-amount-t1")).toContain("text-fg-2");
    expect(classesOf("transaction-amount-t1")).not.toContain("text-brand");
    expect(screen.getByTestId("transaction-transfer-t1")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Client-side search
// ---------------------------------------------------------------------------

describe("search over the loaded rows", () => {
  const ROWS = [
    tx({ id: "t1", merchant: "Jollibee", note: null }),
    tx({ id: "t2", merchant: "Meralco", note: "August bill", occurredAt: AUG_13_6PM }),
    tx({ id: "t3", merchant: null, note: "birthday gift", occurredAt: AUG_12_NOON }),
  ];

  test("narrows the list by merchant", () => {
    renderLedger(ROWS, { search: "meralco" });

    expect(screen.getByTestId("transaction-row-t2")).toBeTruthy();
    expect(screen.queryByTestId("transaction-row-t1")).toBeNull();
  });

  test("narrows the list by NOTE, not by merchant alone", () => {
    renderLedger(ROWS, { search: "birthday" });

    expect(screen.getByTestId("transaction-row-t3")).toBeTruthy();
    expect(screen.queryByTestId("transaction-row-t1")).toBeNull();
    expect(screen.queryByTestId("transaction-row-t2")).toBeNull();
  });

  test("a day that loses every row loses its header too", () => {
    // An empty day header with a net of ₱0.00 under it reads as "you spent
    // nothing that day", which is a different and false statement.
    renderLedger(ROWS, { search: "birthday" });

    expect(screen.queryByTestId("day-group-2026-08-13")).toBeNull();
    expect(screen.getByTestId("day-group-2026-08-12")).toBeTruthy();
  });

  test("the day net reflects only the rows still on screen", () => {
    renderLedger(ROWS, { search: "jollibee" });
    expect(screen.getByTestId("day-group-2026-08-13-net")).toHaveTextContent("-₱100.00");
  });
});

// ---------------------------------------------------------------------------
// The two empty states — never conflated (rule 6)
// ---------------------------------------------------------------------------

describe("empty states", () => {
  test("no transactions at all says nothing has been tracked", () => {
    renderLedger([]);

    expect(screen.getByTestId("ledger-empty")).toBeTruthy();
    expect(screen.getByText(LEDGER_EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByText(LEDGER_EMPTY_BODY)).toBeTruthy();
    // And NOT the filtered copy — there is no filter.
    expect(screen.queryByText(LEDGER_FILTERED_EMPTY_TITLE)).toBeNull();
    expect(screen.queryByTestId("ledger-empty-filtered")).toBeNull();
  });

  test("a filter that matches nothing says SO, and never claims nothing was tracked", () => {
    // The most alarming false statement a money app can make: telling a user
    // with a full ledger that the app recorded nothing.
    renderLedger([], { filtered: true });

    expect(screen.getByTestId("ledger-empty-filtered")).toBeTruthy();
    expect(screen.getByText(LEDGER_FILTERED_EMPTY_TITLE)).toBeTruthy();
    expect(screen.queryByText(LEDGER_EMPTY_TITLE)).toBeNull();
    expect(screen.queryByTestId("ledger-empty")).toBeNull();
  });

  test("a SEARCH that matches nothing is a filtered empty, not an empty ledger", () => {
    // Rows exist; the query missed them. Same rule, reached by the other input.
    renderLedger([tx({ id: "t1", merchant: "Jollibee" })], { search: "meralco" });

    expect(screen.getByTestId("ledger-empty-filtered")).toBeTruthy();
    expect(screen.queryByText(LEDGER_EMPTY_TITLE)).toBeNull();
  });

  test("the two copies are genuinely different strings", () => {
    expect(LEDGER_EMPTY_TITLE).not.toBe(LEDGER_FILTERED_EMPTY_TITLE);
  });

  test("a caller may supply its own empty state (the wallet detail does)", () => {
    renderLedger([], { empty: <Text testID="wallet-detail-no-transactions">Nothing here</Text> });

    expect(screen.getByTestId("wallet-detail-no-transactions")).toBeTruthy();
    expect(screen.queryByTestId("ledger-empty")).toBeNull();
  });

  test("still loading renders NEITHER empty state", () => {
    // An empty state that flashes before the first read resolves reads as data
    // loss on the one screen whose whole job is to be trusted about money.
    renderLedger(undefined);

    expect(screen.queryByTestId("ledger-empty")).toBeNull();
    expect(screen.queryByTestId("ledger-empty-filtered")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The free-tier history boundary (rule 5; docs/05-monetization.md §3.2)
// ---------------------------------------------------------------------------

describe("the 90-day history boundary row", () => {
  test("FREE renders it, driven by historyWindowDays()", () => {
    __setTierForTests("free");
    renderLedger([tx({ id: "t1" })]);

    const cutoff = screen.getByTestId("ledger-history-cutoff");
    expect(cutoff).toBeTruthy();
    // The window comes from entitlements, not from a literal in the component.
    expect(cutoff).toHaveTextContent(/90 days/);
    // Spec §3.2: older records exist and are SAFE. A boundary row that only
    // advertises Plus, without saying the data is retained, reads as "your
    // history was deleted".
    expect(cutoff).toHaveTextContent(/still saved/i);
  });

  test("PLUS renders nothing — paying users are never told their history is truncated", () => {
    __setTierForTests("plus");
    renderLedger([tx({ id: "t1" })]);

    expect(screen.queryByTestId("ledger-history-cutoff")).toBeNull();
  });

  test("an EMPTY ledger renders no boundary row, on either tier", () => {
    // docs/06-information-architecture.md §5: empty states are "calm, not
    // salesy — no upgrade prompts in any empty state".
    __setTierForTests("free");
    renderLedger([]);

    expect(screen.queryByTestId("ledger-history-cutoff")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Opening a row (m1c Task 7)
//
// Task 6 shipped these rows INERT on purpose: app/transaction/[id].tsx did not
// exist yet, and a dead tap on the most-tapped list in the app is worse than an
// obviously static one. That route exists now, so the rows open it — but the
// list still navigates NOTHING itself. It reports the row that was pressed and
// the screen decides where that goes, which is what keeps this file free of a
// router and keeps the two screens rendering the same list.
// ---------------------------------------------------------------------------

describe("opening a transaction", () => {
  test("pressing a row reports THAT row, not its index or its id alone", () => {
    const onSelect = jest.fn();
    const jollibee = tx({ id: "t1", merchant: "Jollibee" });
    const grab = tx({ id: "t2", merchant: "Grab", occurredAt: AUG_13_6PM });
    renderLedger([jollibee, grab], { onSelect });

    fireEvent.press(screen.getByTestId("transaction-row-t2"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(grab);
  });

  test("a transfer leg opens too — it is the row most likely to need explaining", () => {
    const onSelect = jest.fn();
    const leg = tx({ id: "t9", transferLinkId: "link-1" });
    renderLedger([leg], { onSelect });

    fireEvent.press(screen.getByTestId("transaction-row-t9"));

    expect(onSelect).toHaveBeenCalledWith(leg);
  });

  test("without a handler the row is not pressable, and pressing it throws nothing", () => {
    // The wallet detail and the Transactions tab both pass one. A third caller
    // that forgets gets a plain row rather than a tap that silently does
    // nothing — the state Task 6 chose deliberately.
    renderLedger([tx({ id: "t1" })]);

    const row = screen.getByTestId("transaction-row-t1");
    expect(row.props.onStartShouldSetResponder).toBeUndefined();
    expect(() => fireEvent.press(row)).not.toThrow();
  });
});
