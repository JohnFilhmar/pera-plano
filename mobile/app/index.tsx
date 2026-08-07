// app/index.tsx — the entry route. Decides between onboarding and the tabs
// from onboarding_complete, per task-17-brief.md rule 3.
//
// ORDERING HAZARD: the (onboarding) route group does not exist yet — it
// ships in the M3 onboarding plan
// (docs/superpowers/plans/2026-08-02-mobile-insight-m3c-onboarding-client.md).
// Routing to a nonexistent route crashes expo-router ("no route named
// (onboarding)"), so this falls through to the tabs UNCONDITIONALLY today,
// regardless of onboarding_complete. Flip ONBOARDING_ROUTE_SHIPPED to true
// once that plan lands the (onboarding) group — that is the only change this
// file needs at that point.
import { Redirect } from "expo-router";
import type { Href } from "expo-router";
import { getLastBootstrapResult } from "@/lib/bootstrap";

const ONBOARDING_ROUTE_SHIPPED = false;

// typedRoutes (app.json experiments.typedRoutes) generates the Href union
// from routes that actually exist under app/ — "/(onboarding)" isn't a
// member yet, so a bare `href="/(onboarding)"` fails `tsc --noEmit` today,
// correctly, since the route doesn't exist. This cast is the one place that
// escape is intentional: the branch below is unreachable in production while
// ONBOARDING_ROUTE_SHIPPED is false, so nothing ever actually navigates
// there. Once the M3 onboarding plan adds app/(onboarding)/, drop this cast —
// typedRoutes will have picked up the real route and `"/(onboarding)"` will
// type-check on its own.
const ONBOARDING_HREF = "/(onboarding)" as Href;

export default function Index() {
  // The root layout has already awaited bootstrapApp() once before mounting
  // the navigator (app/_layout.tsx), so this is a synchronous read of an
  // already-resolved result — no second DB round-trip, no second render-blank
  // gate. `null` only if bootstrapApp() somehow never resolved; treated the
  // same as "not onboarded" but still falls through to the tabs below since
  // the onboarding route isn't shipped.
  const result = getLastBootstrapResult();
  const onboardingComplete = result?.onboardingComplete ?? false;

  if (!onboardingComplete && ONBOARDING_ROUTE_SHIPPED) {
    return <Redirect href={ONBOARDING_HREF} />;
  }
  return <Redirect href="/(tabs)" />;
}
