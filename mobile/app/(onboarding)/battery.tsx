// app/(onboarding)/battery.tsx — the battery-exemption step (m3c-onboarding-
// client plan Task 2, rule 4; docs/04-features/01-onboarding.md step 5).
// Fourth of the numbered flow's nine routed steps
// (lib/onboarding/onboarding_state.ts). Reached from access.tsx; advances to
// providers.tsx.
//
// REUSES oem_guidance.tsx RATHER THAN DUPLICATING IT (rule 4: "shows the
// matching guidance from oem_guidance ... rather than generic advice").
// `<OemGuidance />` mounted with no `brand` override already does both halves
// of that rule on its own — real usage gets the device's actual brand via its
// own `detectDeviceBrand()` default, which resolves to the matching Xiaomi/
// Huawei/Oppo/Vivo/Samsung steps for a known manufacturer and to the generic
// fallback for anyone else (oem_guidance.tsx's own resolveOemGuidance). This
// screen never re-implements that branch.
//
// `brand` IS AN OVERRIDABLE PROP ON THIS SCREEN, for the exact reason
// oem_guidance.tsx's own header gives for accepting one itself: it is the
// established seam for testing the OEM/generic split without mocking
// `react-native`'s `Platform` module wholesale. Real call sites never pass
// it; the prop only exists so battery_step.test.tsx can render both the known-
// manufacturer and unknown-manufacturer cases directly.
//
// NO WAY TO VERIFY THE OUTCOME, UNLIKE access.tsx. There is no
// `isIgnoringBatteryOptimizations()` surfaced anywhere in
// modules/notification_listener — Android exposes no callback for "the user
// changed this setting," only whatever the app can poll for itself, which
// this module does not yet do. Rather than build an unverifiable recheck loop
// with nothing to check, the primary action fires the system intent
// (best-effort — some OEM builds do not resolve it, and there is nothing to
// recover from if it fails) and advances immediately. This is the same
// "unverifiable, so don't pretend to verify it" call docs rule 17 already
// makes: a skipped or incomplete battery exemption sets the at-risk state
// elsewhere (Home's listener-health surface), never a hard stop here.
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { Linking } from "react-native";

import { BatteryExplainer } from "@/components/onboarding/battery_explainer";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { OemGuidance } from "@/components/privacy/oem_guidance";

/**
 * `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` — the app-list
 * screen where the user finds PeraPlano and sets it to "Not optimized"/
 * "Allow". Deliberately NOT `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
 * (the direct per-app system dialog): that one needs the
 * `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` manifest permission declared and
 * justified at Play review, the same category of cost this app already
 * avoided once for `QUERY_ALL_PACKAGES` (docs/04-features/01-onboarding.md
 * open question 2). The list screen needs no new permission at all.
 */
const BATTERY_SETTINGS_INTENT = "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS";

export default function BatteryScreen({ brand }: { brand?: string | null } = {}) {
  const router = useRouter();

  // nextStep("battery") === "providers" (lib/onboarding/onboarding_state.ts)
  // — hardcoded for the same reason access.tsx's advance() is: the literal
  // has to match a real file for expo-router to resolve it.
  const advance = useCallback(() => {
    router.push("/(onboarding)/providers");
  }, [router]);

  const handlePrimary = useCallback(() => {
    Linking.sendIntent(BATTERY_SETTINGS_INTENT).catch(() => {
      // Best-effort only (see this file's header) — nothing to recover from,
      // and no way to verify the outcome regardless.
    });
    advance();
  }, [advance]);

  return (
    <OnboardingFrame
      step="battery"
      title="Keep tracking alive in the background"
      onPrimary={handlePrimary}
      primaryLabel="Turn off battery optimization"
      onBack={() => router.back()}
      onSkip={advance}
    >
      <BatteryExplainer />
      <OemGuidance brand={brand} />
    </OnboardingFrame>
  );
}
