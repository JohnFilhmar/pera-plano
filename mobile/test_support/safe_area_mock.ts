// test_support/safe_area_mock.ts — makes `useSafeAreaInsets()` answer with
// zeros instead of throwing when a test renders a component on its own.
//
// WHY THIS IS NEEDED AT ALL. react-native-safe-area-context deliberately THROWS
// ("No safe area value available…") when nothing above the caller provides
// insets, and that is the right behaviour for an app: the provider is mounted
// once at the root (app/_layout.tsx) and a missing one is a bug worth a loud
// crash. It is the wrong behaviour for a component suite, where the subject is
// mounted directly with no app around it — thirty-one suites render an
// onboarding step or a sheet that way, and every one of them would fail on a
// question they are not asking.
//
// ONLY THE TWO HOOKS ARE REPLACED, and only in their no-provider case: they
// still read `SafeAreaInsetsContext` first, so a test that DOES mount a real
// `SafeAreaProvider` gets that provider's real values. That is what keeps
// components/__tests__/safe_area.test.tsx honest — it supplies deliberately
// non-zero insets and asserts the padding they produce, through this same
// mock. Replacing the hooks outright with a constant would have made those
// assertions vacuous.
//
// The real `SafeAreaProvider`, `SafeAreaView`, and both contexts are passed
// through untouched.
import { useContext } from "react";

import type * as SafeAreaContextModule from "react-native-safe-area-context";

type SafeAreaContext = typeof SafeAreaContextModule;

/** What a device with no cutouts and gesture navigation would report. */
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/** Only a shape; no test asserts against these numbers. */
const NO_FRAME = { x: 0, y: 0, width: 320, height: 640 };

export function createSafeAreaMock(): SafeAreaContext {
  const actual = jest.requireActual<SafeAreaContext>("react-native-safe-area-context");

  return {
    ...actual,
    useSafeAreaInsets: () => useContext(actual.SafeAreaInsetsContext) ?? NO_INSETS,
    useSafeAreaFrame: () => useContext(actual.SafeAreaFrameContext) ?? NO_FRAME,
  };
}
