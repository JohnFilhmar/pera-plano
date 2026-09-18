// app/(onboarding)/_layout.tsx — the onboarding route group's own Stack
// (m3c-onboarding-client plan Task 1). headerShown: false matches the root
// Stack (app/_layout.tsx): every screen in this group draws its own header --
// OnboardingFrame's progress dots and back button for the M3c steps this task
// shells for, or nothing at all for the device-lock/recovery-phrase/provider
// screens that predate this task and never had one -- so an OS-drawn header
// here would only ever be a second, redundant one.
//
// AND IT IS WHERE THE RESUME CURSOR IS WRITTEN (GAP-067). One place rather than
// nine, because every step screen would otherwise have to remember to record
// itself on the way in, and a step that forgot would silently send the user
// backwards on the next interrupted run.
//
// NOT IN OnboardingFrame, WHICH IS THE OTHER SINGLE PLACE. That frame is in
// `components/`, and a component may not reach a repository (the release-gate
// grep first_limit.tsx's header names). This layout is a route file, so the
// write belongs here.
//
// FROM THE PATHNAME, NOT FROM A PROP. The pathname is what actually changed
// when the user moved, so this records a BACK navigation too -- `router.push`
// leaves the pushing screen mounted underneath, so a mount effect on the screen
// itself would never fire again on the way back and the cursor would keep
// pointing at the deeper step.
import { Stack, usePathname } from "expo-router";
import { useEffect } from "react";

import { recordOnboardingStep, stepFromPathname } from "@/lib/onboarding/onboarding_state";

export default function OnboardingLayout() {
  const pathname = usePathname();

  useEffect(() => {
    const step = stepFromPathname(pathname);
    // `null` for the three pre-flow screens, which are not steps and have no
    // resume point of their own -- they are re-derived from the key state.
    if (step === null) return;
    // FAILURE IS SWALLOWED ON PURPOSE. The cursor is a convenience; a write
    // that cannot land leaves the flow behaving exactly as it did before this
    // existed (restart at "welcome"), and there is nothing the user standing on
    // a setup screen could do about it anyway. Blocking or erroring the step
    // over it would trade a small loss for the whole install.
    void recordOnboardingStep(step).catch(() => {});
  }, [pathname]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
