// app/index.tsx — the entry route.
//
// ORDERING HAZARD (coordinator ruling, task-17 review round 2): the
// (onboarding) route group does not exist yet — it ships in the M3
// onboarding plan
// (docs/superpowers/plans/2026-08-02-mobile-insight-m3c-onboarding-client.md).
// That plan adds the onboarding-vs-tabs branch TOGETHER WITH the
// app/(onboarding)/ route it depends on, in the same change — so there is
// never an intermediate state where the branch exists but the route
// doesn't. (An earlier version of this file had the branch gated behind a
// `ONBOARDING_ROUTE_SHIPPED` flag plus an `as Href` cast to satisfy
// typedRoutes; that cast disabled the exact safety check that would catch
// someone flipping the flag before the route existed, so it was removed
// rather than kept as a standing hazard.)
//
// Until that plan lands, this route falls through to the tabs
// unconditionally.
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href="/(tabs)" />;
}
