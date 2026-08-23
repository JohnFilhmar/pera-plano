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
// has no reason to know exists.
import { Switch } from "react-native";

import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list_row";

export type CaptureToggleProps = {
  /** `undefined` while the setting has not loaded yet. */
  enabled: boolean | undefined;
  onChange: (enabled: boolean) => void;
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

export function CaptureToggle({ enabled, onChange, busy = false, testID = "capture-toggle" }: CaptureToggleProps) {
  return (
    <Card testID={testID}>
      <ListRow
        title="Tracking"
        subtitle={enabled === false ? PAUSED_BODY : ACTIVE_BODY}
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
    </Card>
  );
}
