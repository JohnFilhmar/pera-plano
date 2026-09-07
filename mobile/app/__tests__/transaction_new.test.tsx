// app/__tests__/transaction_new.test.tsx — m1c plan Task 8's route,
// app/transaction/new.tsx, against a REAL database. Amount now goes through
// the shared keypad, auto-opened on mount (numeric-input-system W1 Task 9).
//
// The numpad and the form are pinned next door
// (components/transactions/__tests__/). What lives HERE is rule 4, which is the
// rule with teeth: A MANUAL ENTRY IS GROUND TRUTH.
//
//   IT CARRIES `source: "manual"` AND `confidence: 1`, and no raw capture —
//   there is no notification behind it to be transparent about, and the
//   detail screen's "Why was this recorded?" panel reads those fields to say
//   "you added this manually" instead of showing an empty box.
//
//   IT NEVER ENTERS THE PIPELINE. Not routed, not parsed, not deduped, not
//   transfer-detected, not gated. The proving test is the duplicate one: ₱100
//   entered twice within seconds must leave TWO rows. The DedupeGate exists to
//   suppress a push/SMS twin describing ONE real event; two manual entries are
//   two deliberate statements by a human, and merging them tells the user they
//   did not do something they just did. The assertion is the ROW COUNT, not the
//   absence of an error — a swallowed duplicate throws nothing.
//
//   THE WALLET BALANCE MOVES BY EXACTLY THE AMOUNT. `insertTransaction` settles
//   it in the same SQL transaction; a screen that "helpfully" adjusted the
//   balance itself would double every entry, and one that bypassed the
//   repository would move nothing while the ledger filled up.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
}));

// DateField (inside ManualEntryForm) imports the native picker at module load
// regardless of whether a test ever opens it — components/ui/__tests__/
// date_field.test.tsx's own mock exists for the same reason. Nothing here
// presses the date field, so a trivial stub is enough.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { countOpen } from "@/lib/db/repos/review_queue_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { setMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { archiveWallet, createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
import type { Transaction, Wallet } from "@/types/domain";

import NewTransactionScreen from "../transaction/new";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

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

// NumericField throws without a KeypadProvider above it, and the panel it
// opens has to be hosted somewhere — see test_support/keypad.ts's header.
//
// `tree()` keeps Wrapper/KeypadProvider/KeypadHost at stable positions so
// `unmountScreen` (below) can swap ONLY the screen out via `rerender` — the
// same shape a real stack navigation pop takes: the root KeypadHost beside
// the Stack (app/_layout.tsx) never unmounts, only the screen that pushed it
// does. Calling `.unmount()` on the whole render result would take the host
// down too, which would pass even without the fix Finding 1 requires.
function renderForm(ui: ReactElement) {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  function tree(inner: ReactElement | null) {
    return (
      <Wrapper>
        <KeypadProvider>
          {inner}
          <KeypadHost />
        </KeypadProvider>
      </Wrapper>
    );
  }
  const view = render(tree(ui));
  return {
    ...view,
    unmountScreen: () => view.rerender(tree(null)),
  };
}

async function renderNew() {
  const view = renderForm(<NewTransactionScreen />);
  await waitFor(() => expect(screen.getByTestId("manual-entry-form")).toBeTruthy());
  return view;
}

function save(): void {
  fireEvent.press(screen.getByTestId("manual-entry-save"));
}

async function ledger(walletId?: string): Promise<Transaction[]> {
  return listTransactions(walletId === undefined ? {} : { walletId });
}

let pocket: Wallet;

beforeEach(async () => {
  jest.clearAllMocks();
  await freshDb();
  await seedDefaultCategories();
  pocket = await createWallet({ name: "Pocket", openingBalance: 100_000 });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Rule 4 — a manual entry is ground truth
// ---------------------------------------------------------------------------

describe("what saving writes", () => {
  test("`source: manual`, `confidence: 1`, and no raw capture behind it", async () => {
    await renderNew();

    typeAmount("manual-amount", "1234");
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(1);
    });
    const [written] = await ledger(pocket.id);
    expect(written.source).toBe("manual");
    expect(written.confidence).toBe(1);
    // Not a parse the app is 100% sure of — a fact the user stated. There is no
    // notification to point at, and inventing a reference would make the
    // transparency panel lie about where the row came from.
    expect(written.rawNotificationId).toBeNull();
    // "1234" typed on the shared keypad is pesos, not centavos — ₱1,234.00.
    expect(written.amount).toBe(123_400);
    expect(written.direction).toBe("out");
    expect(written.walletId).toBe(pocket.id);
    expect(written.categoryId).toBe(UNCATEGORIZED_ID);
  });

  test("the wallet balance moves by exactly the amount", async () => {
    await renderNew();

    typeAmount("manual-amount", "300");
    save();

    // ₱1,000.00 opening, ₱300.00 spent → ₱700.00. Not a snap to a reported
    // figure (cash never reports one), and not zero.
    await waitFor(async () => {
      expect((await getWallet(pocket.id))?.balance).toBe(70_000);
    });
    const [written] = await ledger(pocket.id);
    expect(written.balanceAfter).toBeNull();
  });

  test("an `in` entry adds to the balance instead", async () => {
    await renderNew();

    typeAmount("manual-amount", "300");
    fireEvent.press(screen.getByTestId("manual-entry-direction-in"));
    save();

    await waitFor(async () => {
      expect((await getWallet(pocket.id))?.balance).toBe(130_000);
    });
  });

  test("the entry closes the screen once it is committed", async () => {
    await renderNew();

    typeAmount("manual-amount", "1234");
    save();

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
    // Committed BEFORE the screen closes — a `back()` fired optimistically
    // would leave a failed write with nobody on screen to be told.
    expect(await ledger(pocket.id)).toHaveLength(1);
  });
});

describe("a manual entry never enters the pipeline", () => {
  test("the SAME amount entered twice seconds apart leaves TWO rows", async () => {
    await renderNew();
    typeAmount("manual-amount", "100");
    save();
    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(1);
    });

    // The user goes back, taps add again, and enters the same ₱100.00 — two
    // jeepney rides, two rounds of drinks, two of anything.
    //
    // Modelled as a second save on the SAME mounted screen rather than a
    // cleanup-and-remount: `router.back` is mocked, so the screen never
    // actually unmounts here, and re-rendering after `cleanup()` throws
    // "Can't access .root on unmounted test renderer". The amount is still
    // typed in, which is exactly the state a returning user would land in.
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(2);
    });
    const rows = await ledger(pocket.id);
    expect(rows.map((row) => row.amount)).toEqual([10_000, 10_000]);
    expect(rows[0].id).not.toBe(rows[1].id);
    // And both moved the wallet. A deduped second entry would leave ₱900.00
    // here — money the user watched themselves spend, still in their pocket
    // according to the app.
    expect((await getWallet(pocket.id))?.balance).toBe(80_000);
  });

  test("a matching notification-sourced row does not suppress it either", async () => {
    // The DedupeGate's real job: one event, two notifications. This is the
    // opposite case — the user typing what the listener also heard is still a
    // second statement, and the ledger is where they will see and fix it.
    await insertTransaction({
      walletId: pocket.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 10_000,
      direction: "out",
      occurredAt: Date.now(),
      source: "notification",
      confidence: 0.9,
    });
    await renderNew();

    typeAmount("manual-amount", "100");
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(2);
    });
  });

  test("nothing is queued for review", async () => {
    await renderNew();

    typeAmount("manual-amount", "1234");
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(1);
    });
    // Not routed, not parsed, not gated. A manual entry has no confidence to
    // doubt and no provider to resolve, so nothing about it can need triage.
    expect(await countOpen()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The other half of rule 4. Two saves seconds apart are two rows on purpose
// (above); two presses inside ONE write are one row, because the second is a
// finger landing again on a Save the screen has not closed yet — this route
// closes on the write, not on the tap. Since nothing underneath a manual entry
// dedupes anything, the refusal has to happen at the button, and what makes it
// happen is the `submitting` flag this route hands the form.
// ---------------------------------------------------------------------------

describe("a double tap on Save", () => {
  test("two presses inside one write leave ONE row", async () => {
    await renderNew();
    typeAmount("manual-amount", "100");

    save();
    save();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(await ledger(pocket.id)).toHaveLength(1);
    // The balance is what a second row landing late would give away: one
    // ₱100.00 off ₱1,000.00, not two.
    expect((await getWallet(pocket.id))?.balance).toBe(90_000);
  });

  test("TWO PRESSES IN ONE TICK leave ONE row", async () => {
    await renderNew();
    typeAmount("manual-amount", "100");

    // The test above presses twice in two separate `act()`s, which flushes
    // enough React work between them that `isPending` alone catches the
    // second. This one is the real double tap: both presses land inside ONE
    // act, so no state update from the first can be observed by the second.
    // A `useState` guard cannot stop this — the setter does not change the
    // value the running handler's closure already read — which is why the
    // flag here is a ref. GAP-079 found the same hole on the loan sheet,
    // where it wrote two payments for one collector visit.
    await act(async () => {
      save();
      save();
    });

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(await ledger(pocket.id)).toHaveLength(1);
    expect((await getWallet(pocket.id))?.balance).toBe(90_000);
  });
});

// ---------------------------------------------------------------------------
// The wallet the entry lands in
// ---------------------------------------------------------------------------

describe("the cash wallet", () => {
  test("defaults to the cash wallet the ledger touched most recently", async () => {
    const jar = await createWallet({ name: "Jar", openingBalance: 50_000 });
    await insertTransaction({
      walletId: jar.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 5_000,
      direction: "out",
      occurredAt: Date.now(),
      source: "manual",
      confidence: 1,
    });
    await renderNew();

    typeAmount("manual-amount", "1234");
    save();

    await waitFor(async () => {
      expect(await ledger(jar.id)).toHaveLength(2);
    });
    expect(await ledger(pocket.id)).toHaveLength(0);
  });

  test("with no manual wallet it offers to create one and writes nothing", async () => {
    await freshDb();
    await seedDefaultCategories();
    const bpi = await createWallet({ name: "BPI", openingBalance: 500_000 });
    // TRACKED, so there is genuinely no manual wallet to fall back on. "Cash"
    // is no longer a type — it is a wallet nothing routes to — so a wallet
    // created without matchers WOULD be a valid default and this test would
    // stop testing anything.
    await setMatchers(bpi.id, [{ packageName: "com.bpi.ng.app", hint: null }]);
    await renderNew();

    typeAmount("manual-amount", "1234");
    save();

    // Cash written into a provider-tracked wallet corrupts both balances, so
    // the screen stops and asks rather than picking the only wallet it has.
    expect(screen.getByTestId("manual-entry-no-cash")).toBeTruthy();
    expect(await ledger()).toHaveLength(0);
    expect((await getWallet(bpi.id))?.balance).toBe(500_000);

    fireEvent.press(screen.getByTestId("manual-entry-create-cash"));
    expect(mockPush).toHaveBeenCalledWith("/wallet/new");
  });
});

// ---------------------------------------------------------------------------
// The auto-opened keypad — numeric-input-system W1 Task 9
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transfer mode (money-transfers Task 5) — goes through recordTransfer, not
// insertTransaction. There is no jest.mock of either: this file already
// verifies writes against a real database (see the header), so "went through
// recordTransfer and not the entry path" is proven by the SHAPE of what
// landed — two linked legs in two wallets — rather than by a spy call.
// ---------------------------------------------------------------------------

describe("a transfer draft", () => {
  test("goes to recordTransfer, writing both legs linked, not a single insertTransaction row", async () => {
    const bank = await createWallet({ name: "BPI", openingBalance: 200_000 });
    // TRACKED. With no matchers it would be a second MANUAL wallet, and
    // `lastUsedCashWallet` deliberately refuses to guess between two of those
    // with no history — so the form would ask instead of defaulting, and the
    // transfer under test would never be submitted at all.
    await setMatchers(bank.id, [{ packageName: "com.bpi.ng.app", hint: null }]);
    await renderNew();

    fireEvent.press(screen.getByTestId("manual-entry-segment-transfer"));
    typeAmount("manual-amount", "1000");
    fireEvent.press(screen.getByTestId(`manual-entry-to-wallet-${bank.id}`));
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(1);
    });

    // Exactly two rows total — the placeholder this task removes wrote none,
    // and a draft that fell through to the entry branch would have written
    // exactly one, uncategorized and unlinked, in whichever wallet the entry
    // path defaults to.
    expect(await ledger()).toHaveLength(2);

    const [outLeg] = await ledger(pocket.id);
    const [inLeg] = await ledger(bank.id);
    expect(outLeg.direction).toBe("out");
    expect(inLeg.direction).toBe("in");
    // "1000" typed on the shared keypad is pesos — ₱1,000.00 — and with no fee
    // typed both legs carry the full amount.
    expect(outLeg.amount).toBe(100_000);
    expect(inLeg.amount).toBe(100_000);
    // Only recordTransfer's linkTransfer call stamps this; a bare
    // insertTransaction leaves it null.
    expect(outLeg.transferLinkId).not.toBeNull();
    expect(outLeg.transferLinkId).toBe(inLeg.transferLinkId);

    // ₱1,000.00 opening minus a ₱1,000.00 transfer out, ₱2,000.00 opening plus
    // a ₱1,000.00 transfer in.
    expect((await getWallet(pocket.id))?.balance).toBe(0);
    expect((await getWallet(bank.id))?.balance).toBe(300_000);

    // Same dismiss as the entry path — committed before the screen closes.
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test("a rejected write says so on screen and keeps the sheet open", async () => {
    const bank = await createWallet({ name: "BPI", openingBalance: 200_000 });
    // TRACKED. With no matchers it would be a second MANUAL wallet, and
    // `lastUsedCashWallet` deliberately refuses to guess between two of those
    // with no history — so the form would ask instead of defaulting, and the
    // transfer under test would never be submitted at all.
    await setMatchers(bank.id, [{ packageName: "com.bpi.ng.app", hint: null }]);
    await renderNew();

    fireEvent.press(screen.getByTestId("manual-entry-segment-transfer"));
    typeAmount("manual-amount", "1000");
    fireEvent.press(screen.getByTestId(`manual-entry-to-wallet-${bank.id}`));

    // ARCHIVED AFTER THE LIST WAS RENDERED, which is the shape every real
    // failure on this path takes: the form is drawing a cached wallet list and
    // the service validates against the database as it is at write time. No
    // mock — `recordTransfer` rejects here for its own reason
    // (`archived_wallet`), exactly as it would on a SQLite fault.
    await archiveWallet(bank.id);
    save();

    // The transfer path is the one that writes three rows. A rejection with no
    // surface leaves the user looking at a sheet that neither closed nor
    // complained, with no way to tell whether their money was recorded.
    const failure = await screen.findByTestId("manual-entry-submit-error");
    expect(failure).toBeTruthy();
    expect(await ledger()).toHaveLength(0);
    expect(mockBack).not.toHaveBeenCalled();
    // Save has to stay live, or the only thing left to do is lose the draft.
    expect(screen.getByTestId("manual-entry-save").props.accessibilityState.disabled).toBe(false);
  });

  // GAP-078. The test above is the failure BEFORE the write; this is the one
  // after it, and the two must not say the same thing.
  test("a failure AFTER the legs commit says the transfer WAS recorded — never that nothing was", async () => {
    const bank = await createWallet({ name: "BPI", openingBalance: 200_000 });
    await setMatchers(bank.id, [{ packageName: "com.bpi.ng.app", hint: null }]);
    await renderNew();

    fireEvent.press(screen.getByTestId("manual-entry-segment-transfer"));
    typeAmount("manual-amount", "1000");
    fireEvent.press(screen.getByTestId(`manual-entry-to-wallet-${bank.id}`));

    // `recordTransfer` SUCCEEDS HERE. What fails is the step after it — the
    // screen closing itself, which is the real rejection this path can hit
    // ("Attempted to navigate before mounting the Root Layout component") and
    // stands in for the invalidation failing the same way. `Once`, so nothing
    // leaks into another test: jest.clearAllMocks() does not drop
    // implementations.
    mockBack.mockImplementationOnce(() => {
      throw new Error("Attempted to navigate before mounting the Root Layout component");
    });
    save();

    const failure = await screen.findByTestId("manual-entry-submit-error");
    const message = failure.props.children as string;

    // THE DISCRIMINATING ASSERTION — and it is the message, not the row count.
    // The rows below land either way, because recordTransfer already
    // committed before anything went wrong; what a single catch spanning the
    // whole chain got wrong was telling the user the opposite.
    expect(message).not.toContain("Nothing was recorded");
    expect(message).toContain("Your transfer was recorded");
    // And it must not invite the retry the pre-commit message does:
    // recordTransfer is not idempotent, so a second Save writes both legs and
    // the fee again.
    expect(message).not.toContain("try again");

    // The money really did move — which is exactly why the copy above may not
    // deny it. Two linked legs, both balances settled.
    expect(await ledger()).toHaveLength(2);
    expect((await getWallet(pocket.id))?.balance).toBe(0);
    expect((await getWallet(bank.id))?.balance).toBe(300_000);

    // The screen could not close itself, so Save has to come back — otherwise
    // the user is looking at a message under a permanently spinning button.
    await waitFor(() => {
      expect(screen.getByTestId("manual-entry-save").props.accessibilityState.disabled).toBe(false);
    });
  });
});

describe("the amount panel", () => {
  test("opens on mount, before the amount field is ever pressed", async () => {
    await renderNew();

    // The whole point of the mount effect: the screen lands with the panel
    // already up, the same landing state the inline numpad used to give it,
    // now with FormScreen's keyboard-avoidance underneath.
    expect(screen.getByTestId("keypad-host")).toBeTruthy();
    expect(screen.getByTestId("keypad-label").props.children).toBe("How much?");
  });

  test("closes when the screen unmounts, so it doesn't survive navigation", async () => {
    const view = await renderNew();
    expect(screen.getByTestId("keypad-host")).toBeTruthy(); // sanity: open first

    // Models router.back()/router.push() unmounting this screen while the
    // root KeypadHost beside the Stack (app/_layout.tsx) survives — see
    // renderForm's header. The panel must not still be showing here, wired to
    // a setAmount that belongs to a component which no longer exists.
    //
    // WHO CLOSES IT MOVED, AND THE GUARANTEE DID NOT. This route used to end
    // its mount effect with `return () => close()`. It no longer does:
    // components/ui/numeric_field.tsx closes the panel when the field the
    // request NAMES unmounts, which covers every migrated screen instead of
    // this one, and cannot misfire on a panel some other screen opened. The
    // field here is manual_entry_form.tsx's "manual-amount", which is exactly
    // what this route's open() targets.
    view.unmountScreen();

    expect(screen.queryByTestId("keypad-host")).toBeNull();
  });
});
