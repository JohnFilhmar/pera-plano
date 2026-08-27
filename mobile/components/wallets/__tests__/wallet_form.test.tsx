// components/wallets/__tests__/wallet_form.test.tsx — m1c plan Task 5, the
// create/edit form and the matcher picker inside it.
//
// THE TEST THAT MATTERS MOST IS THE CONFLICT WARNING. Plan rule 2: a matcher
// pair (provider + hint) belongs to exactly one wallet, and assigning it to a
// second wallet MOVES it and says so. The repository enforces the move; this is
// the half that tells the user it is about to happen. Without the warning, the
// user's other wallet quietly stops catching anything and there is nothing on
// screen that says why.
//
// The picker is PRESENTATIONAL — providers, current selection and the "who owns
// this pair" list all arrive as props. The route owns the reads; see
// app/__tests__/wallet_routes.test.tsx for the same rule end-to-end against a
// real database.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { clearAmount, typeAmount } from "@/test_support/keypad";

import { MatcherPicker } from "../matcher_picker";
import { WalletForm } from "../wallet_form";
import type { MatcherOwner } from "@/lib/wallets/matchers";
import type { NewWalletMatcher } from "@/types/domain";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";

const GCASH_PACKAGE = "com.globe.gcash.android";
const MAYA_PACKAGE = "com.paymaya";

const PROVIDERS: ProviderRuleset[] = [
  {
    providerKey: "gcash",
    packageNames: [GCASH_PACKAGE],
    version: 1,
    channel: "push",
    templates: [],
  },
  { providerKey: "maya", packageNames: [MAYA_PACKAGE], version: 1, channel: "push", templates: [] },
];

// THE FORM NEEDS A KEYPAD AROUND IT (numeric-input-system Task 13). The
// opening balance is a NumericField, whose `useKeypad()` throws with no
// provider above it, and the panel it opens is drawn by a KeypadHost. The host
// is mounted BEFORE the subject on purpose: the context gives the panel to the
// HIGHEST live host token and effects flush in completion order, so a host
// placed after the form would outrank any host the form's own subtree mounts.
function renderForm(ui: ReactElement) {
  return render(
    <KeypadProvider>
      <KeypadHost />
      {ui}
    </KeypadProvider>,
  );
}

// ---------------------------------------------------------------------------
// WalletForm
// ---------------------------------------------------------------------------

describe("the wallet form requires a name, and nothing else", () => {
  test("submitting with no name reports it, and calls nothing", () => {
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(screen.getByTestId("wallet-form-name-error")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a name of only spaces is not a name", () => {
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "    ");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(screen.getByTestId("wallet-form-name-error")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a name alone submits, with the name trimmed", () => {
    // THE WHOLE POINT OF THIS CHANGE, in one assertion. A name used to be half
    // an answer: the form also demanded one of bank / e-wallet / savings /
    // credit / cash before it would submit. It no longer asks.
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "  BPI  ");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "BPI" }));
  });

  test("the type picker is gone from the form entirely", () => {
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={jest.fn()} />);

    expect(screen.queryByTestId("wallet-form-type")).toBeNull();
    expect(screen.queryByTestId("wallet-form-type-error")).toBeNull();
    for (const label of ["Bank", "E-wallet", "Savings", "Credit", "Cash"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  test("the matcher section is always offered, even before anything is picked", () => {
    // It used to be hidden for a wallet typed as cash. There is no type to hide
    // it by any more, and hiding it by "no matchers yet" would remove the very
    // control needed to add one.
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={jest.fn()} providers={PROVIDERS} />);

    expect(screen.getByText("Which notifications land here?")).toBeTruthy();
  });

  test("picking no notification source is a real answer, not a missing one", () => {
    // A wallet with no matchers is a MANUAL wallet — what `type: "cash"` used
    // to mean. Submitting with an empty list must go through untouched.
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} providers={PROVIDERS} />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Pocket");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ matchers: [] }));
  });

  test("an opening balance is keyed in pesos and submitted as centavos", () => {
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} showOpeningBalance />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Cash");
    // "1500", not the old "150000" (numeric-input-system Task 13). The wallet
    // this test is about still opens at ₱1,500.00 — 150000 centavos. It is the
    // KEYSTROKES that changed, not the amount: a digit is a peso now.
    typeAmount("wallet-form-opening-balance", "1500");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ openingBalance: 150_000 }));
  });

  test("100000 in an opening balance is one hundred thousand pesos", () => {
    // The owner's report, at the other place the same field appears. Under
    // the old centavos-by-digit reading these six keystrokes submitted
    // 100000 centavos — ₱1,000.00.
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} showOpeningBalance />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Cash");
    typeAmount("wallet-form-opening-balance", "100000");

    // On screen before Save is ever pressed, which is the half the owner saw.
    expect(screen.getByText("₱100,000")).toBeTruthy();

    fireEvent.press(screen.getByTestId("wallet-form-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ openingBalance: 10_000_000 }));
  });

  test("centavos need an explicit decimal point", () => {
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} showOpeningBalance />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Cash");
    typeAmount("wallet-form-opening-balance", "1500.75");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ openingBalance: 150_075 }));
  });

  test("a mistyped balance can be cleared back to nothing", () => {
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} showOpeningBalance />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Cash");
    typeAmount("wallet-form-opening-balance", "9999");
    clearAmount("wallet-form-opening-balance");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    // `typeAmount` APPENDS rather than replacing, so a field that could not be
    // emptied would leave the old figure in front of every later correction.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ openingBalance: 0 }));
  });

  test("no opening balance means zero, not undefined", () => {
    const onSubmit = jest.fn();
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={onSubmit} showOpeningBalance />);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Cash");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ openingBalance: 0 }));
  });

  test("edit mode does not offer the opening balance at all", () => {
    // `updateWallet` refuses to patch `balance` on purpose — a form that could
    // set it directly would let a user write a number no transaction accounts
    // for. Adjusting a real balance goes through reconciliation instead.
    renderForm(<WalletForm submitLabel="Save" onSubmit={jest.fn()} initial={{ name: "Pocket" }} />);

    expect(screen.queryByTestId("wallet-form-opening-balance")).toBeNull();
  });

  test("prefills from the wallet being edited", () => {
    renderForm(
      <WalletForm
        submitLabel="Save"
        onSubmit={jest.fn()}
        initial={{ name: "GCash" }}
      />,
    );

    expect(screen.getByTestId("wallet-form-name").props.value).toBe("GCash");
  });

  test("hides the matcher picker for cash wallets", () => {
    renderForm(<WalletForm submitLabel="Add wallet" onSubmit={jest.fn()} providers={PROVIDERS} />);

    fireEvent.press(screen.getByTestId("wallet-form-type-e-wallet"));
    expect(screen.getByTestId("matcher-picker")).toBeTruthy();


    // Spec rule 4: cash wallets have empty matchers and the matcher UI is
    // hidden for them. Money enters cash by manual entry, transfer legs and
    // reconciliation — never by a notification, because cash cannot send one.
    expect(screen.queryByTestId("matcher-picker")).toBeNull();
  });

  test("matchers passed in as initial values are submitted unchanged", () => {
    // REPLACES "switching to cash drops any matchers already chosen". That test
    // guarded a rule that no longer exists: picking the cash type used to clear
    // the matcher list behind the user's back. Nothing clears it now — the list
    // IS the answer, and what the user left in it is what gets saved.
    const onSubmit = jest.fn();
    renderForm(
      <WalletForm
        submitLabel="Add wallet"
        onSubmit={onSubmit}
        providers={PROVIDERS}
        initial={{ name: "GCash", matchers: [{ packageName: GCASH_PACKAGE }] }}
      />,
    );

    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ matchers: [{ packageName: GCASH_PACKAGE }] }),
    );
  });

  test("submitting is blocked while a save is in flight", () => {
    const onSubmit = jest.fn();
    renderForm(
      <WalletForm
        submitLabel="Add wallet"
        onSubmit={onSubmit}
        initial={{ name: "BPI" }}
        submitting
      />,
    );

    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    // A second press mid-save is a second wallet, or a duplicate-name error the
    // user cannot explain.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("renders the error the save came back with", () => {
    renderForm(
      <WalletForm
        submitLabel="Add wallet"
        onSubmit={jest.fn()}
        errorMessage="You already have a wallet called BPI."
      />,
    );

    expect(screen.getByTestId("wallet-form-error")).toHaveTextContent(
      "You already have a wallet called BPI.",
    );
  });
});

// ---------------------------------------------------------------------------
// MatcherPicker
// ---------------------------------------------------------------------------

describe("the matcher picker binds a provider plus a hint", () => {
  function renderPicker(overrides: Partial<React.ComponentProps<typeof MatcherPicker>> = {}) {
    const onChange = jest.fn();
    render(
      <MatcherPicker providers={PROVIDERS} value={[]} onChange={onChange} {...overrides} />,
    );
    return onChange;
  }

  test("selecting a provider emits its package", () => {
    const onChange = renderPicker();

    fireEvent.press(screen.getByTestId("matcher-provider-gcash"));

    expect(onChange).toHaveBeenCalledWith([{ packageName: GCASH_PACKAGE, hint: null }]);
  });

  test("shows the provider's human name, never its package or key", () => {
    renderPicker();

    expect(screen.getByTestId("matcher-provider-gcash")).toHaveTextContent(/GCash/);
  });

  test("a hint field appears only once the provider is selected", () => {
    renderPicker();
    expect(screen.queryByTestId("matcher-hint-gcash")).toBeNull();

    renderPicker({ value: [{ packageName: GCASH_PACKAGE }] });

    expect(screen.getAllByTestId("matcher-hint-gcash").length).toBeGreaterThan(0);
  });

  test("typing a hint binds provider PLUS hint", () => {
    const onChange = renderPicker({ value: [{ packageName: GCASH_PACKAGE }] });

    fireEvent.changeText(screen.getByTestId("matcher-hint-gcash"), "GSave");

    // Provider identity alone cannot separate GCash main from GSave — both post
    // from the same package. The hint is the only discriminator there is.
    expect(onChange).toHaveBeenCalledWith([{ packageName: GCASH_PACKAGE, hint: "GSave" }]);
  });

  test("deselecting a provider removes it", () => {
    const onChange = renderPicker({ value: [{ packageName: GCASH_PACKAGE }] });

    fireEvent.press(screen.getByTestId("matcher-provider-gcash"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  test("a stored row from a provider the ruleset no longer ships is kept, not silently dropped", () => {
    const stale: NewWalletMatcher = { packageName: "com.retired.bank", hint: null };
    const onChange = renderPicker({ value: [stale] });

    fireEvent.press(screen.getByTestId("matcher-provider-gcash"));

    // The picker cannot show a provider the installed ruleset has never heard
    // of, and rebuilding the set from what it CAN show would delete the row on
    // the next save — a wallet quietly losing a route the user never touched.
    expect(onChange).toHaveBeenCalledWith([stale, { packageName: GCASH_PACKAGE, hint: null }]);
  });
});

describe("assigning an already-bound pair warns", () => {
  const owners: MatcherOwner[] = [
    { packageName: GCASH_PACKAGE, hint: null, walletId: "w-main", walletName: "GCash" },
  ];

  test("names the wallet that would lose the pair, and says it moves", () => {
    render(
      <MatcherPicker
        providers={PROVIDERS}
        value={[{ packageName: GCASH_PACKAGE }]}
        onChange={jest.fn()}
        owners={owners}
        walletId="w-other"
      />,
    );

    // Silence here is the failure the plan calls out: the pair moves anyway
    // (the repository guarantees it), the user's other wallet quietly stops
    // catching anything, and nothing on screen ever explains it.
    const warning = screen.getByTestId("matcher-conflict-gcash");
    expect(warning).toHaveTextContent(/GCash/);
    expect(warning).toHaveTextContent(/move/i);
  });

  test("a different hint on the same provider is not a conflict", () => {
    render(
      <MatcherPicker
        providers={PROVIDERS}
        value={[{ packageName: GCASH_PACKAGE, hint: "GSave" }]}
        onChange={jest.fn()}
        owners={owners}
        walletId="w-other"
      />,
    );

    // GCash main + GSave is the arrangement the hint column exists for.
    // Warning here would talk the user out of the one setup that keeps their
    // savings out of their spending money.
    expect(screen.queryByTestId("matcher-conflict-gcash")).toBeNull();
  });

  test("a wallet holding its own pair is not warned about itself", () => {
    render(
      <MatcherPicker
        providers={PROVIDERS}
        value={[{ packageName: GCASH_PACKAGE }]}
        onChange={jest.fn()}
        owners={owners}
        walletId="w-main"
      />,
    );

    expect(screen.queryByTestId("matcher-conflict-gcash")).toBeNull();
  });

  test("an unselected provider is never warned about", () => {
    render(
      <MatcherPicker
        providers={PROVIDERS}
        value={[]}
        onChange={jest.fn()}
        owners={owners}
        walletId="w-other"
      />,
    );

    expect(screen.queryByTestId("matcher-conflict-gcash")).toBeNull();
  });
});
