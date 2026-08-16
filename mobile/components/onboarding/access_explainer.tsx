// components/onboarding/access_explainer.tsx — the value screen behind the
// Notification Access ask (m3c-onboarding-client plan Task 2, rules 1-3;
// docs/04-features/01-onboarding.md steps 2-3). Purely presentational, the
// same split device_lock_explainer.tsx and battery_explainer.tsx use:
// everything that crosses the native bridge (isAccessGranted, openAccessSettings)
// lives in app/(onboarding)/access.tsx, which mounts this inside
// OnboardingFrame and owns the primary/skip wiring.
//
// THE LOCAL-FIRST PROMISE COMES FIRST, NOT BURIED (rule 1). Everything below
// it -- what is pulled out of a notification, what happens to the rest -- is
// detail; the one sentence a user must read even if they read nothing else is
// that the raw text never leaves the phone. Reordering these paragraphs
// defeats the rule even if every sentence individually stays true.
//
// EVERY CLAIM HERE HAS TO STAY TRUE OF THE SHIPPED CODE, WORD FOR WORD WHERE
// POSSIBLE, because app/(tabs)/more/privacy.tsx already makes the identical
// promises in shipped copy (task-2-brief.md: "two screens describing the same
// behaviour differently is worse than either alone"):
//
//   - "parses them on this device, and never sends the raw text anywhere" —
//     copied verbatim from privacy.tsx's own INTRO_BODY, which is itself
//     checked against lib/ingest/pipeline.ts (parses captures in-process, no
//     network call) and lib/privacy/data_export.ts (excludes raw_notifications
//     from the export bundle).
//   - "kept for 30 days, then deleted automatically" — the tail of privacy.tsx's
//     CAPTURED_LIST_BODY, itself sourced from
//     lib/db/repos/raw_notifications_repo.ts's RAW_CAPTURE_TTL_MS
//     (30 * 24 * 60 * 60 * 1000 — thirty days, not an approximation).
//   - "the amount, the direction ... the merchant, and the reference number" —
//     the four fields lib/ingest/parser.ts's ParsedFields actually declares
//     (amountCentavos, direction, merchant, referenceNo).
//
// A future edit to any of those three files without a matching edit here (or
// vice versa) is exactly the drift this comment exists to catch in review.
import { Text, View } from "react-native";

export type AccessExplainerProps = {
  /** Set once the step has returned from Settings without the grant (rule 3). */
  outcome?: "declined";
};

export function AccessExplainer({ outcome }: AccessExplainerProps) {
  return (
    <View testID="access-explainer" className="gap-4">
      <Text testID="access-explainer-local-first" className="text-base text-fg dark:text-fg-dark">
        PeraPlano reads your bank and e-wallet notifications, parses them on this device, and
        never sends the raw text anywhere.
      </Text>
      <Text testID="access-explainer-extracted" className="text-fg-2 dark:text-fg-2-dark">
        From each one it pulls four things: the amount, the direction — money in or out, the
        merchant, and the reference number. That's what turns a notification into a transaction in
        your ledger automatically, without you typing anything.
      </Text>
      <Text testID="access-explainer-discarded" className="text-fg-2 dark:text-fg-2-dark">
        The notification text itself is kept for 30 days, then deleted automatically.
      </Text>
      <Text testID="access-explainer-system-preview" className="text-fg-2 dark:text-fg-2-dark">
        Next, Android will ask you to turn on notification access for PeraPlano — that's a system
        screen, not part of the app.
      </Text>
      {outcome === "declined" ? (
        <Text testID="access-explainer-declined-notice" className="text-fg-2 dark:text-fg-2-dark">
          No problem — you can turn this on later from Settings. PeraPlano keeps working in manual
          mode until you do.
        </Text>
      ) : null}
    </View>
  );
}
