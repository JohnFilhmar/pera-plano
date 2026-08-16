// components/privacy/expiry_countdown.tsx — "deleted in 12 days" (m3b Task 6
// rule 3 / interface note 1).
//
// REUSES `captureExpiryLabel` FROM `why_recorded_panel.tsx` RATHER THAN
// REIMPLEMENTING THE ROUNDING. m1c Task 7 already shipped this exact
// countdown on the "Why was this recorded?" panel, reading the SAME
// `raw_notifications.expires_at` column this screen shows a list of. Two
// independent day-rounding implementations over the same column is how the
// transparency panel and the Privacy centre end up telling the user
// different numbers for the identical row — which is precisely the
// disagreement the task brief's interface notes warn this task not to
// create. See that file's own doc for why the countdown rounds UP and why it
// reads the STORED expiry rather than deriving one from `capturedAt + TTL`.
import { Text } from "react-native";

import { captureExpiryLabel } from "@/components/transactions/why_recorded_panel";
import type { EpochMs } from "@/types/domain";

export type ExpiryCountdownProps = {
  expiresAt: EpochMs;
  /** Injected clock — never a bare `Date.now()` inside a testable path. */
  now?: EpochMs;
  testID?: string;
};

export function ExpiryCountdown({ expiresAt, now = Date.now(), testID }: ExpiryCountdownProps) {
  return (
    <Text testID={testID} className="text-xs text-fg-2 dark:text-fg-2-dark">
      {captureExpiryLabel(expiresAt, now)}
    </Text>
  );
}
