// components/wallets/__tests__/balance_correction_sheet.test.tsx — review fix
// (2026-08-18). BalanceCorrectionSheet had no suite of its own; the only
// assertions touching it were two `getByTestId` calls inside
// wallet_detail.test.tsx, which could not have caught the rule-3
// notification-wins disclosure being deleted, or either wallet-type guard
// being loosened, without failing for an unrelated reason.
// cash_reconcile_sheet.test.tsx is the model this mirrors: its clone gets the
// same rigor, tested end to end against a real (in-memory) database rather
// than a mocked mutation, for the same reason that file gives — this is a
// flow that writes money the user did not itemize.
//
// SAME MATH, VERIFIED THROUGH THIS SHEET, NOT RE-DERIVED. `cashAdjustment`
// (lib/wallets/reconcile.ts) is reused by `useCorrectWalletBalance`, not
// re-implemented — these tests exercise that reuse through the sheet's own
// interaction rather than re-testing the pure function a second time.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Modal } from "react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { BALANCE_CORRECTION_NOTE } from "@/hooks/mutations/use_correct_wallet_balance";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { setMatchers as setWalletMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { setWalletOwed } from "@/lib/db/repos/wallet_traits_repo";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
import type { Transaction, Wallet } from "@/types/domain";

import { BalanceCorrectionSheet } from "../balance_correction_sheet";

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

// A ROOT KeypadHost, MOUNTED BEFORE THE SHEET (numeric-input-system Task 13).
// The amount is a NumericField now, and its `useKeypad()` throws with no
// provider above it. bottom_sheet.tsx mounts a SECOND host inside its Modal,
// and this root one is here so the suite proves the SHEET's host wins rather
// than merely being the only one present: the context gives the panel to the
// highest live token and effects flush in completion order, so the host
// declared FIRST registers the LOWER token and the Modal's host outranks it.
// Mounted after the sheet it would win instead — and on a device the panel
// would paint behind the dialog with every test still green.
function renderSheet(wallet: Wallet): void {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <KeypadProvider>
          <KeypadHost />
          {children}
        </KeypadProvider>
      </QueryClientProvider>
    );
  }
  render(<BalanceCorrectionSheet wallet={wallet} visible onDismiss={jest.fn()} />, {
    wrapper: Wrapper,
  });
}

/**
 * Keys the stated figure IN PESOS on the app's own keypad, then confirms.
 *
 * Every caller's keystrokes shrank by two digits (numeric-input-system Task
 * 13) and not one of the amounts they assert moved: ₱500.00 was "50000" and
 * is now "500", because a digit is a peso rather than a centavo.
 */
async function correct(pesos: string): Promise<void> {
  typeAmount("balance-correction-amount", pesos);
  fireEvent.press(screen.getByTestId("balance-correction-confirm"));
}

/** Every transaction on the device, oldest first, for before/after comparison. */
async function ledger(): Promise<Transaction[]> {
  const transactions = await listTransactions({});
  return [...transactions].sort((a, b) => a.id.localeCompare(b.id));
}

let gcash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  // ₱1,000.00 opening, minus a ₱200.00 spend the app DID see → recorded ₱800.00.
  gcash = await createWallet({ name: "GCash", openingBalance: 100_000 });
  // A REAL MATCHER. This sheet is for wallets a PROVIDER reports on — a wallet
  // nothing routes to gets the cash reconcile sheet instead — so the fixture
  // has to actually be one, or every test below renders nothing at all.
  await setWalletMatchers(gcash.id, [{ packageName: "com.globe.gcash.android", hint: null }]);
  gcash = (await getWallet(gcash.id)) as Wallet;
  await insertTransaction({
    walletId: gcash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 20_000,
    direction: "out",
    occurredAt: 1_786_000_000_000,
    source: "manual",
    confidence: 1,
    merchant: "Jollibee",
  });
  gcash = (await getWallet(gcash.id)) as Wallet;
});

afterEach(async () => {
  await closeDatabase();
});

test("the sheet asks what the wallet actually has and states the recorded figure", () => {
  renderSheet(gcash);

  expect(screen.getByTestId("balance-correction-sheet")).toHaveTextContent(
    /What does this wallet actually have right now\?/,
  );
  expect(screen.getByTestId("balance-correction-recorded")).toHaveTextContent("₱800.00");
});

// ---------------------------------------------------------------------------
// Rule 3's required disclosure — the agreed resolution to the notification-
// wins conflict. Present BEFORE any input, not conjured only after a save, or
// a user who reads and dismisses without typing anything never saw it. This
// is the assertion the reviewer named directly: delete the `Text` at the
// sheet's `:118` and every OTHER test in this file still passes, because none
// of them touch it.
// ---------------------------------------------------------------------------

test("the notification-wins disclosure is shown before any input, not just after confirming", () => {
  renderSheet(gcash);

  const warning = screen.getByTestId("balance-correction-warning");
  expect(warning).toHaveTextContent(/starting point, not a bank-confirmed figure/i);
  expect(warning).toHaveTextContent(/report will replace this correction/i);
  // The second-order effect folded in alongside the credit exclusion: the
  // entry survives that re-anchor. It used to add "and still counts toward
  // your totals", which was accurate and was the bug the owner reported on
  // 2026-08-30 — a correction reported as a −₱4,964.60 expense. Since
  // 017_transaction_adjustments the row stays and does not count, and the
  // sentence says so.
  expect(warning).toHaveTextContent(/stays in your ledger/i);
  expect(warning).toHaveTextContent(/does not count as spending or income/i);
  expect(warning).not.toHaveTextContent(/still counts toward your totals/i);
});

// ---------------------------------------------------------------------------
// The keypad (numeric-input-system Task 13). A sheet is a Modal — its own
// native window — so which host draws the panel is not a detail: the root one
// paints BEHIND the dialog.
// ---------------------------------------------------------------------------

describe("the corrected balance is keyed on the app's own keypad", () => {
  test("the panel opens INSIDE the sheet's Modal, not behind it", () => {
    renderSheet(gcash);

    fireEvent.press(screen.getByTestId("balance-correction-amount"));

    // Scoped to the Modal deliberately: a bare `getAllByTestId("keypad-host")`
    // of length one cannot tell the sheet's host from the root one, which is
    // exactly the mix-up that would ship a panel nobody can reach.
    expect(within(screen.UNSAFE_getByType(Modal)).getByTestId("keypad-host")).toBeTruthy();
    expect(screen.getByTestId("keypad-label")).toHaveTextContent("This wallet's actual balance");
  });

  test("a digit is a PESO — 100000 states a hundred thousand, not a thousand", async () => {
    // The workstream's headline behaviour change, on the sheet whose entire
    // job is entering a corrected balance. Recorded ₱800.00, stated
    // ₱100,000.00 → ₱99,200.00 arrived that the app never saw.
    renderSheet(gcash);

    typeAmount("balance-correction-amount", "100000");

    expect(screen.getByTestId("balance-correction-preview")).toHaveTextContent("₱100,000.00");

    fireEvent.press(screen.getByTestId("balance-correction-confirm"));
    await waitFor(async () => {
      expect((await getWallet(gcash.id))?.balance).toBe(10_000_000);
    });
  });

  test("a fraction needs an explicit decimal point", async () => {
    renderSheet(gcash);

    await correct("500.25");

    await waitFor(async () => {
      expect((await getWallet(gcash.id))?.balance).toBe(50_025);
    });
  });
});

describe("the adjustment it writes", () => {
  test("a shortfall writes ONE `out` transaction for the DIFFERENCE", async () => {
    // Recorded ₱800.00, actual ₱500.00 → ₱300.00 the app never saw leave.
    renderSheet(gcash);
    await correct("500");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: gcash.id })).toHaveLength(2);
    });

    const written = (await listTransactions({ walletId: gcash.id })).find(
      (transaction) => transaction.note === BALANCE_CORRECTION_NOTE,
    );
    expect(written).toBeDefined();
    expect(written?.direction).toBe("out");
    // 30000, not 50000 (the stated total) and not 80000 (the recorded one).
    expect(written?.amount).toBe(30_000);
  });

  test("a surplus writes ONE `in` transaction for the DIFFERENCE", async () => {
    renderSheet(gcash);
    await correct("950");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: gcash.id })).toHaveLength(2);
    });

    const written = (await listTransactions({ walletId: gcash.id })).find(
      (transaction) => transaction.note === BALANCE_CORRECTION_NOTE,
    );
    expect(written?.direction).toBe("in");
    expect(written?.amount).toBe(15_000);
  });

  test("the wallet lands exactly on the figure the user typed", async () => {
    renderSheet(gcash);
    await correct("500");

    await waitFor(async () => {
      expect((await getWallet(gcash.id))?.balance).toBe(50_000);
    });
  });

  test("it is a manual, recategorizable, uncategorized entry with no balanceAfter", async () => {
    renderSheet(gcash);
    await correct("500");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: gcash.id })).toHaveLength(2);
    });

    const written = (await listTransactions({ walletId: gcash.id })).find(
      (transaction) => transaction.note === BALANCE_CORRECTION_NOTE,
    );
    expect(written?.source).toBe("manual");
    expect(written?.confidence).toBe(1);
    expect(written?.rawNotificationId).toBeNull();
    expect(written?.categoryId).toBe(UNCATEGORIZED_ID);
    // No provider reported this — the sheet's own header on why setting one
    // here would let the drift badge treat a guess as bank-confirmed.
    expect(written?.balanceAfter).toBeNull();
  });

  test("a figure equal to the recorded balance writes NOTHING — the preview === null money path", async () => {
    const before = await ledger();
    renderSheet(gcash);

    await correct("800");

    await waitFor(() => {
      expect(screen.getByTestId("balance-correction-result")).toBeTruthy();
    });
    expect(screen.getByTestId("balance-correction-plan")).toHaveTextContent(
      /matches what this wallet already says/i,
    );
    // Not a zero-amount row — nothing happened, so nothing is written.
    expect(await ledger()).toEqual(before);
  });

  test("it NEVER edits past transactions", async () => {
    const before = await ledger();
    renderSheet(gcash);

    await correct("500");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: gcash.id })).toHaveLength(2);
    });

    const after = await ledger();
    for (const original of before) {
      expect(after.find((transaction) => transaction.id === original.id)).toEqual(original);
    }
  });
});

test("confirming with nothing typed is refused rather than writing anything", async () => {
  const before = await ledger();
  renderSheet(gcash);

  fireEvent.press(screen.getByTestId("balance-correction-confirm"));

  // An empty field reads as 0, and 0 is a real answer — but not one the user
  // gave. Committing it would write off the whole recorded balance on a
  // mis-tap.
  expect(await ledger()).toEqual(before);
  expect(screen.getByTestId("balance-correction-error")).toBeTruthy();
});

describe("which wallets get this sheet", () => {
  test("a wallet a provider reports on gets the sheet", async () => {
    const wallet = await createWallet({ name: "BPI" });
    await setWalletMatchers(wallet.id, [{ packageName: "com.bpi.ng.app", hint: null }]);

    renderSheet((await getWallet(wallet.id)) as Wallet);

    expect(screen.getByTestId("balance-correction-sheet")).toBeTruthy();
  });

  test("a MANUAL wallet renders no sheet at all", async () => {
    // Nothing routes here, so there is no reported figure to correct against —
    // only the user's own count, which is what CashReconcileSheet is for
    // (rule 3). This is the case `type: "cash"` used to name.
    const wallet = await createWallet({ name: "Pocket" });

    renderSheet(wallet);

    expect(screen.queryByTestId("balance-correction-sheet")).toBeNull();
  });

  test("an OWED wallet renders no sheet at all", async () => {
    // Its balance is money owed, not held — and this sheet's question ("what
    // does this wallet actually have?") plus its in/out mapping are written for
    // a held balance. See the file header.
    const wallet = await createWallet({ name: "Card" });
    await setWalletMatchers(wallet.id, [{ packageName: "com.bpi.ng.app", hint: null }]);
    await setWalletOwed(wallet.id, true, { pinned: true });

    renderSheet((await getWallet(wallet.id)) as Wallet);

    expect(screen.queryByTestId("balance-correction-sheet")).toBeNull();
  });
});
