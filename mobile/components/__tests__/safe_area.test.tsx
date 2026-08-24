// components/__tests__/safe_area.test.tsx — the system bars, asserted.
//
// THE DEFECT: app.json sets `edgeToEdgeEnabled: true`, so this app draws BEHIND
// the status bar and behind Android's navigation bar. Nothing in the app read a
// single inset, so every bottom-anchored control sat under the ▢ ◁ strip — the
// onboarding footer had a flat `pb-6` (24dp) against a navigation bar measured
// at 126px on a physical A54. Found by a human holding a phone; invisible to
// 3,217 passing tests, because none of them had any notion of a system bar.
//
// WHY THESE TESTS CAN SEE IT WHEN THE COMPONENT SUITES CANNOT. Insets arrive
// through a React context, and every other suite mounts its subject with no
// provider above it — where test_support/safe_area_mock.ts answers zero, so
// "padded for the navigation bar" and "did not" are indistinguishable. These
// tests mount a real provider carrying DELIBERATELY ASYMMETRIC, NON-ZERO
// insets, which is what turns the question into an observable fact: top and
// bottom differ, so a component that pads the wrong edge fails rather than
// passing by coincidence.
//
// `initialMetrics` is what makes that provider usable under Jest: without it
// `SafeAreaProvider` holds `insets === null` and renders NO children at all
// until a native measurement event that never fires here.
import { render } from "@testing-library/react-native";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactElement } from "react";

import { BottomSheet } from "@/components/ui/bottom_sheet";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";

// Nothing device-specific: two numbers that are merely non-zero and unequal.
// A real device supplies its own, which is the entire point of insets — a
// phone in gesture navigation and the same phone in three-button navigation
// report different bottoms.
const INSET_TOP = 24;
const INSET_BOTTOM = 48;

function withInsets(ui: ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: INSET_TOP, bottom: INSET_BOTTOM, left: 0, right: 0 },
      }}
    >
      {ui}
    </SafeAreaProvider>,
  );
}

/** The padding actually applied, after NativeWind's `className` styles and any
 * `style` prop have been merged the way React Native merges them. */
function paddingOf(element: { props: { style?: unknown } }) {
  const flat = StyleSheet.flatten(element.props.style as never) ?? {};
  return {
    top: (flat as { paddingTop?: number }).paddingTop,
    bottom: (flat as { paddingBottom?: number }).paddingBottom,
  };
}

test("the onboarding footer clears the navigation bar, and the header the status bar", () => {
  const screen = withInsets(
    <OnboardingFrame step="welcome" title="Welcome" onPrimary={() => {}}>
      <Text>body</Text>
    </OnboardingFrame>,
  );

  // The owner's report, in one assertion: "[the footer buttons] need to be
  // raised up because [they're] being blocked by phone navigation buttons".
  expect(paddingOf(screen.getByTestId("onboarding-frame"))).toEqual({
    top: INSET_TOP,
    bottom: INSET_BOTTOM,
  });
});

test("a bottom sheet adds the navigation bar to its own padding rather than replacing it", () => {
  const screen = withInsets(
    <BottomSheet visible onDismiss={() => {}} title="Pick one">
      <Text>option</Text>
    </BottomSheet>,
  );

  // ADDED, NOT SUBSTITUTED. A sheet that swapped its 32dp of design padding for
  // the inset would be TIGHTER than before on a phone in gesture navigation,
  // where the bottom inset is near zero — a fix that regresses the majority of
  // devices to rescue the minority.
  expect(paddingOf(screen.getByTestId("bottom-sheet")).bottom).toBe(32 + INSET_BOTTOM);
});

test("a surface keeps its design padding on a device that reports no insets", () => {
  // A phone in gesture navigation with no display cutout reports very close to
  // this, and the emulator reports exactly it — so the zero case is a real
  // device, not a test convenience. The design padding has to SURVIVE it: the
  // failure mode of an inset-only fix is a sheet that looks fine on the
  // three-button phone it was tested on and cramped on every other one.
  const screen = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }}
    >
      <View>
        <BottomSheet visible onDismiss={() => {}}>
          <Text>option</Text>
        </BottomSheet>
      </View>
    </SafeAreaProvider>,
  );

  expect(paddingOf(screen.getByTestId("bottom-sheet")).bottom).toBe(32);
});
