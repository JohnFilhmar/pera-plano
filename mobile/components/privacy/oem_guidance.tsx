// components/privacy/oem_guidance.tsx — m3b Task 7.
//
// WHY THIS EXISTS. Chinese-Android OEMs dominate the PH market and their
// battery managers aggressively kill background services to win benchmark
// battery-life numbers — the single most likely cause of "the app just
// stopped working" for a PeraPlano user, and it happens SILENTLY: no crash,
// no error, no revoked permission for `health_card.tsx` to catch. Generic
// "disable battery optimization" advice sends a Xiaomi user hunting through a
// settings app whose menu names do not match, so this file names the exact
// screen and the exact toggle per skin rather than a vague gesture at
// "battery settings".
//
// TWO PIECES, DELIBERATELY SEPARATE. `resolveOemGuidance` is a pure function
// of a brand string — no `Platform`, no React — so the five-plus-fallback
// content mapping is testable with plain strings and nothing to mock.
// `detectDeviceBrand` is the one function that reads `Platform`, isolated
// here so it stays the only new reference to it in this whole codebase (see
// `lib/alerts/alerts_service.ts`'s header on why every other file avoids it).
// `OemGuidance` wires the two together, with `brand` as an OVERRIDABLE prop —
// real usage never passes it and gets the real device's brand; tests pass it
// directly rather than mocking `react-native`'s `Platform` module wholesale.
import { Platform, Text, View } from "react-native";

import { Card } from "@/components/ui/card";

export type OemGuidanceContent = {
  /** How the brand reads on screen — the marketing name(s), not the raw `Build.BRAND` string. */
  label: string;
  /** The skin this guidance targets, shown as a subtitle. */
  skin: string;
  /** Ordered, each one naming the exact settings screen and the exact toggle. */
  steps: string[];
};

/**
 * `Build.BRAND` as Android reports it, lowercased, mapped to the guidance
 * bucket it belongs under. Several brands share one bucket because they run
 * the same OEM skin: POCO and Redmi both ship MIUI/HyperOS, iQOO ships
 * FuntouchOS/OriginOS, Honor's EMUI lineage is Huawei's.
 */
const BRAND_TO_BUCKET: Record<string, keyof typeof OEM_GUIDANCE> = {
  xiaomi: "xiaomi",
  redmi: "xiaomi",
  poco: "xiaomi",
  oppo: "oppo",
  realme: "oppo",
  vivo: "vivo",
  iqoo: "vivo",
  huawei: "huawei",
  honor: "huawei",
  samsung: "samsung",
};

const OEM_GUIDANCE = {
  xiaomi: {
    label: "Xiaomi, Redmi, or POCO",
    skin: "MIUI / HyperOS",
    steps: [
      "Settings → Apps → Manage apps → PeraPlano → Battery saver → set to No restrictions.",
      "Settings → Apps → Permissions → Autostart → turn PeraPlano on.",
      "Recent apps → long-press the PeraPlano card → tap the lock icon so the system stops closing it.",
    ],
  },
  oppo: {
    label: "Oppo or Realme",
    skin: "ColorOS",
    steps: [
      "Settings → Battery → App Battery Management → PeraPlano → choose Allow background activity.",
      "Settings → Apps → App Management → PeraPlano → Battery Usage → turn on Allow auto-launch.",
      "Recent apps → swipe down on the PeraPlano card (or tap the lock icon) to keep it from being cleared.",
    ],
  },
  vivo: {
    label: "Vivo or iQOO",
    skin: "FuntouchOS / OriginOS",
    steps: [
      "Settings → Battery → Background power consumption management → PeraPlano → set to Allow.",
      "i Manager → App manager → Autostart manager → turn PeraPlano on.",
      "Recent apps → long-press the PeraPlano card → Lock this app.",
    ],
  },
  huawei: {
    label: "Huawei or Honor",
    skin: "EMUI",
    steps: [
      "Settings → Battery → App launch → find PeraPlano → turn off Manage automatically, then enable Auto-launch, Secondary launch, and Run in background.",
      "Settings → Apps → PeraPlano → Battery → set to Unmonitored, if that option is present.",
      "Recent apps → long-press the PeraPlano card → lock it in place.",
    ],
  },
  samsung: {
    label: "Samsung",
    skin: "One UI",
    steps: [
      "Settings → Apps → PeraPlano → Battery → set to Unrestricted (not Optimized).",
      "Settings → Battery and device care → Background usage limits → make sure PeraPlano is not listed under Sleeping apps or Deep sleeping apps.",
    ],
  },
} as const satisfies Record<string, OemGuidanceContent>;

/** The fallback for a device brand PeraPlano does not recognise — degrades gracefully, never guesses. */
const GENERIC_GUIDANCE: OemGuidanceContent = {
  label: "Your device",
  skin: "Android",
  steps: [
    "Settings → Apps → PeraPlano → Battery → turn off battery optimization for this app.",
    "If your phone has an app-lock or auto-start manager, allow PeraPlano to run in the background and start automatically.",
  ],
};

/**
 * Maps a raw device brand to its guidance content, case- and whitespace-
 * insensitively. `null` or an unrecognised brand both resolve to the generic
 * fallback — the two cases a wrong guess would cost the most on, so neither
 * one guesses.
 */
export function resolveOemGuidance(brand: string | null): OemGuidanceContent {
  if (brand === null) return GENERIC_GUIDANCE;
  const normalized = brand.trim().toLowerCase();
  if (normalized === "") return GENERIC_GUIDANCE;
  const bucket = BRAND_TO_BUCKET[normalized];
  return bucket === undefined ? GENERIC_GUIDANCE : OEM_GUIDANCE[bucket];
}

/**
 * `Build.BRAND`, Android's own spelling, or `null` when unavailable —
 * including on every non-Android platform. PeraPlano is Android-only in
 * practice, but a wrong guess here is worse than admitting there is none: see
 * `resolveOemGuidance`'s fallback.
 */
export function detectDeviceBrand(): string | null {
  if (Platform.OS !== "android") return null;
  const constants = Platform.constants as { Brand?: string } | undefined;
  const brand = constants?.Brand;
  return brand !== undefined && brand.trim() !== "" ? brand : null;
}

export type OemGuidanceProps = {
  /** Defaults to the real device's brand — override only in tests. */
  brand?: string | null;
  testID?: string;
};

export function OemGuidance({ brand = detectDeviceBrand(), testID }: OemGuidanceProps) {
  const guidance = resolveOemGuidance(brand);

  return (
    <Card testID={testID ?? "oem-guidance"}>
      <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
        Battery settings for {guidance.label}
      </Text>
      <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
        {guidance.skin} aggressively closes background apps to save power, which can silently
        stop PeraPlano from tracking. These steps keep it running.
      </Text>
      <View testID="oem-guidance-steps" className="mt-3 gap-2">
        {guidance.steps.map((step, index) => (
          <Text key={step} testID={`oem-guidance-step-${index}`} className="text-fg dark:text-fg-dark">
            {`${index + 1}. ${step}`}
          </Text>
        ))}
      </View>
    </Card>
  );
}
