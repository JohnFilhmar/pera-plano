// app/(onboarding)/battery.tsx — the battery-exemption step (m3c-onboarding-
// client plan Task 2, rule 4; docs/04-features/01-onboarding.md step 5).
// Fourth of the numbered flow's nine routed steps
// (lib/onboarding/onboarding_state.ts). Reached from access.tsx; advances to
// wallets.tsx.
//
// ADVANCES TO providers.tsx, WHICH `nextStep("battery")` HAS ALWAYS SAID
// (GAP-091). It used to skip past it to wallets.tsx, because the picker ran
// once already in app/(onboarding)/index.tsx's pre-flow sequencer and mounting
// it again here left it with no `onDone` and no forward action. The picker has
// moved into this flow and navigates itself, so the reserved slot is a real
// route now and the detour is gone.
//
// WHY IT HAD TO MOVE. The picker's whole subject is "apps we've seen", and the
// listener has seen nothing until notification access is granted -- which is
// the step two before this one. Running before the grant meant
// `listObservedPackages()` returned an empty list on every fresh install, so
// the picker offered nothing but seed guesses and the wallets step, deriving
// from the same empty list moments later, proposed a cash wallet alone.
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
//
// THE INTENT ITSELF NOW LIVES IN lib/onboarding/battery_settings.ts (GAP-018),
// not here. This step is no longer its only caller: skipping it used to be
// permanent, so app/(tabs)/more/permissions.tsx now offers the same action
// from Settings, and both fire one shared `openBatterySettings()` rather than
// two copies of an intent string nothing type-checks.
import { useCallback } from "react";
import { useRouter } from "expo-router";

import { BatteryExplainer } from "@/components/onboarding/battery_explainer";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { OemGuidance } from "@/components/privacy/oem_guidance";
import { openBatterySettings } from "@/lib/onboarding/battery_settings";

export default function BatteryScreen({ brand }: { brand?: string | null } = {}) {
  const router = useRouter();

  // nextStep("battery") === "providers" (lib/onboarding/onboarding_state.ts).
  // Hardcoded, like every other routed step in this task: the literal has to
  // match a real file for expo-router to resolve it.
  const advance = useCallback(() => {
    router.push("/(onboarding)/providers");
  }, [router]);

  const handlePrimary = useCallback(() => {
    // Best-effort only (see this file's header and `openBatterySettings`'s own
    // doc) — nothing to recover from, and no way to verify the outcome
    // regardless, so this advances rather than waiting on an answer.
    openBatterySettings();
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
