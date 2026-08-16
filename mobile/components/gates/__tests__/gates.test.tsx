import {
  registerCSS,
  setupAllComponents,
} from "react-native-css-interop/test";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { palette } from "@/constants/colors";
import { SHIPPED_FEATURES } from "@/constants/shipped_features";
import type { FeatureKey, ShipState } from "@/constants/shipped_features";
import { __setTierForTests } from "@/lib/entitlements";
import { SoonGate } from "../soon_gate";
import { PlusGate } from "../plus_gate";
import { UpgradeSheet } from "../upgrade_sheet";

// Registers cssInterop on the core RN host components (View/Text/Pressable/...)
// — skipped automatically under NODE_ENV==="test" — and hand-compiles the exact
// utility classes these gates use, so assertions below read genuinely resolved
// styles rather than literal className strings.
setupAllComponents();
beforeAll(() => {
  registerCSS(`
    .opacity-40 { opacity: 0.4; }
    .bg-fg-2 { background-color: ${palette["fg-2"]}; }
    .bg-brand { background-color: ${palette.brand}; }
  `);
});

// The "soon" fixture — whichever key is still soon. It has moved four times as
// the rollout table advanced: `limits` (m2-part2 Task 14), `goals` (m2b Task 9),
// `bills` (m2c Task 6), `safe_to_spend` (M3 Part 2 Task 7). It now names an M3b
// key; m3b Task 8 retires this fixture along with the rest of the Soon list.
// Mutated directly in one test below and restored here, since the map has no
// test seam of its own.
const FEATURE = "reports" as const;

// SHIPPED_FEATURES is exported readonly — app code must never mutate the
// single per-build rollout switch at runtime. Tests cast away readonly at
// this one contained call site.
function setShipState(key: FeatureKey, state: ShipState): void {
  (SHIPPED_FEATURES as Record<FeatureKey, ShipState>)[key] = state;
}

afterEach(() => {
  setShipState(FEATURE, "soon");
  __setTierForTests(null);
});

describe("SoonGate", () => {
  test("renders a grey Soon chip alongside the (desaturated) children", () => {
    render(
      <SoonGate feature={FEATURE}>
        <Text>Monthly limit</Text>
      </SoonGate>,
    );
    expect(screen.getByText("Soon")).toBeTruthy();
    expect(screen.getByText("Monthly limit")).toBeTruthy();
  });

  test("blocks presses on interactive children while soon", () => {
    const onPress = jest.fn();
    render(
      <SoonGate feature={FEATURE}>
        <Pressable testID="soon-child" onPress={onPress}>
          <Text>Create limit</Text>
        </Pressable>
      </SoonGate>,
    );
    fireEvent.press(screen.getByTestId("soon-child"));
    expect(onPress).not.toHaveBeenCalled();
  });

  test("renders children with no wrapper and no chip once the feature ships", () => {
    setShipState(FEATURE, "shipped");
    render(
      <SoonGate feature={FEATURE}>
        <Text testID="shipped-child">Monthly limit</Text>
      </SoonGate>,
    );
    expect(screen.getByTestId("shipped-child")).toBeTruthy();
    expect(screen.queryByText("Soon")).toBeNull();
    // Not merely "the chip is hidden" — there is no extra host element at all:
    // the child itself is the render root.
    expect(screen.toJSON()?.type).toBe("Text");
  });

  test("shipped children stay fully interactive (no lingering wrapper swallows touches)", () => {
    setShipState(FEATURE, "shipped");
    const onPress = jest.fn();
    render(
      <SoonGate feature={FEATURE}>
        <Pressable testID="shipped-btn" onPress={onPress}>
          <Text>Create limit</Text>
        </Pressable>
      </SoonGate>,
    );
    fireEvent.press(screen.getByTestId("shipped-btn"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("the Soon chip's background resolves to the fg-2 grey token", () => {
    render(
      <SoonGate feature={FEATURE}>
        <Text>Monthly limit</Text>
      </SoonGate>,
    );
    const chip = screen.getByTestId("soon-chip");
    expect(chip.props.style?.backgroundColor).toBe(
      palette["fg-2"].toLowerCase(),
    );
  });
});

describe("PlusGate", () => {
  const CAPABILITY = "recurring" as const;

  test("free tier renders the brand-green Plus badge", () => {
    __setTierForTests("free");
    render(
      <PlusGate capability={CAPABILITY}>
        <Text>Subscriptions</Text>
      </PlusGate>,
    );
    expect(screen.getByText("Plus")).toBeTruthy();
  });

  test("free tier press opens the upgrade sheet", () => {
    __setTierForTests("free");
    render(
      <PlusGate capability={CAPABILITY}>
        <Text>Subscriptions</Text>
      </PlusGate>,
    );
    expect(screen.queryByTestId("upgrade-sheet")).toBeNull();
    fireEvent.press(screen.getByTestId("plus-gate"));
    expect(screen.getByTestId("upgrade-sheet")).toBeTruthy();
  });

  test("free tier: a real interactive child cannot be pressed through to bypass the paywall", () => {
    __setTierForTests("free");
    const childOnPress = jest.fn();
    render(
      <PlusGate capability={CAPABILITY}>
        <Pressable testID="add-wallet-btn" onPress={childOnPress}>
          <Text>Add Wallet</Text>
        </Pressable>
      </PlusGate>,
    );
    fireEvent.press(screen.getByTestId("add-wallet-btn"));
    expect(childOnPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("upgrade-sheet")).toBeTruthy();
  });

  test("plus tier renders children untouched, with no badge", () => {
    __setTierForTests("plus");
    render(
      <PlusGate capability={CAPABILITY}>
        <Text testID="plus-child">Subscriptions</Text>
      </PlusGate>,
    );
    expect(screen.getByTestId("plus-child")).toBeTruthy();
    expect(screen.queryByText("Plus")).toBeNull();
    expect(screen.toJSON()?.type).toBe("Text");
  });

  test("plus tier children stay fully interactive (no lingering Pressable swallows touches)", () => {
    __setTierForTests("plus");
    const onPress = jest.fn();
    render(
      <PlusGate capability={CAPABILITY}>
        <Pressable testID="plus-btn" onPress={onPress}>
          <Text>Open subscriptions</Text>
        </Pressable>
      </PlusGate>,
    );
    fireEvent.press(screen.getByTestId("plus-btn"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("the Plus badge's background resolves to brand green, distinct from Soon's grey", () => {
    __setTierForTests("free");
    render(
      <PlusGate capability={CAPABILITY}>
        <Text>Subscriptions</Text>
      </PlusGate>,
    );
    const badge = screen.getByTestId("plus-badge");
    expect(badge.props.style?.backgroundColor).toBe(palette.brand.toLowerCase());
    expect(badge.props.style?.backgroundColor).not.toBe(
      palette["fg-2"].toLowerCase(),
    );
  });
});

describe("UpgradeSheet", () => {
  test("renders nothing when not visible", () => {
    render(
      <UpgradeSheet visible={false} onClose={jest.fn()} capability="backup" />,
    );
    expect(screen.queryByTestId("upgrade-sheet")).toBeNull();
  });

  test("shows the Free-vs-Plus row for the given capability", () => {
    render(
      <UpgradeSheet visible onClose={jest.fn()} capability="backup" />,
    );
    expect(
      screen.getByText("Cloud backup / multi-device sync"),
    ).toBeTruthy();
  });

  test("the upgrade button is inert — billing is post-MVP", () => {
    const onClose = jest.fn();
    render(<UpgradeSheet visible onClose={onClose} capability="backup" />);
    // Firing press on a `disabled` Pressable must not run any handler; there
    // is deliberately no onPress wired up at all in MVP.
    fireEvent.press(screen.getByTestId("upgrade-button"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("'Not now' calls onClose", () => {
    const onClose = jest.fn();
    render(<UpgradeSheet visible onClose={onClose} capability="backup" />);
    fireEvent.press(screen.getByTestId("upgrade-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
