// components/wallets/__tests__/archive_wallet_sheet.test.tsx — m1c plan Task 5
// rule 4: "Archive, never orphan".
//
// TWO CLAIMS THIS SUITE EXISTS TO DEFEND.
//
//   THE DEFAULT IS TO KEEP THE TRANSACTIONS. Archiving is what a user does when
//   they close a bank account, and their history has to keep making sense
//   afterwards (spec §archive rule 2: "its Transactions remain fully visible in
//   history and reports"). A dialog that defaulted to MOVING would silently
//   relocate years of history into whichever wallet happened to be first in the
//   list — and a mis-tap on a confirm button is not consent to that.
//
//   DELETE IS NOT OFFERED. Invariant 4 forbids orphan Transactions, and
//   `wallets_repo` exports no `deleteWallet` at all. A delete affordance here
//   would be a path to a broken invariant, or a button that throws.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ArchiveWalletSheet } from "../archive_wallet_sheet";
import type { Wallet } from "@/types/domain";

function wallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "w-gcash",
    name: "GCash",
    balance: 100_000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    owedBalance: false,
    owedPinned: false,
    matcherCount: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const OTHERS: Wallet[] = [
  wallet({ id: "w-bpi", name: "BPI" }),
  wallet({ id: "w-cash", name: "Pocket" }),
];

function renderSheet(overrides: Partial<React.ComponentProps<typeof ArchiveWalletSheet>> = {}) {
  const onArchive = jest.fn();
  render(
    <ArchiveWalletSheet
      wallet={wallet()}
      visible
      onDismiss={jest.fn()}
      otherWallets={OTHERS}
      transactionCount={12}
      onArchive={onArchive}
      {...overrides}
    />,
  );
  return onArchive;
}

describe("the transaction-handling choice", () => {
  test("is offered when the wallet has transactions", () => {
    renderSheet();

    expect(screen.getByTestId("archive-keep-transactions")).toBeTruthy();
    expect(screen.getByTestId("archive-move-transactions")).toBeTruthy();
  });

  test("neither choice's explanation clips to one line", () => {
    // app-wide sweep for branch-review-correctness.md F2's defect class:
    // list_row.tsx's subtitle defaults to `numberOfLines={1}` unless a
    // caller opts in. RNTL never simulates a device's line-clamp —
    // `getByText` below matches the FULL string either way — so only the
    // rendered node's own `numberOfLines` proves the clamp would not fire.
    renderSheet();

    expect(
      screen.getByText("They stay in your history and reports, attached to this wallet.").props
        .numberOfLines,
    ).toBeGreaterThan(1);
    expect(
      screen.getByText("Their amounts and details are unchanged; only the wallet moves.").props
        .numberOfLines,
    ).toBeGreaterThan(1);
  });

  test("DEFAULTS to keeping them — confirming without choosing moves nothing", () => {
    const onArchive = renderSheet();

    fireEvent.press(screen.getByTestId("archive-confirm"));

    // `null` is "leave them attached to the archived wallet". Anything else
    // here means a user who tapped straight through has just relocated their
    // whole history without being asked a second time.
    expect(onArchive).toHaveBeenCalledWith(null);
  });

  test("says plainly that keeping them is what happens", () => {
    renderSheet();

    expect(screen.getByTestId("archive-wallet-sheet")).toHaveTextContent(/histor/i);
  });

  test("moving requires actually picking a destination", () => {
    const onArchive = renderSheet();

    fireEvent.press(screen.getByTestId("archive-move-transactions"));
    fireEvent.press(screen.getByTestId("archive-confirm"));

    // "Move them" with no target chosen is not an instruction. Falling back to
    // "keep" here would be quieter but would tell the user their move worked.
    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByTestId("archive-target-error")).toBeTruthy();
  });

  test("moving to a chosen wallet passes that wallet's id", () => {
    const onArchive = renderSheet();

    fireEvent.press(screen.getByTestId("archive-move-transactions"));
    fireEvent.press(screen.getByTestId("archive-target-w-bpi"));
    fireEvent.press(screen.getByTestId("archive-confirm"));

    expect(onArchive).toHaveBeenCalledWith("w-bpi");
  });

  test("switching back to keeping clears the chosen destination", () => {
    const onArchive = renderSheet();

    fireEvent.press(screen.getByTestId("archive-move-transactions"));
    fireEvent.press(screen.getByTestId("archive-target-w-bpi"));
    fireEvent.press(screen.getByTestId("archive-keep-transactions"));
    fireEvent.press(screen.getByTestId("archive-confirm"));

    expect(onArchive).toHaveBeenCalledWith(null);
  });

  test("a wallet with no transactions is not asked the question at all", () => {
    const onArchive = renderSheet({ transactionCount: 0 });

    expect(screen.queryByTestId("archive-move-transactions")).toBeNull();

    fireEvent.press(screen.getByTestId("archive-confirm"));
    expect(onArchive).toHaveBeenCalledWith(null);
  });

  test("the wallet being archived is not offered as its own destination", () => {
    renderSheet({ otherWallets: [...OTHERS, wallet()] });

    fireEvent.press(screen.getByTestId("archive-move-transactions"));

    expect(screen.queryByTestId("archive-target-w-gcash")).toBeNull();
  });
});

describe("HARD delete is not on offer", () => {
  // THE RULE SURVIVED, THE VOCABULARY CHANGED. This block used to assert that
  // the word "Delete" appeared nowhere in the sheet, which was a proxy for the
  // real invariant: rule 4's "Deleting a wallet with transactions is not
  // offered at all", backed by invariant 4 and the schema's NO ACTION foreign
  // key on `transactions.wallet_id`.
  //
  // The owner renamed the user-facing action to Delete (2026-08-28: "replace
  // the misleading button text from archive to 'delete'") now that every
  // retirement in the app is restorable — so the proxy became false while the
  // invariant it stood for did not. These tests assert the invariant directly
  // instead: the only control here is the SOFT one, and the copy promises both
  // halves of what that means.
  test("the sheet's only destructive control is the soft, restorable one", () => {
    renderSheet();

    // No second, harder control alongside it.
    expect(screen.queryByTestId("archive-delete")).toBeNull();
    // And the one that exists is `archive-confirm` — the call that stamps
    // `is_archived`, never a row removal.
    expect(screen.getByTestId("archive-confirm")).toBeTruthy();
  });

  test("it says the history survives AND that the wallet can be brought back", () => {
    renderSheet();

    // Both halves matter. "History stays" without "you can restore it" is the
    // sentence that made the old wording misleading in the opposite direction:
    // it explained what happened to the transactions and left the user to guess
    // that the wallet itself was gone for good.
    const sheet = screen.getByTestId("archive-wallet-sheet");
    expect(sheet).toHaveTextContent(/history stays in your reports/i);
    expect(sheet).toHaveTextContent(/restore it/i);
  });
});

describe("what archiving changes", () => {
  test("states that the wallet's matchers stop catching notifications", () => {
    renderSheet();

    // Spec §archive rule 2: matchers are SUSPENDED, and rule 3 sends anything
    // they would have matched to the Review Queue. A user who archives a wallet
    // and then wonders where their GCash transactions went is owed this
    // sentence before they tap, not after.
    expect(screen.getByTestId("archive-wallet-sheet")).toHaveTextContent(/Review Queue/i);
  });

  test("states that the balance leaves the wallets total", () => {
    renderSheet();

    expect(screen.getByTestId("archive-wallet-sheet")).toHaveTextContent(/total/i);
  });
});
