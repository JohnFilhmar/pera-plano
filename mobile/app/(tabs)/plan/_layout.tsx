// app/(tabs)/plan/_layout.tsx — the Plan tab's own Stack.
//
// WITHOUT THIS FILE THE TAB BAR IS BROKEN, not merely unstyled. expo-router
// builds a navigator from the directory tree: with no layout here, every route
// under plan/ — including the dynamic ones — became a DIRECT CHILD of the tab
// navigator in app/(tabs)/_layout.tsx and got its own tab button. On a physical
// A54 the bar rendered `plan/bills/[id]`, `plan/goals/[id]`, `plan/limits/[id]`
// and `plan/loans/[id]` as labels, with a `⏷` placeholder where each icon
// should be, running off the right edge of the screen.
//
// TAB_CONFIG did not prevent it. That list controls the five tabs it declares;
// it says nothing about routes it does not name, and expo-router registers
// those anyway. The fix is structural — a Stack here makes plan/ ONE tab whose
// screens push inside it — rather than hiding each stray route with
// `href: null`, which would need a new line every time a screen is added and
// would fail silently, in the tab bar, when someone forgets.
//
// headerShown: false for the same reason as the onboarding group: these screens
// draw their own headers, so an OS-drawn one would be a second, redundant bar.
import { Stack } from "expo-router";

export default function PlanLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
