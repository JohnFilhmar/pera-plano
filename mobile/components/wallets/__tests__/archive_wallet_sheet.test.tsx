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
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

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

function sheet(overrides: Partial<React.ComponentProps<typeof ArchiveWalletSheet>> = {}) {
  return (
    <ArchiveWalletSheet
      wallet={wallet()}
      visible
      onDismiss={jest.fn()}
      otherWallets={OTHERS}
      transactionCount={12}
      onArchive={jest.fn()}
      {...overrides}
    />
  );
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof ArchiveWalletSheet>> = {}) {
  const onArchive = jest.fn();
  render(sheet({ onArchive, ...overrides }));
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
      screen.getByText("Their amounts and details are unchanged. Transfers between these two wallets stay put.").props.numberOfLines,
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

// ---------------------------------------------------------------------------
// GAP-079 — the sheet AROUND the archive, which every test above misses
// because each renders a fresh sheet, presses once, and stops there.
//
// THE DEFAULT IS ONLY A DEFAULT IF IT IS RESTORED. The detail screen keeps
// this sheet mounted and toggles `visible`, so a "Move them to BPI" the user
// backed out of was still selected the next time the sheet opened — and one
// confirm tap from relocating years of history into a wallet nobody chose this
// time. That is the same mis-tap the file header calls "not consent to that",
// arriving by a route the header did not anticipate.
//
// AND THE CONFIRM HAD NO BUSY STATE AT ALL. The archive re-runs
// `reassignWalletTransactions` over the ledger the first one is still moving.
// ---------------------------------------------------------------------------

/** Rejects the archive `ArchivingHarness` is holding open. */
let failArchive: (() => void) | null = null;

/**
 * The detail screen's shape around this sheet, which the plain `renderSheet`
 * above does not have: the confirm fires, `busy` goes true, THE SHEET STAYS
 * OPEN, and the flag clears only when the write settles — either way, matching
 * the `onSettled` app/wallet/[id].tsx clears it in.
 */
function ArchivingHarness({
  onArchive,
}: {
  onArchive: (moveTransactionsTo: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  return sheet({
    busy,
    onArchive: (moveTransactionsTo) => {
      onArchive(moveTransactionsTo);
      setBusy(true);
      new Promise<void>((_resolve, reject) => {
        failArchive = () => reject(new Error("archive rejected"));
      })
        .catch(() => undefined)
        .finally(() => setBusy(false));
    },
  });
}

describe("a double tap on Delete wallet", () => {
  beforeEach(() => {
    failArchive = null;
  });

  test("two presses inside one archive submit once", () => {
    const onArchive = jest.fn();
    render(<ArchivingHarness onArchive={onArchive} />);

    fireEvent.press(screen.getByTestId("archive-confirm"));
    fireEvent.press(screen.getByTestId("archive-confirm"));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  test("the confirm says it is busy rather than going quietly dead", () => {
    render(<ArchivingHarness onArchive={jest.fn()} />);

    fireEvent.press(screen.getByTestId("archive-confirm"));

    const button = screen.getByTestId("archive-confirm");
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(button.props.accessibilityState.busy).toBe(true);
  });

  test("an archive that fails gives the confirm back", async () => {
    const onArchive = jest.fn();
    render(<ArchivingHarness onArchive={onArchive} />);
    fireEvent.press(screen.getByTestId("archive-confirm"));

    // Taken WHILE the write is open, so this reads false on a sheet that never
    // had a busy state at all rather than only on one that got stuck in it.
    expect(screen.getByTestId("archive-confirm").props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      failArchive?.();
    });

    // The screen leaves this sheet open on a failure and says so under the
    // buttons, so the retry that message asks for has to be tappable.
    expect(screen.getByTestId("archive-confirm").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByTestId("archive-confirm"));
    expect(onArchive).toHaveBeenCalledTimes(2);
  });
});

test("the screen's failure message is rendered where the buttons are", () => {
  renderSheet({ errorMessage: "This wallet could not be deleted." });

  expect(screen.getByTestId("archive-error")).toHaveTextContent(
    "This wallet could not be deleted.",
  );
});

test("reopening restores the answer that changes nothing", () => {
  const onArchive = jest.fn();
  const view = render(sheet({ onArchive }));

  fireEvent.press(screen.getByTestId("archive-move-transactions"));
  fireEvent.press(screen.getByTestId("archive-target-w-bpi"));

  view.rerender(sheet({ onArchive, visible: false }));
  view.rerender(sheet({ onArchive, visible: true }));

  // The destination list is gone with the choice that opened it — and the
  // load-bearing half is the next two lines: a confirm on a freshly opened
  // sheet KEEPS the transactions, rather than sending the destination picked
  // during an opening the user walked away from.
  expect(screen.queryByTestId("archive-target-w-bpi")).toBeNull();
  fireEvent.press(screen.getByTestId("archive-confirm"));
  expect(onArchive).toHaveBeenCalledWith(null);
});
