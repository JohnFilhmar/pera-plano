// components/onboarding/battery_explainer.tsx — the value screen behind the
// battery-exemption ask (m3c-onboarding-client plan Task 2, rule 4;
// docs/04-features/01-onboarding.md step 5). Purely presentational, same
// split as access_explainer.tsx: app/(onboarding)/battery.tsx owns the
// system-intent call and mounts this plus components/privacy/oem_guidance.tsx
// (M3b Task 7) inside OnboardingFrame.
//
// GENERIC, BECAUSE THE OEM-SPECIFIC STEPS LIVE IN oem_guidance.tsx ALREADY —
// rule 4 says explicitly to show ITS guidance rather than duplicating it. This
// component only explains WHY an exemption matters at all; the WHAT (which
// screen, which toggle) belongs to that already-shipped component and is
// mounted alongside this one by the screen, never repeated here.
import { Text, View } from "react-native";

export function BatteryExplainer() {
  return (
    <View testID="battery-explainer" className="gap-4">
      <Text testID="battery-explainer-why" className="text-base text-fg dark:text-fg-dark">
        Android can put PeraPlano to sleep in the background to save power. Once it's asleep,
        tracking stops until you open the app again — silently, with no warning.
      </Text>
      <Text testID="battery-explainer-exemption" className="text-fg-2 dark:text-fg-2-dark">
        One setting keeps it awake: exempting PeraPlano from battery optimization. It's a single
        switch in Android's own settings, not something the app can turn on for you.
      </Text>
      <Text testID="battery-explainer-oem" className="text-fg-2 dark:text-fg-2-dark">
        This matters most on Xiaomi, Huawei, Oppo, and Vivo phones — very common in the
        Philippines — which manage background apps more aggressively than stock Android.
      </Text>
    </View>
  );
}
