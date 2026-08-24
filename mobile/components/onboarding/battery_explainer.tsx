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
//
// RESTYLE (mobile-ui-revamp Part 3 Task 6): the same reassurance-list
// treatment access_explainer.tsx gets — one lucide glyph per claim — rather
// than three stacked paragraphs. Every testID and every word of copy is
// unchanged.
import { BatteryCharging, Moon, Smartphone } from "lucide-react-native";
import { Text, View } from "react-native";

import { registerIcon } from "@/components/ui/button";
import type { IconComponent } from "@/components/ui/button";

function ReassuranceRow({
  icon,
  testID,
  children,
}: {
  icon: IconComponent;
  testID: string;
  children: string;
}) {
  const Icon = registerIcon(icon);
  return (
    <View className="flex-row items-start gap-3">
      <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft-dark">
        <Icon size={16} className="text-brand dark:text-brand-dark" />
      </View>
      <Text testID={testID} className="flex-1 text-body font-medium text-fg-2 dark:text-fg-2-dark">
        {children}
      </Text>
    </View>
  );
}

export function BatteryExplainer() {
  return (
    <View testID="battery-explainer" className="gap-3">
      <ReassuranceRow icon={Moon} testID="battery-explainer-why">
        {
          "Android can put PeraPlano to sleep in the background to save power. Once it's asleep, tracking stops until you open the app again — silently, with no warning."
        }
      </ReassuranceRow>
      <ReassuranceRow icon={BatteryCharging} testID="battery-explainer-exemption">
        {
          "One setting keeps it awake: exempting PeraPlano from battery optimization. It's a single switch in Android's own settings, not something the app can turn on for you."
        }
      </ReassuranceRow>
      <ReassuranceRow icon={Smartphone} testID="battery-explainer-oem">
        This matters most on Xiaomi, Huawei, Oppo, and Vivo phones — very common in the
        Philippines — which manage background apps more aggressively than stock Android.
      </ReassuranceRow>
    </View>
  );
}
