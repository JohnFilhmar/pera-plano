// app/(onboarding)/_layout.tsx — the onboarding route group's own Stack
// (m3c-onboarding-client plan Task 1). headerShown: false matches the root
// Stack (app/_layout.tsx): every screen in this group draws its own header --
// OnboardingFrame's progress dots and back button for the M3c steps this task
// shells for, or nothing at all for the device-lock/recovery-phrase/provider
// screens that predate this task and never had one -- so an OS-drawn header
// here would only ever be a second, redundant one.
import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
