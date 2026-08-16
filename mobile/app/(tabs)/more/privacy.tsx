// app/(tabs)/more/privacy.tsx — the Privacy centre (m3b Task 6). Route:
// /more/privacy.
//
// "This is the screen that earns the notification permission." PeraPlano's
// core function is reading the user's bank and e-wallet notifications; this
// screen is where the app proves it deserves that trust — every switch here
// actually controls capture, every row in the captured list is a real row
// from `raw_notifications`, and every sentence is checkable against the code
// beside it (see each component's own header for its specific claim).
//
// ALL ORCHESTRATION LIVES HERE, NOT IN THE COMPONENTS. Same split
// app/(onboarding)/providers.tsx uses against
// components/onboarding/provider_picker.tsx: every hook, every native call,
// every repository read happens in this screen file, and
// components/privacy/*.tsx receive already-resolved props and callbacks —
// which is also what keeps every one of those components free of the
// `lib/db/repos/**` import the global constraints forbid.
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { CaptureToggle } from "@/components/privacy/capture_toggle";
import { CapturedList } from "@/components/privacy/captured_list";
import { ProviderSwitchList } from "@/components/privacy/provider_switch_list";
import { WipeFlow } from "@/components/privacy/wipe_flow";
import { Button } from "@/components/ui/button";
import { providerLabel, providerLabelForPackage } from "@/constants/providers";
import { useSetCaptureEnabled } from "@/hooks/mutations/use_set_capture_enabled";
import { useSetProviderPause } from "@/hooks/mutations/use_set_provider_pause";
import { useCaptureEnabled, usePausedProviderPackages } from "@/hooks/queries/use_capture_settings";
import { useRawCaptures } from "@/hooks/queries/use_raw_captures";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { bootstrapApp } from "@/lib/bootstrap";
import { exportAllData } from "@/lib/privacy/data_export";
import { wipeAllData } from "@/lib/privacy/data_wipe";
import type { ProviderSwitchItem } from "@/components/privacy/provider_switch_list";

/**
 * Docs/07-privacy-and-compliance.md §1, condensed to one screen-top sentence.
 * "parsed on this device" and "raw text never leaves it" are both literally
 * true of the code this screen sits on top of: `lib/ingest/pipeline.ts`
 * parses captures in-process with no network call, and
 * `lib/privacy/data_export.ts` excludes `raw_notifications` from the export
 * bundle entirely (see that file's own header).
 */
const INTRO_BODY =
  "PeraPlano reads your bank and e-wallet notifications, parses them on this device, and never sends the raw text anywhere. Nothing here is sold, shared, or used for ads.";

/** docs §04-features/11-settings-privacy.md Flow C step 4's 30-day figure, restated for this list. */
const CAPTURED_LIST_BODY =
  "Every notification PeraPlano captured from your banks and e-wallets, kept for 30 days, then deleted automatically.";

export default function PrivacyScreen() {
  const router = useRouter();

  const { data: captureEnabled } = useCaptureEnabled();
  const { data: pausedPackages } = usePausedProviderPackages();
  const { data: bundle } = useRuleset();
  const { data: captures } = useRawCaptures();

  const setCaptureEnabled = useSetCaptureEnabled();
  const setProviderPause = useSetProviderPause();

  const [exporting, setExporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [busyProviderKey, setBusyProviderKey] = useState<string | null>(null);

  const providers = useMemo(() => bundle?.providers ?? [], [bundle]);
  const allPackageNames = useMemo(
    () => providers.flatMap((provider) => provider.packageNames),
    [providers],
  );
  const pausedSet = useMemo(() => new Set(pausedPackages ?? []), [pausedPackages]);

  const switchItems: ProviderSwitchItem[] = useMemo(
    () =>
      providers.map((provider) => ({
        providerKey: provider.providerKey,
        displayName: providerLabel(provider.providerKey),
        packageNames: provider.packageNames,
        paused:
          provider.packageNames.length > 0 &&
          provider.packageNames.every((packageName) => pausedSet.has(packageName)),
      })),
    [providers, pausedSet],
  );

  const capturedItems = useMemo(
    () =>
      (captures ?? []).map((capture) => ({
        capture,
        providerName: providerLabelForPackage(providers, capture.packageName),
        expiresAt: capture.expiresAt,
      })),
    [captures, providers],
  );

  const handleToggleProvider = (item: ProviderSwitchItem, paused: boolean) => {
    setBusyProviderKey(item.providerKey);
    setProviderPause.mutate(
      { packageNames: item.packageNames, paused, allPackageNames },
      { onSettled: () => setBusyProviderKey(null) },
    );
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportAllData(Date.now());
    } finally {
      setExporting(false);
    }
  };

  /**
   * `wipeAllData()` empties every table but never re-seeds one — that keeps
   * its own "every table is empty afterward" promise checkable (see
   * data_wipe.test.ts). Re-seeding is `bootstrapApp()`'s job, and it is
   * idempotent by design (lib/bootstrap.ts's own header: "safe to call twice
   * ... without doubling any seeded data"), so calling it again here restores
   * the default categories and the bundled parser ruleset immediately —
   * rule 6's "returns to the onboarding entry state rather than an empty
   * logged-in shell" needs the app to be USABLE the instant it lands on
   * onboarding, not merely empty. `router.replace("/")` then remounts
   * app/index.tsx, which re-reads `onboarding_complete` (now `false`, from
   * `resetSettings()`) and redirects to `/(onboarding)` on its own.
   */
  const handleWipeConfirmed = async () => {
    setWiping(true);
    try {
      await wipeAllData();
      await bootstrapApp();
      router.replace("/");
    } finally {
      setWiping(false);
    }
  };

  return (
    <ScrollView
      testID="privacy-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-6 p-4"
    >
      <View className="gap-1">
        <Text className="text-xl font-semibold text-fg dark:text-fg-dark">Privacy</Text>
        <Text className="text-sm text-fg-2 dark:text-fg-2-dark">{INTRO_BODY}</Text>
      </View>

      <CaptureToggle
        enabled={captureEnabled}
        onChange={(enabled) => setCaptureEnabled.mutate(enabled)}
        busy={setCaptureEnabled.isPending}
      />

      <View className="gap-2">
        <Text className="text-base font-semibold text-fg dark:text-fg-dark">Providers</Text>
        <ProviderSwitchList
          items={switchItems}
          onToggle={handleToggleProvider}
          busyProviderKey={busyProviderKey}
        />
      </View>

      <View className="gap-2">
        <Text className="text-base font-semibold text-fg dark:text-fg-dark">
          What PeraPlano captured
        </Text>
        <Text className="text-sm text-fg-2 dark:text-fg-2-dark">{CAPTURED_LIST_BODY}</Text>
        <CapturedList items={capturedItems} />
      </View>

      <View className="gap-2">
        <Text className="text-base font-semibold text-fg dark:text-fg-dark">Your data</Text>
        <Button
          testID="export-everything"
          title="Export all my data"
          variant="secondary"
          onPress={() => void handleExport()}
          loading={exporting}
        />
        <WipeFlow onConfirmed={handleWipeConfirmed} busy={wiping} />
      </View>
    </ScrollView>
  );
}
