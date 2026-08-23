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
import { PLUS_BETA_LABEL, PlusGate } from "../plus_gate";
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

// The "soon" fixture. Every FeatureKey is "shipped" as of m3b Task 8 — the
// rollout table's last row — so there is no longer a key whose REAL state is
// "soon" for SoonGate's own tests to exercise against. SoonGate's
// soon-vs-shipped contract still needs coverage (a future feature can land
// ahead of its own rollout and go through exactly this path), so this
// `describe` block forces one shipped key back to "soon" for its own
// duration via `beforeEach`/`afterEach`, independent of whatever
// `constants/shipped_features.ts` currently says in the real app. Which key
// is arbitrary; `reports` is kept only because it is a name every prior
// revision of this fixture already used.
const FEATURE = "reports" as const;

// SHIPPED_FEATURES is exported readonly — app code must never mutate the
// single per-build rollout switch at runtime. Tests cast away readonly at
// this one contained call site.
function setShipState(key: FeatureKey, state: ShipState): void {
  (SHIPPED_FEATURES as Record<FeatureKey, ShipState>)[key] = state;
}

beforeEach(() => {
  setShipState(FEATURE, "soon");
});

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

  // INVERTED from the pre-R2-fix version of this test, which asserted the
  // opposite: `expect(screen.queryByText("Plus")).toBeNull()` AND
  // `expect(screen.toJSON()?.type).toBe("Text")` — i.e. it asserted that NO
  // badge, and no wrapper of any kind, ever rendered on the unlocked path.
  // That was only true because `getTier() === "plus"` returned bare children
  // (plus_gate.tsx:31 before this task); R2 makes the badge render, so the
  // old expectation is now exactly the regression this suite exists to catch.
  test("plus tier renders children AND the unlocked badge, not the locked 'Plus' label", () => {
    __setTierForTests("plus");
    render(
      <PlusGate capability={CAPABILITY}>
        <Text testID="plus-child">Subscriptions</Text>
      </PlusGate>,
    );
    expect(screen.getByTestId("plus-child")).toBeTruthy();
    // The LOCKED label never appears on the unlocked path — the two
    // treatments use different copy on purpose (PLUS_BETA_LABEL below).
    expect(screen.queryByText("Plus")).toBeNull();
    expect(screen.getByTestId("plus-badge")).toBeTruthy();
  });

  test("on plus, children render AND the badge shows — it is not silently absent", () => {
    __setTierForTests("plus");
    render(
      <PlusGate capability={CAPABILITY}>
        <Text>Subscriptions</Text>
      </PlusGate>,
    );
    screen.getByText("Subscriptions");
    screen.getByTestId("plus-badge");
    screen.getByText(PLUS_BETA_LABEL);
  });

  test("the unlocked badge does not intercept presses", () => {
    __setTierForTests("plus");
    const onPress = jest.fn();
    render(
      <PlusGate capability={CAPABILITY}>
        <Pressable testID="inner" onPress={onPress}>
          <Text>Subscriptions</Text>
        </Pressable>
      </PlusGate>,
    );
    fireEvent.press(screen.getByTestId("inner"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("plus-gate")).toBeNull();
  });

  test("on free, the gate still intercepts and still opens the sheet", () => {
    __setTierForTests("free");
    render(
      <PlusGate capability={CAPABILITY}>
        <Text>Subscriptions</Text>
      </PlusGate>,
    );
    screen.getByTestId("plus-gate");
    screen.getByTestId("plus-badge");
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

  // REMOVED (not inverted): "the upgrade button is inert — billing is
  // post-MVP" used to press `testID="upgrade-button"`, the disabled "Upgrade
  // to Plus" CTA. That element is deleted, not merely disabled — "Also in
  // scope" in this task's brief: "Delete the price blocks and the 'Start
  // 14-day free trial' button entirely. Do not render them disabled — a
  // disabled price is still a published price." A testID that no longer
  // exists has nothing left to assert; keeping this test would fail on a
  // `getByTestId` throw, not on a meaningful assertion.
  test("'Not now' calls onClose", () => {
    const onClose = jest.fn();
    render(<UpgradeSheet visible onClose={onClose} capability="backup" />);
    fireEvent.press(screen.getByTestId("upgrade-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("no free-tier count is published anywhere in the sheet", () => {
    __setTierForTests("free");
    render(<UpgradeSheet visible onClose={() => {}} capability="wallets" />);
    // entitlements.ts caps limits, goals and loans at 1; the design's table says
    // 3. Until docs/05 settles it, the app publishes neither number.
    //
    // NOT `queryByText("3")` / `queryByText(/^1,/)` — both READ correct and
    // BOTH ARE INCAPABLE OF EVER FAILING, on any row, in any version of this
    // component. Every row renders `Free: {row.free}` as one Text node, so
    // the string RNTL actually sees is always "Free: 3" or "Free: 1, ...",
    // never a bare "3" or "1,...". `queryByText("3")` default-matches the
    // FULL node text (exact match), which "Free: 3" never equals; `/^1,/` is
    // anchored to the start of that same string, which is always "Free: ",
    // never "1,". Proved empirically, not assumed: temporarily reverting
    // `wallets.free` to the banned "3", and separately `goals.free` to the
    // banned "1, progress tracking", left both old assertions green either
    // time (see task-2-report.md). Row count was never the issue — a table
    // of one row or eight rows fails the same way, because the prefix does.
    //
    // An UNANCHORED digit search is not defeated by the prefix: it matches
    // anywhere in a node's text, so "Free: 3" contains a match (correctly
    // fails the test) and "Free: A few" contains none (correctly passes).
    // It also sweeps every row and every column at once, not just the
    // triggering capability's Free value, which is strictly more coverage
    // than the two assertions it replaces ever had even in principle.
    expect(screen.queryByText(/\d/)).toBeNull();
  });
});
