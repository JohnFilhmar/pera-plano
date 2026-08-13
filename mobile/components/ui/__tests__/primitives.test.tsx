// components/ui/__tests__/primitives.test.tsx — m1c plan Task 2.
//
// Every screen in M1c, M2 and M3 is assembled from these eight primitives, so a
// defect here is a defect on forty screens at once. Five of these tests are
// load-bearing well past this file:
//
//   - `Button loading` keeps the label MOUNTED. A spinner that replaces the
//     label collapses the button to spinner-width, and the layout jumps under a
//     finger that is already travelling — on a confirm dialog that means
//     tapping whatever slid into the gap.
//   - `Button loading` refuses the press. A double-tapped submit is a
//     double-committed transaction.
//   - a destructive `ConfirmDialog` paints `danger` on CONFIRM, never on
//     cancel. Swapped, the safe action looks dangerous and the wipe looks safe.
//   - `Chip` tone `soon` is the same grey `SoonGate` already ships. Grey means
//     "not built yet"; brand green means "built, needs Plus" (docs/11
//     "TWO GATING STATES"). Two different promises to the user.
//   - nothing renders a hex literal. A literal renders identically in both
//     themes, which is the one thing the token system exists to prevent — and
//     it fails silently, in dark mode, on a device no test runs on.
import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Modal, Text } from "react-native";
import { Send, Wallet } from "lucide-react-native";

import { SoonGate } from "@/components/gates/soon_gate";
import { BottomSheet } from "../bottom_sheet";
import { Button } from "../button";
import { Card } from "../card";
import { Chip } from "../chip";
import { ConfirmDialog } from "../confirm_dialog";
import { EmptyState } from "../empty_state";
import { ListRow } from "../list_row";
import { SectionHeader } from "../section_header";

const noop = () => {};

/**
 * Class *lists*, not the raw string. `bg-fg-2` is a substring of
 * `bg-fg-2-dark` and `text-fg` is a substring of `text-fg-2`, so a
 * `toContain` on the joined string quietly passes on the wrong token.
 */
function classListOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Every primitive renders its required content
// ---------------------------------------------------------------------------

const PRIMITIVES: [name: string, element: ReactElement, expected: string][] = [
  [
    "Card",
    <Card testID="card">
      <Text>Total balance</Text>
    </Card>,
    "Total balance",
  ],
  ["Chip", <Chip testID="chip" label="Groceries" tone="neutral" />, "Groceries"],
  ["Button", <Button testID="button" title="Save" onPress={noop} />, "Save"],
  [
    "ListRow",
    <ListRow testID="list-row" title="GCash" subtitle="Catches: GCash" />,
    "GCash",
  ],
  [
    "BottomSheet",
    <BottomSheet visible onDismiss={noop} title="Pick a wallet">
      <Text>Sheet body</Text>
    </BottomSheet>,
    "Pick a wallet",
  ],
  [
    "EmptyState",
    <EmptyState
      title="No wallets yet"
      body="Add the bank or e-wallet you use most."
    />,
    "No wallets yet",
  ],
  [
    "ConfirmDialog",
    <ConfirmDialog
      visible
      title="Delete this wallet?"
      body="Its transactions stay in the ledger."
      confirmLabel="Delete wallet"
      onConfirm={noop}
      onCancel={noop}
    />,
    "Delete this wallet?",
  ],
  ["SectionHeader", <SectionHeader title="This month" />, "This month"],
];

test.each(PRIMITIVES)("%s renders its required content", (_name, element, expected) => {
  render(element);
  expect(screen.getByText(expected)).toBeTruthy();
});

test("all eight primitives are real components, not stubs", () => {
  // Guards the parametrized list above from silently shrinking.
  expect(PRIMITIVES).toHaveLength(8);
});

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

test("Button loading shows the spinner AND refuses the press", () => {
  const onPress = jest.fn();
  render(<Button testID="btn" title="Save" onPress={onPress} loading />);

  expect(screen.getByTestId("button-spinner")).toBeTruthy();
  fireEvent.press(screen.getByTestId("btn"));
  // The double-submit case: a spinner is decoration, not a lock.
  expect(onPress).not.toHaveBeenCalled();
  expect(screen.getByTestId("btn").props.accessibilityState).toMatchObject({
    disabled: true,
    busy: true,
  });
});

test("Button loading keeps its width — the label is hidden, never unmounted", () => {
  render(<Button testID="btn" title="Save" onPress={noop} loading />);

  // Still in the tree, so it still occupies its own width and the button
  // cannot collapse to spinner-width under the user's finger.
  const label = screen.getByText("Save");
  expect(label).toBeTruthy();
  expect(String(label.props.className ?? "").split(/\s+/)).toContain("opacity-0");
});

test("Button not loading renders the label at full opacity and no spinner", () => {
  render(<Button testID="btn" title="Save" onPress={noop} />);

  expect(screen.queryByTestId("button-spinner")).toBeNull();
  expect(String(screen.getByText("Save").props.className ?? "").split(/\s+/)).not.toContain(
    "opacity-0",
  );
});

test("Button disabled does not fire onPress", () => {
  const onPress = jest.fn();
  render(<Button testID="btn" title="Save" onPress={onPress} disabled />);

  fireEvent.press(screen.getByTestId("btn"));
  expect(onPress).not.toHaveBeenCalled();
});

test("Button enabled fires onPress exactly once", () => {
  const onPress = jest.fn();
  render(<Button testID="btn" title="Save" onPress={onPress} />);

  fireEvent.press(screen.getByTestId("btn"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("Button destructive is the only variant that paints danger", () => {
  render(<Button testID="danger-btn" title="Delete wallet" onPress={noop} variant="destructive" />);
  expect(classListOf("danger-btn")).toContain("bg-danger");
  expect(classListOf("danger-btn")).toContain("dark:bg-danger-dark");
  screen.unmount();

  for (const variant of ["primary", "secondary", "ghost"] as const) {
    render(<Button testID={`btn-${variant}`} title="Save" onPress={noop} variant={variant} />);
    expect(classListOf(`btn-${variant}`).join(" ")).not.toMatch(/danger/);
    screen.unmount();
  }
});

// ---------------------------------------------------------------------------
// ConfirmDialog — this component guards the data wipe
// ---------------------------------------------------------------------------

function renderConfirm(destructive: boolean, handlers: {
  onConfirm: jest.Mock;
  onCancel: jest.Mock;
}) {
  render(
    <ConfirmDialog
      visible
      destructive={destructive}
      title="Delete everything?"
      body="This erases every transaction on this device."
      confirmLabel="Delete everything"
      onConfirm={handlers.onConfirm}
      onCancel={handlers.onCancel}
    />,
  );
}

test("ConfirmDialog fires onConfirm from the confirm action", () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  renderConfirm(false, { onConfirm, onCancel });

  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test("ConfirmDialog fires onCancel from the cancel action", () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  renderConfirm(false, { onConfirm, onCancel });

  fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test("ConfirmDialog fires onCancel from the backdrop", () => {
  // A backdrop that swallows the press traps the user in a modal with no
  // system-back affordance on iOS-style layouts and no obvious way out.
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  renderConfirm(false, { onConfirm, onCancel });

  fireEvent.press(screen.getByTestId("confirm-dialog-backdrop"));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test("a destructive ConfirmDialog paints danger on CONFIRM, not on cancel", () => {
  renderConfirm(true, { onConfirm: jest.fn(), onCancel: jest.fn() });

  expect(classListOf("confirm-dialog-confirm")).toContain("bg-danger");
  expect(classListOf("confirm-dialog-confirm")).toContain("dark:bg-danger-dark");
  // Swapped, the safe way out looks dangerous and the irreversible one looks
  // safe — the user learns to tap the red thing to escape.
  expect(classListOf("confirm-dialog-cancel").join(" ")).not.toMatch(/danger/);
});

test("a non-destructive ConfirmDialog paints danger on neither action", () => {
  renderConfirm(false, { onConfirm: jest.fn(), onCancel: jest.fn() });

  expect(classListOf("confirm-dialog-confirm").join(" ")).not.toMatch(/danger/);
  expect(classListOf("confirm-dialog-cancel").join(" ")).not.toMatch(/danger/);
});

test("ConfirmDialog renders the caller's confirmLabel verbatim and never a bare OK", () => {
  renderConfirm(true, { onConfirm: jest.fn(), onCancel: jest.fn() });

  // "OK" tells the user nothing about what they just agreed to.
  expect(screen.getByText("Delete everything")).toBeTruthy();
  expect(screen.queryByText("OK")).toBeNull();
  expect(screen.queryByText("Ok")).toBeNull();
});

test("ConfirmDialog hidden renders nothing", () => {
  render(
    <ConfirmDialog
      visible={false}
      title="Delete everything?"
      body="This erases every transaction on this device."
      confirmLabel="Delete everything"
      onConfirm={noop}
      onCancel={noop}
    />,
  );
  expect(screen.toJSON()).toBeNull();
});

test("confirmLabel is required at the type level — it can never fall back to OK", () => {
  const invalid = (
    // @ts-expect-error confirmLabel is REQUIRED; omitting it must not compile.
    // This assertion is enforced by `tsc --noEmit`, not by the runtime: making
    // confirmLabel optional turns the @ts-expect-error into an error itself.
    <ConfirmDialog
      visible
      destructive
      title="Delete everything?"
      body="This erases every transaction on this device."
      onConfirm={noop}
      onCancel={noop}
    />
  );
  expect(invalid).toBeTruthy();
});

// ---------------------------------------------------------------------------
// BottomSheet
// ---------------------------------------------------------------------------

test("BottomSheet hidden renders nothing at all", () => {
  render(
    <BottomSheet visible={false} onDismiss={noop} title="Pick a wallet">
      <Text>Sheet body</Text>
    </BottomSheet>,
  );
  // Not "rendered offscreen": an offscreen sheet still captures touches over
  // the whole screen and the app appears frozen.
  expect(screen.toJSON()).toBeNull();
  expect(screen.queryByText("Sheet body")).toBeNull();
});

test("BottomSheet dismisses on backdrop press", () => {
  const onDismiss = jest.fn();
  render(
    <BottomSheet visible onDismiss={onDismiss} title="Pick a wallet">
      <Text>Sheet body</Text>
    </BottomSheet>,
  );

  fireEvent.press(screen.getByTestId("bottom-sheet-backdrop"));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test("BottomSheet dismisses on Android back", () => {
  // Android's system back is the primary dismiss gesture on this platform
  // (docs/11: "Android conventions ... system back").
  const onDismiss = jest.fn();
  render(
    <BottomSheet visible onDismiss={onDismiss} title="Pick a wallet">
      <Text>Sheet body</Text>
    </BottomSheet>,
  );

  const modal = screen.UNSAFE_getByType(Modal);
  expect(typeof modal.props.onRequestClose).toBe("function");
  modal.props.onRequestClose();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Chip — the two gating states must never converge
// ---------------------------------------------------------------------------

test("Chip tone soon renders the grey fg-2 token, not brand green", () => {
  render(<Chip testID="chip" label="Soon" tone="soon" />);

  const classes = classListOf("chip");
  expect(classes).toContain("bg-fg-2");
  expect(classes).toContain("dark:bg-fg-2-dark");
  // Brand green means "built, needs Plus"; grey means "not built yet".
  expect(classes).not.toContain("bg-brand");
  expect(classes).not.toContain("bg-brand-soft");
});

test("Chip tone soon is the exact chip SoonGate ships — one grey, not two", () => {
  render(<Chip testID="chip" label="Soon" tone="soon" />);
  const chipClasses = classListOf("chip");
  screen.unmount();

  // Every FeatureKey is "soon" in M1 (constants/shipped_features.ts).
  render(
    <SoonGate feature="limits">
      <Text>Monthly limit</Text>
    </SoonGate>,
  );
  expect(classListOf("soon-chip")).toEqual(chipClasses);
});

test("Chip tone brand is visibly not the soon grey", () => {
  render(<Chip testID="chip" label="Plus" tone="brand" />);
  expect(classListOf("chip")).not.toContain("bg-fg-2");
});

test("Chip fires onPress when given one, and carries no button role without one", () => {
  const onPress = jest.fn();
  render(<Chip testID="chip" label="Groceries" tone="neutral" onPress={onPress} />);
  fireEvent.press(screen.getByTestId("chip"));
  expect(onPress).toHaveBeenCalledTimes(1);
  screen.unmount();

  render(<Chip testID="chip" label="Groceries" tone="neutral" />);
  expect(screen.getByTestId("chip").props.accessibilityRole).toBeUndefined();
});

// ---------------------------------------------------------------------------
// ListRow / SectionHeader / EmptyState / Card
// ---------------------------------------------------------------------------

test("ListRow destructive paints danger on the title", () => {
  render(<ListRow testID="row" title="Delete all data" destructive />);
  const title = screen.getByText("Delete all data");
  expect(String(title.props.className ?? "").split(/\s+/)).toContain("text-danger");
});

test("ListRow fires onPress and renders its slots", () => {
  const onPress = jest.fn();
  render(
    <ListRow
      testID="row"
      title="GCash"
      subtitle="Catches: GCash"
      left={<Text>L</Text>}
      right={<Text>R</Text>}
      onPress={onPress}
    />,
  );

  expect(screen.getByText("L")).toBeTruthy();
  expect(screen.getByText("R")).toBeTruthy();
  expect(screen.getByText("Catches: GCash")).toBeTruthy();
  fireEvent.press(screen.getByTestId("row"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("SectionHeader renders its optional action and fires it", () => {
  const onPress = jest.fn();
  render(<SectionHeader title="This month" action={{ label: "See all", onPress }} />);

  fireEvent.press(screen.getByText("See all"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("SectionHeader without an action renders no action", () => {
  render(<SectionHeader title="This month" />);
  expect(screen.queryByTestId("section-header-action")).toBeNull();
});

test("EmptyState defaults to the lucide Send paper-airplane brand mark", () => {
  // docs/11: 'Brand mark = the "Send" paper airplane'. Compared structurally
  // rather than by testID, so swapping the default icon fails here.
  render(<EmptyState title="All caught up" body="Nothing to review." />);
  const withDefault = JSON.stringify(screen.toJSON());
  screen.unmount();

  render(<EmptyState icon={Send} title="All caught up" body="Nothing to review." />);
  expect(JSON.stringify(screen.toJSON())).toBe(withDefault);
  screen.unmount();

  render(<EmptyState icon={Wallet} title="All caught up" body="Nothing to review." />);
  expect(JSON.stringify(screen.toJSON())).not.toBe(withDefault);
});

test("EmptyState renders its optional action and fires it", () => {
  const onPress = jest.fn();
  render(
    <EmptyState
      title="No wallets yet"
      body="Add the bank or e-wallet you use most."
      action={{ label: "Add a wallet", onPress }}
    />,
  );

  fireEvent.press(screen.getByText("Add a wallet"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("Card default carries a shadow and flat does not", () => {
  render(
    <Card testID="default-card">
      <Text>x</Text>
    </Card>,
  );
  expect(classListOf("default-card").join(" ")).toMatch(/shadow/);
  screen.unmount();

  render(
    <Card testID="flat-card" variant="flat">
      <Text>x</Text>
    </Card>,
  );
  expect(classListOf("flat-card").join(" ")).not.toMatch(/shadow/);
});

// ---------------------------------------------------------------------------
// No hex literals anywhere — swept across every colour-bearing variant
// ---------------------------------------------------------------------------

const COLOUR_BEARING: [name: string, element: ReactElement][] = [
  ["Card default", <Card><Text>x</Text></Card>],
  ["Card flat", <Card variant="flat"><Text>x</Text></Card>],
  ["Chip neutral", <Chip label="Groceries" tone="neutral" />],
  ["Chip brand", <Chip label="Linked" tone="brand" />],
  ["Chip warn", <Chip label="Due in 3d" tone="warn" />],
  ["Chip danger", <Chip label="Overdue" tone="danger" />],
  ["Chip soon", <Chip label="Soon" tone="soon" />],
  ["Button primary", <Button title="Save" onPress={noop} variant="primary" />],
  ["Button secondary", <Button title="Save" onPress={noop} variant="secondary" />],
  ["Button ghost", <Button title="Save" onPress={noop} variant="ghost" />],
  ["Button destructive", <Button title="Delete" onPress={noop} variant="destructive" />],
  ["Button loading", <Button title="Save" onPress={noop} loading />],
  ["Button disabled", <Button title="Save" onPress={noop} disabled />],
  ["ListRow", <ListRow title="GCash" subtitle="Catches: GCash" />],
  ["ListRow destructive", <ListRow title="Delete all data" destructive />],
  [
    "BottomSheet",
    <BottomSheet visible onDismiss={noop} title="Pick a wallet">
      <Text>Sheet body</Text>
    </BottomSheet>,
  ],
  [
    "EmptyState",
    <EmptyState title="No wallets yet" body="Add one." action={{ label: "Add", onPress: noop }} />,
  ],
  [
    "ConfirmDialog",
    <ConfirmDialog
      visible
      title="Delete this wallet?"
      body="Its transactions stay."
      confirmLabel="Delete wallet"
      onConfirm={noop}
      onCancel={noop}
    />,
  ],
  [
    "ConfirmDialog destructive",
    <ConfirmDialog
      visible
      destructive
      title="Delete everything?"
      body="This cannot be undone."
      confirmLabel="Delete everything"
      onConfirm={noop}
      onCancel={noop}
    />,
  ],
  ["SectionHeader", <SectionHeader title="This month" action={{ label: "See all", onPress: noop }} />],
];

test.each(COLOUR_BEARING)("%s emits no hex literal", (_name, element) => {
  render(element);
  // Sweeps the whole rendered tree — every className and every resolved style
  // on every host node, not just the root.
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/#[0-9a-fA-F]{3,8}/);
});
