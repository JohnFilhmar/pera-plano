// components/privacy/capture_toggle.tsx — the master pause switch (m3b Task
// 6 rule 1; interface note 2).
//
// PRESENTATIONAL, like every screen/component split in this codebase
// (app/(onboarding)/providers.tsx + components/onboarding/provider_picker.tsx
// is the closest analogue): the current value and the write both arrive as
// props, resolved by app/(tabs)/more/privacy.tsx from
// hooks/queries/use_capture_settings.ts and
// hooks/mutations/use_set_capture_enabled.ts. This file never imports a
// repository or the native module directly — global constraint: components
// never import lib/db/repos/**, and this screen's every native touch-point
// lives in the hook layer so a component test never has to mock a bridge it
// has no reason to know exists. `health` and `onOpenAccessSettings` below
// arrive the same way, for the same reason — exactly the shape
// components/privacy/health_card.tsx already uses (a type-only import from
// the hook, and the settings opener passed down rather than reached for), so
// this file still requires cleanly under Jest with no native mock.
import { Pressable, Switch, Text } from "react-native";

import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list_row";
import type { TrackingHealth } from "@/hooks/queries/use_listener_health";

export type CaptureToggleProps = {
  /** `undefined` while the setting has not loaded yet. */
  enabled: boolean | undefined;
  /**
   * The live native read (`hooks/queries/use_listener_health.ts`), `undefined`
   * until it lands or if the bridge threw. The switch is the user's INTENT;
   * this is whether the intent is actually being carried out, and the subtitle
   * may only claim notifications are being read when both agree.
   */
  health: TrackingHealth | undefined;
  onChange: (enabled: boolean) => void;
  onOpenAccessSettings: () => void;
  busy?: boolean;
  testID?: string;
};

/**
 * "While paused, PeraPlano captures nothing." Load-bearing copy, checkable
 * against `lib/ingest/pipeline.ts` — both `routeCapture` and the drain path
 * refuse to read anything the instant `getSetting("capture_enabled")` is
 * `false` (see that file's own two `capture_enabled` checks).
 */
const PAUSED_BODY =
  "While paused, PeraPlano reads and stores nothing from any provider — not even for the Review Queue. Turn it back on to resume.";
const ACTIVE_BODY =
  "PeraPlano is reading your bank and e-wallet notifications to record transactions automatically.";
/**
 * ACTIVE_BODY IS A CLAIM ABOUT THE WORLD, NOT ABOUT A SWITCH, and until this
 * fix the switch was the only thing it consulted: `enabled !== false` printed
 * "PeraPlano is reading your bank and e-wallet notifications" to a user who
 * had declined Notification Access, to one whose OEM had silently revoked it
 * on a reboot, and to everyone during the first frames while the setting was
 * still loading. The Privacy centre is the one screen whose whole purpose is
 * to state what the app is doing; a confident false sentence here is worse
 * than none. The three bodies below are the honest readings of the states
 * ACTIVE_BODY used to swallow.
 */
const CHECKING_BODY = "Checking whether PeraPlano can read your notifications right now.";
const NO_ACCESS_BODY =
  "Notification access is off, so PeraPlano is reading nothing. Grant it again to resume automatic tracking.";
const DISCONNECTED_BODY =
  "Notification access is on, but the listener service is not running, so nothing is being read right now.";

/**
 * THE USER'S OWN PAUSE COMES FIRST, before any fault. Someone who turned
 * tracking off on purpose is not owed a warning about a listener that is
 * disconnected BECAUSE they turned it off — the same precedence
 * `components/home/tracking_banner.tsx` and `use_listener_health.ts`'s own
 * header already set for this pair, restated here rather than re-decided.
 * PAUSED_BODY is also still literally true in that state: nothing is read.
 */
function captureSubtitle(enabled: boolean | undefined, health: TrackingHealth | undefined): string {
  if (enabled === false) return PAUSED_BODY;
  if (enabled === undefined || health === undefined) return CHECKING_BODY;
  if (!health.granted) return NO_ACCESS_BODY;
  if (!health.serviceConnected) return DISCONNECTED_BODY;
  return ACTIVE_BODY;
}

export function CaptureToggle({
  enabled,
  health,
  onChange,
  onOpenAccessSettings,
  busy = false,
  testID = "capture-toggle",
}: CaptureToggleProps) {
  // Only where the fault is real AND the user has not already paused: an
  // action offered on a state the reader chose is noise, and one offered
  // while the live read is still `undefined` would be a guess.
  const needsAccess =
    enabled !== false && health !== undefined && (!health.granted || !health.serviceConnected);

  return (
    <Card testID={testID}>
      <ListRow
        title="Tracking"
        subtitle={captureSubtitle(enabled, health)}
        // Sized to PAUSED_BODY, still the longest of the five (126
        // characters) — NO_ACCESS_BODY (105), DISCONNECTED_BODY (103),
        // ACTIVE_BODY (95) and CHECKING_BODY (65) wrap to fewer lines and
        // simply do not use the headroom. All sit beside a bare Switch, same
        // as the telemetry row. fix-round-1.
        subtitleLines={4}
        right={
          <Switch
            testID="capture-toggle-switch"
            value={enabled === true}
            onValueChange={onChange}
            disabled={enabled === undefined || busy}
            accessibilityRole="switch"
            accessibilityLabel="Tracking"
            accessibilityState={{ disabled: enabled === undefined || busy, checked: enabled === true }}
          />
        }
      />
      {needsAccess ? (
        // Real padding to 44px rather than `ISOLATED_LINK_HIT_SLOP`: that
        // constant's own doc requires no interactive neighbour within its
        // 16px, and the row's Switch sits directly above this line. Same
        // wording as components/privacy/health_card.tsx's revoked banner, on
        // purpose — one phrase for one destination, wherever the user meets
        // it. The loud red banner stays that card's job; this is the fix
        // prompt for the row that made the claim.
        <Pressable
          testID="capture-toggle-open-settings"
          accessibilityRole="button"
          onPress={onOpenAccessSettings}
          className="min-h-[44px] justify-center px-4"
        >
          <Text className="text-body font-semibold text-brand dark:text-brand-dark">
            Open notification access settings
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}
