// components/review/__tests__/correct_sheet.test.tsx — m1c plan Task 10.
//
// THE TWO-TAP CORRECTION, and the checkbox that decides whether it teaches.
//
// This component is presentational: it never writes anything. What it must get
// right is the PATCH it reports, because `lib/review/resolve_actions.ts` decides
// what to commit and what rule to create purely from that object. Two mistakes
// here are invisible until weeks later:
//
//   REPORTING A FIELD THE USER DID NOT TOUCH would make every confirmation look
//   like a correction, and the queue would manufacture a UserRule from every
//   card the user simply agreed with.
//
//   LOSING `createRule: false` would create the rule anyway — silently
//   recategorizing rows the user never looked at, having just told the app not
//   to.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ALWAYS_BOTH_LABEL, CorrectSheet, alwaysRuleLabel } from "../correct_sheet";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { clearAmount, typeAmount } from "@/test_support/keypad";

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { enqueue, listOpen } from "@/lib/db/repos/review_queue_repo";
import { getTransaction } from "@/lib/db/repos/transactions_repo";
import { listUserRules } from "@/lib/db/repos/user_rules_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { correctItem } from "@/lib/review/resolve_actions";
import type { CorrectionPatch } from "@/lib/review/resolve_actions";
import { freshDb } from "@/test_support/db";
import type { Category, RawCapture, ReviewQueueItem, Wallet } from "@/types/domain";

const FOOD = "cat_food_dining";
const TRANSPORT = "cat_transport";

const CATEGORIES: Category[] = [
  {
    id: FOOD,
    name: "Food & Dining",
    parentId: null,
    icon: "utensils",
    isSystem: true,
    isHidden: false,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: TRANSPORT,
    name: "Transport",
    parentId: null,
    icon: "bus",
    isSystem: true,
    isHidden: false,
    createdAt: 0,
    updatedAt: 0,
  },
];

const WALLETS: Wallet[] = [
  {
    id: "wallet_gcash",
    name: "GCash",
    balance: 100000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    owedBalance: false,
    owedPinned: false,
    matcherCount: 1,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "wallet_bpi",
    name: "BPI",
    balance: 500000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    owedBalance: false,
    owedPinned: false,
    matcherCount: 1,
    createdAt: 0,
    updatedAt: 0,
  },
];

function item(payload: Record<string, unknown> = {}): ReviewQueueItem {
  return {
    id: "item-1",
    kind: "low-confidence",
    payload: {
      amount: 125000,
      direction: "out",
      merchant: "7-ELEVEN",
      walletId: "wallet_gcash",
      categoryId: FOOD,
      confidence: 0.72,
      ...payload,
    },
    rawNotificationId: "raw-1",
    createdAt: 0,
    expiresAt: null,
    resolvedAt: null,
  };
}

const onSubmit = jest.fn();
const onDismiss = jest.fn();

// KeypadProvider AND A ROOT HOST (numeric-input-system Task 14). The amount is
// a NumericField now, whose `useKeypad()` throws with no provider above it, and
// BottomSheet mounts a host of its own inside its Modal. The root host goes
// BEFORE the subject: tokens are handed out in effect-completion order, so a
// host mounted after this subtree would outrank the sheet's own and the panel
// would be painted behind the sheet.
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <KeypadProvider>
      <KeypadHost />
      {children}
    </KeypadProvider>
  );
}

function renderSheet(entry: ReviewQueueItem = item(), capture: RawCapture | null = null): void {
  render(
    <CorrectSheet
      visible
      item={entry}
      wallets={WALLETS}
      categories={CATEGORIES}
      capture={capture}
      onDismiss={onDismiss}
      onSubmit={onSubmit}
    />,
    { wrapper: Wrapper },
  );
}

/**
 * An unknown provider's item: `{ amount: null, direction: null }`, exactly what
 * `pipeline.ts` queues when no ruleset matched. Everything this sheet shows for
 * one of these comes from the capture, because the payload has nothing in it.
 */
function unknownItem(): ReviewQueueItem {
  return {
    id: "item-unknown",
    kind: "unknown-provider",
    payload: { amount: null, direction: null, packageName: "com.bank.notanapp" },
    rawNotificationId: "raw-1",
    createdAt: 0,
    expiresAt: null,
    resolvedAt: null,
  };
}

function unknownCapture(text: string): RawCapture {
  return {
    id: "raw-1",
    packageName: "com.bank.notanapp",
    title: "Notanapp",
    text,
    subText: null,
    bigText: null,
    postedAt: 0,
    capturedAt: 0,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the sheet opens on what the parser proposed", () => {
  test("prefills the parsed amount, wallet, category and merchant", () => {
    renderSheet();

    // THE SEEDING ASSERTION, AND IT IS WORTH ITS OWN SENTENCE. A field seeded
    // with a raw `String(125000)` would read back through `centavosFrom` as
    // ₱125,000 — a hundredfold inflation of the figure the parser actually
    // captured, on the one sheet whose entire job is correcting that figure.
    // `pesoInputFrom` is the only route from Centavos to field text.
    expect(screen.getByTestId("correct-amount")).toHaveTextContent("₱1,250");
    expect(screen.getByTestId("correct-amount")).not.toHaveTextContent("₱125,000");
    expect(screen.getByTestId("correct-wallet-wallet_gcash").props.accessibilityState).toMatchObject(
      { selected: true },
    );
    expect(screen.getByTestId("correct-category")).toHaveTextContent("Food & Dining");
    expect(screen.getByTestId("correct-merchant").props.value).toBe("7-ELEVEN");
  });

  test("starts empty for a capture nothing could be read from", () => {
    renderSheet(item({ amount: null, direction: null, walletId: null, merchant: null }));

    // The unknown-provider flow lands here too (spec §"this is a money
    // notification"), and it must not present a guessed ₱0 as a parsed value —
    // an empty NumericField shows its PLACEHOLDER, which is greyed and is not
    // a value the sheet would submit.
    expect(screen.getByTestId("correct-amount")).toHaveTextContent("₱0");
    expect(screen.getByTestId("correct-amount").props.accessibilityLabel).toBe("Amount");
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("hides nothing behind an invisible sheet", () => {
    render(
      <CorrectSheet
        visible={false}
        item={item()}
        wallets={WALLETS}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.queryByTestId("correct-sheet")).toBeNull();
  });
});

describe("the patch reports only what the user changed", () => {
  test("an untouched sheet submits no field at all", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-save"));

    // Saving without touching anything is a CONFIRMATION. Reporting the
    // unchanged values as a patch would make `resolve_actions` treat it as a
    // correction and manufacture a rule from it.
    expect(onSubmit).toHaveBeenCalledWith({ createRule: true });
  });

  test("a changed category is reported", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({ categoryId: TRANSPORT, createRule: true });
  });

  test("a changed wallet is reported", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({ walletId: "wallet_bpi", createRule: true });
  });

  test("a changed amount is reported in centavos built from keystrokes", () => {
    renderSheet(item({ amount: null }));

    // RETYPED, NOT RE-BASELINED. This used to press 1,2,3,4 into a numpad that
    // read digits as CENTAVOS. The keypad reads them as PESOS, so reaching the
    // same ₱12.34 now takes "12.34" — the expectation below is the one figure
    // that must not move.
    typeAmount("correct-amount", "12.34");
    fireEvent.press(screen.getByTestId("correct-save"));

    // ₱12.34 → 1234 centavos. Never a display string parsed back into a number
    // (Task 8 rule 2).
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 1234 }));
  });

  test("correcting a seeded amount reports the corrected figure, not a hundredfold one", () => {
    // The seeding trap end to end: the parser read ₱1,250.00, the user fixes it
    // to ₱1,300.00. The `clearAmount` is belt-and-braces: the first keystroke
    // on a seeded field now replaces rather than appends (see `untouched` in
    // contexts/keypad_context.tsx), so this reaches 1300 either way.
    renderSheet();

    clearAmount("correct-amount");
    typeAmount("correct-amount", "1300");
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 130000 }));
  });

  test("a flipped direction is reported", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-direction-in"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ direction: "in" }));
  });

  test("a corrected merchant is reported", () => {
    renderSheet();

    fireEvent.changeText(screen.getByTestId("correct-merchant"), "7-Eleven Katipunan");
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "7-Eleven Katipunan" }),
    );
  });
});

describe("the rule checkbox", () => {
  test("is offered, and checked, once a correction would teach something", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));

    // Checked by default: the common case is "yes, always" (spec rule 12), and a
    // user who must opt IN to being remembered will correct the same merchant
    // forever and conclude triage is pointless.
    const checkbox = screen.getByTestId("correct-rule-checkbox");
    expect(checkbox.props.accessibilityState).toMatchObject({ checked: true });
  });

  test("is not offered when nothing has been corrected", () => {
    renderSheet();

    // "Always do what you already did" is not an offer worth making.
    expect(screen.queryByTestId("correct-rule-checkbox")).toBeNull();
  });

  test("is not offered for a category change with no merchant to key on", () => {
    renderSheet(item({ merchant: null }));

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));

    // `categorizer.ts` makes a blank `merchantPattern` FAIL CLOSED, so this rule
    // could never fire. Offering it would promise something the pipeline cannot
    // keep.
    expect(screen.queryByTestId("correct-rule-checkbox")).toBeNull();
  });

  test("unchecking it is carried through to the patch", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));
    fireEvent.press(screen.getByTestId("correct-rule-checkbox"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({ walletId: "wallet_bpi", createRule: false });
  });

  test("names both halves of what it will do", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));

    expect(screen.getByText(alwaysRuleLabel("7-ELEVEN", "Transport"))).toBeTruthy();
  });

  test("admits it when one box governs two rules", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));
    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));

    // Naming only the category rule while quietly suppressing the wallet rule
    // too would make the box mean more than it says.
    expect(screen.getByText(ALWAYS_BOTH_LABEL)).toBeTruthy();

    fireEvent.press(screen.getByTestId("correct-rule-checkbox"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({
      categoryId: TRANSPORT,
      walletId: "wallet_bpi",
      createRule: false,
    });
  });
});

describe("save is refused while the ledger would reject the row", () => {
  test("a zero amount cannot be saved", () => {
    renderSheet(item({ amount: null }));

    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("no wallet cannot be saved", () => {
    renderSheet(item({ walletId: null }));

    // The one field the gate routed this item here FOR. Committing without it
    // would throw from the repository, after the sheet had already closed.
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));

    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
});

// Device-testing fix, Task 1 (2026-08-18): a real ₱200 notification landed in
// the queue and could not be saved. `canSave` was correct — the app was
// silently right and useless at the same time, because nothing told the user
// why, and the field they needed sat below a scroll fold they never found.
describe("a disabled Save always says why", () => {
  test("explains why save is disabled when no wallet is chosen", () => {
    renderSheet(item({ walletId: null }));

    expect(screen.getByTestId("correct-save-reason")).toHaveTextContent(
      "Pick a wallet to save",
    );
  });

  test("does not tell the user to pick from a list it just said is empty", () => {
    // With zero wallets, `correct-wallet-empty` already says "No wallets yet
    // — add one to save this entry." (rule 4). "Pick a wallet to save" right
    // above Save would contradict that in the same screen — the section says
    // there is nothing to choose from, the reason line says choose one.
    render(
      <CorrectSheet
        visible
        item={item({ walletId: null })}
        wallets={[]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("correct-save-reason")).toHaveTextContent(
      "Add a wallet to save",
    );
  });

  test("explains why save is disabled when the amount is zero", () => {
    renderSheet(item({ amount: null }));

    expect(screen.getByTestId("correct-save-reason")).toHaveTextContent(
      "Enter an amount to save",
    );
  });

  test("says nothing once the sheet is actually savable", () => {
    renderSheet();

    expect(screen.queryByTestId("correct-save-reason")).toBeNull();
  });
});

describe("the wallet picker defaults when the choice is unambiguous", () => {
  test("preselects the only wallet when there is exactly one", () => {
    render(
      <CorrectSheet
        visible
        item={item({ walletId: null })}
        wallets={[WALLETS[0]]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("correct-wallet-wallet_gcash").props.accessibilityState).toMatchObject(
      { selected: true },
    );
    // Nothing left to ask about, so the sheet is savable without a tap.
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  test("does not preselect a wallet when there are several", () => {
    renderSheet(item({ walletId: null }));

    expect(screen.getByTestId("correct-wallet-wallet_gcash").props.accessibilityState).toMatchObject(
      { selected: false },
    );
    expect(screen.getByTestId("correct-wallet-wallet_bpi").props.accessibilityState).toMatchObject(
      { selected: false },
    );
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("tells the user when there are no wallets at all", () => {
    render(
      <CorrectSheet
        visible
        item={item({ walletId: null })}
        wallets={[]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("correct-wallet-empty")).toHaveTextContent(
      /No wallets yet/,
    );
    expect(screen.queryByTestId(/^correct-wallet-wallet_/)).toBeNull();
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("leaving the preselected wallet in place still reports it, and offers the rule", () => {
    // THE PRESELECT IS A CONFIRMABLE DEFAULT, NOT A SUPPRESSED SIGNAL — see
    // correct_sheet.tsx's header. An earlier version of this fix folded the
    // preselected wallet into the diff's OWN baseline, so saving an untouched
    // single-wallet sheet reported no `walletId` at all. That failed
    // SILENTLY: `resolveCorrect` requires a wallet from patch or payload, the
    // payload had none, the mutation has no `onError`, and the sheet had
    // already closed by the time it threw — Save looked like it worked and
    // nothing was written, for exactly the user this preselect was written
    // to help.
    render(
      <CorrectSheet
        visible
        item={item({ walletId: null })}
        wallets={[WALLETS[0]]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.press(screen.getByTestId("correct-save"));

    // The preselected wallet IS the correction: the parser proposed none, the
    // sheet ends up holding one, and that difference is exactly what
    // `resolve_actions.ts` needs to write both the transaction's wallet and
    // the set-wallet rule — "always route this app's notifications to my
    // only wallet" is correct, not presumptuous, when there is only one.
    expect(onSubmit).toHaveBeenCalledWith({
      walletId: "wallet_gcash",
      createRule: true,
    });
  });
});

// ---------------------------------------------------------------------------
// THE SEAM. Every test above renders the sheet against hand-built fixtures
// and checks the shape of the patch by eye. That is exactly how the Critical
// bug shipped: `onSubmit` was called with `{ createRule: true }`, a test
// asserted that literal object, and NOTHING checked that the object was one
// `lib/review/resolve_actions.ts` could actually act on. This block closes
// that gap by running the sheet's own emitted patch through the REAL
// resolver, against a REAL database — not a shape assertion, a survival
// test.
// ---------------------------------------------------------------------------

describe("the emitted patch actually survives the resolver", () => {
  const NOW = Date.UTC(2026, 7, 18, 9, 0, 0);

  beforeEach(async () => {
    await freshDb();
    await seedDefaultCategories();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  test("a single unmatched wallet is preselected AND actually committed, not silently dropped", async () => {
    // The exact Critical: one wallet, the payload has none. The pre-fix
    // baseline swap made this case fail SILENTLY — Save looked like it
    // worked, `resolveCorrect` threw with nobody catching it, and the item
    // never left the queue.
    const gcash = await createWallet({ name: "GCash", openingBalance: 100000 });
    const queued = await enqueue({
      kind: "low-confidence",
      payload: {
        amount: 20000,
        direction: "out",
        merchant: "7-ELEVEN",
        walletId: null,
        categoryId: FOOD,
        confidence: 0.72,
        // `resolve_actions.ts`'s `providerKeyFor` needs a package to key the
        // set-wallet rule's matcher on; without one it resolves `null` and
        // silently skips the rule, which would make this test pass for the
        // wrong reason if left out.
        packageName: "com.globe.gcash.android",
      },
    });

    render(
      <CorrectSheet
        visible
        item={queued}
        wallets={[gcash]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
      { wrapper: Wrapper },
    );

    // Nothing touched — the preselect is left exactly as it opened.
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const patch = onSubmit.mock.calls[0][0] as CorrectionPatch;

    // THE SEAM: hand the sheet's own patch to the real resolver, not a
    // stand-in for it. A patch shaped like the old bug (no `walletId`) would
    // throw `IncompleteReviewItemError` here.
    const transactionId = await correctItem(queued.id, patch, NOW);

    expect(transactionId).not.toBeNull();
    expect((await getTransaction(transactionId as string))?.walletId).toBe(gcash.id);
    // The item actually left the queue — the other half of "Save worked".
    expect(await listOpen()).toHaveLength(0);
    // The Important the same baseline bug caused: with `changedWallet` stuck
    // false, this rule never got written, and every future notification from
    // this provider re-entered the queue forever.
    const rules = await listUserRules("set-wallet");
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toEqual({ kind: "set-wallet", walletId: gcash.id });
  });
});

// ---------------------------------------------------------------------------
// Seeded from the notification (2026-08-28)
//
// The unknown-provider flow reaches this sheet with a payload that holds
// NOTHING — `pipeline.ts` queues `{ amount: null, direction: null }` because no
// ruleset matched and no parser ran. Before this, that meant a blank form over
// a notification the user had just identified as money: they retyped what their
// own screen said. `candidates.ts` reads the capture; this sheet seeds from it.
//
// TWO PROPERTIES ARE LOAD-BEARING AND BOTH ARE ASSERTED BELOW.
//
//   A SEED IS STILL REPORTED IN THE PATCH. `correctItem` requires an amount
//   from the patch or the payload, and this payload has none — so a seed folded
//   into the diff's baseline would submit an empty patch, throw after the sheet
//   had already closed, and look exactly like a successful save. That is the
//   2026-08-18 preselect bug, one field over.
//
//   A SEED IS NOT A CORRECTION THE USER MADE. The rule checkbox defaults
//   UNCHECKED here, because the user agreed to numbers the app proposed rather
//   than typing something specific — teaching the pipeline from that would be
//   the queue learning things nobody asked it to learn.
// ---------------------------------------------------------------------------

describe("seeding an unknown provider from its notification", () => {
  test("fills the amount, direction and merchant the text carries", () => {
    renderSheet(
      unknownItem(),
      unknownCapture("You sent PHP 1,250.00 to Juan Dela Cruz. New balance PHP 3,420.50."),
    );

    // The BALANCE is the trap: it is the larger number, it is an amount-like
    // token, and committing it would put a ₱3,420.50 spend nobody made in the
    // ledger.
    expect(screen.getByTestId("correct-amount")).toHaveTextContent("₱1,250");
    expect(screen.getByTestId("correct-amount")).not.toHaveTextContent("₱3,420");
    expect(screen.getByTestId("correct-direction-out").props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId("correct-merchant").props.value).toBe("Juan Dela Cruz");
  });

  test("the seeded amount is reported in the patch, not swallowed as a baseline", () => {
    renderSheet(unknownItem(), unknownCapture("You sent PHP 1,250.00 to Juan Dela Cruz."));

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_gcash"));
    fireEvent.press(screen.getByTestId("correct-save"));

    const patch = onSubmit.mock.calls[0][0] as CorrectionPatch;
    expect(patch.amount).toBe(125000);
    expect(patch.direction).toBe("out");
    expect(patch.walletId).toBe("wallet_gcash");
  });

  test("nothing is remembered from numbers the user only agreed to", () => {
    renderSheet(unknownItem(), unknownCapture("You sent PHP 1,250.00 to Juan Dela Cruz."));

    // Picking the wallet is what offers the rule at all (`ruleOffered`).
    fireEvent.press(screen.getByTestId("correct-wallet-wallet_gcash"));

    expect(screen.getByTestId("correct-rule-checkbox").props.accessibilityState).toMatchObject({
      checked: false,
    });
    fireEvent.press(screen.getByTestId("correct-save"));
    expect((onSubmit.mock.calls[0][0] as CorrectionPatch).createRule).toBe(false);
  });

  test("a correction the user typed still arms the checkbox", () => {
    // The seeding must not disarm rule creation for the ORDINARY path — a
    // parsed item corrected by hand is exactly the case spec rule 12 is about.
    renderSheet();
    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));

    expect(screen.getByTestId("correct-rule-checkbox").props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  test("two live amounts leave the field empty and the text tappable", () => {
    renderSheet(
      unknownItem(),
      unknownCapture("PHP 1,250.00 paid to Meralco. Convenience fee PHP 15.00."),
    );

    // NOTHING IS GUESSED when two numbers are both transaction-shaped — the
    // sheet says so and lets the user point at the one that moved.
    expect(screen.getByTestId("correct-amount")).toHaveTextContent("₱0");
    expect(screen.getByTestId("correct-capture-hint")).toBeTruthy();

    fireEvent.press(screen.getByTestId("correct-token-1500"));
    expect(screen.getByTestId("correct-amount")).toHaveTextContent("₱15");

    // And the choice is revisable: the other number is still where the
    // notification put it.
    fireEvent.press(screen.getByTestId("correct-token-125000"));
    expect(screen.getByTestId("correct-amount")).toHaveTextContent("₱1,250");
  });

  test("a parsed item is never overwritten by a weaker read of its text", () => {
    // `low-confidence` reaches this sheet WITH a parse. The capture behind it
    // may well contain a different number (a balance, a fee); the parser's
    // proposal is the more trustworthy of the two and wins.
    renderSheet(item(), unknownCapture("PHP 9,999.00 was debited"));

    expect(screen.getByTestId("correct-amount")).toHaveTextContent("₱1,250");
    expect(screen.queryByTestId("correct-capture")).toBeNull();
  });
});
