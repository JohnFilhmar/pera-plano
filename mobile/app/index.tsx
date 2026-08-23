// app/index.tsx — the entry route (task-10-brief.md; docs/12-encryption-and-app-lock.md
// §5). Reached via NORMAL file-based routing, which per app/_layout.tsx's
// four-condition render gate (interface contract §10) only happens once the
// app is bootstrapped AND unlocked — meaning the database is open and
// `app_settings` is readable, which is what makes the getSetting() call
// below safe. A brand-new user with no keys at all never reaches this file:
// contexts/lock_context.tsx's own "needs_onboarding" status routes them
// through app/lock.tsx directly to app/(onboarding)/index.tsx WITHOUT this
// Stack-hosted route ever mounting (see that file's header comment for why).
//
// This file's own job is narrower: an unlocked user (keys exist) who has
// not finished onboarding — either because Task 10's two steps just ran and
// M3c's remaining steps have not (M3c is not built yet; see
// app/(onboarding)/index.tsx's own fallback for that exact case), or because
// `onboarding_complete` genuinely has never been set — goes to
// "/(onboarding)" rather than the tabs. Everyone else goes to the tabs.
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { BrandMark } from "@/components/ui/brand_mark";
import { getSetting } from "@/lib/db/repos/app_settings_repo";

export default function Index() {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetting("onboarding_complete")
      .then((value) => {
        if (!cancelled) setOnboardingComplete(value);
      })
      .catch(() => {
        // An unreadable setting must never be read as "onboarding is done"
        // — see this file's header comment. app/(onboarding)/index.tsx's own
        // getKeyState() check makes routing here safe even when keys
        // already exist (it falls straight through to "/(tabs)"), so
        // failing TOWARD onboarding, never away from it, is the honest
        // default here.
        if (!cancelled) setOnboardingComplete(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (onboardingComplete === null) {
    // task-7-brief.md Step 3: the launch takeoff plays once during this
    // handoff. It is NOT awaited — `getSetting` above resolves and this
    // component redirects on its own schedule, so the takeoff plays for
    // whatever sliver of time this gap actually takes and is cut off by the
    // navigation the instant the setting answers. Blocking the redirect on
    // the animation finishing would delay first paint of the real screen,
    // which Step 6's device pass explicitly checks for.
    return (
      <View testID="splash-handoff" className="flex-1 items-center justify-center bg-bg dark:bg-bg-dark">
        <BrandMark testID="splash-mark" variant="launch" size={96} />
      </View>
    );
  }

  return <Redirect href={onboardingComplete ? "/(tabs)" : "/(onboarding)"} />;
}
