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
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react-native";
import { AppState, ScrollView, Text, View } from "react-native";
import type { AppStateStatus } from "react-native";

import { CaptureToggle } from "@/components/privacy/capture_toggle";
import { CapturedList } from "@/components/privacy/captured_list";
import { ProviderSwitchList } from "@/components/privacy/provider_switch_list";
import { WipeFlow } from "@/components/privacy/wipe_flow";
import { Button, registerIcon } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section_header";
import { providerLabel, providerLabelForPackage } from "@/constants/providers";
import { queryKeys } from "@/constants/query_keys";
import { useSetCaptureEnabled } from "@/hooks/mutations/use_set_capture_enabled";
import { useSetProviderPause } from "@/hooks/mutations/use_set_provider_pause";
import { useCaptureEnabled, usePausedProviderPackages } from "@/hooks/queries/use_capture_settings";
import { useListenerHealth } from "@/hooks/queries/use_listener_health";
import { useRawCaptures } from "@/hooks/queries/use_raw_captures";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useLock } from "@/contexts/lock_context";
import { exportAllData } from "@/lib/privacy/data_export";
import { WipeIncompleteError } from "@/lib/security/wipe";
import { openAccessSettings } from "@/modules/notification_listener";
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

/**
 * The two sentences a failed wipe can honestly print, split exactly where
 * lib/security/wipe.ts splits its failures: a `wipeDatabase()` rejection
 * propagates as itself because NOTHING was destroyed, and every later
 * rejection arrives as `WipeIncompleteError` because the file is already gone.
 * The second sentence is this screen's original wording, kept because it is
 * accurate for that case. The first exists because it was previously printed
 * too: one message for both told a user whose ledger was still on their phone
 * that their data had been erased, which is the opposite of the truth in the
 * more frightening direction, on the one screen whose whole job is being
 * checkable about their data. It says what state they are actually in and that
 * the phrase and the ledger both survived, so a retry is a real option.
 */
const WIPE_INCOMPLETE_BODY =
  "Your data was erased, but PeraPlano could not finish resetting. Please close and reopen the app.";
const WIPE_NOT_STARTED_BODY =
  "Nothing was erased. Your data and your recovery words are still on this phone, so you can try again.";

const SmartphoneIcon = registerIcon(Smartphone);

export default function PrivacyScreen() {
  /**
   * `errorMessage` is the wipe's real reporting channel, not the `catch` in
   * `handleWipeConfirmed` — see that function's doc. It is read here rather
   * than after the `await` because the value in that closure is the one from
   * the render that started the wipe, i.e. always the one from before the
   * context set it.
   */
  const { wipeAndStartOver, errorMessage: lockErrorMessage } = useLock();
  const queryClient = useQueryClient();

  const { data: captureEnabled } = useCaptureEnabled();
  const { data: pausedPackages } = usePausedProviderPackages();
  const { data: bundle } = useRuleset();
  const { data: captures } = useRawCaptures();
  /**
   * THE SWITCH ALONE CANNOT SAY WHETHER ANYTHING IS BEING READ. `capture_enabled`
   * is the user's intent; whether the listener actually has Notification Access
   * and is connected is a live native fact, and only this hook has it. Without
   * it this screen printed "PeraPlano is reading your bank and e-wallet
   * notifications" to a user who had declined the permission or had it revoked
   * by their OEM — see components/privacy/capture_toggle.tsx's own note.
   *
   * NOT A SECOND SOURCE OF TRUTH FOR THE SWITCH: `TrackingHealth.captureEnabled`
   * is deliberately ignored here, so the Switch keeps rendering off exactly one
   * query (`useCaptureEnabled`) and the two can never disagree mid-write.
   */
  const { data: health } = useListenerHealth();

  const setCaptureEnabled = useSetCaptureEnabled();
  const setProviderPause = useSetProviderPause();

  /**
   * Notification Access is granted, and revoked, in ANOTHER app — the system
   * settings screen the row below opens — with no callback to this one
   * (`isAccessGranted`'s own doc, modules/notification_listener/index.ts). So
   * the live read has to be re-asked on every foreground return, or the row
   * would keep telling a user who just fixed the grant that access is still
   * off. AppState rather than `useFocusEffect` for the reason
   * app/(tabs)/more/index.tsx states for the same round trip: leaving PeraPlano
   * never unfocuses the tab, so a focus effect would miss the one return that
   * matters. Identical to app/(tabs)/more/listener_health.tsx's effect, which
   * exists for this same grant.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.listenerHealth.all });
      }
    });
    return () => subscription.remove();
  }, [queryClient]);

  const [exporting, setExporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [busyProviderKey, setBusyProviderKey] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [wipeError, setWipeError] = useState<string | null>(null);
  /**
   * True once a wipe attempt has come back and left this screen mounted, which
   * is the only situation in which the lock context's `errorMessage` belongs
   * to this screen's wipe. Without the gate, any message the context happens to
   * be holding would print itself under the Erase button on first mount.
   */
  const [wipeAttempted, setWipeAttempted] = useState(false);

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
    setExportError(null);
    try {
      await exportAllData(Date.now());
    } catch (error) {
      console.warn("privacy: export failed", error);
      setExportError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  /**
   * A FACTORY RESET, NOT A LOGICAL CLEAR — and that distinction is the whole
   * bug this handler used to be. It called `lib/privacy/data_wipe.ts`'s
   * `wipeAllData()`, a `DELETE FROM` sweep that empties every table but
   * deliberately KEEPS the SQLCipher file, both key wraps, and therefore the
   * user's existing 12-word recovery phrase and device-lock enrolment. The
   * app then bounced through `bootstrapApp()` and `router.replace("/")` into
   * the numbered onboarding flow, where `app/(onboarding)/index.tsx` saw keys
   * already on disk and SKIPPED the device-lock and recovery-phrase screens
   * (branch 2 of its own header comment). Observed on a real Samsung A54: the
   * data was gone, but the same phrase and the same fingerprint enrolment
   * were still live — the opposite of what "Erase everything. This is
   * permanent" promises. `WIPE_STEP_ONE_BODY`/`WIPE_STEP_TWO_BODY` in
   * components/privacy/wipe_flow.tsx now say plainly that the recovery phrase
   * dies too, and this handler is what makes that sentence true.
   *
   * ROUTED THROUGH THE LOCK CONTEXT, NOT DIRECTLY AT `lib/security/wipe.ts`.
   * `wipeAndStartOver()` there performs the destruction (wipeDatabase →
   * wipeKeys → clearCaptureBuffer), but destruction alone would leave the
   * lock context still reporting "unlocked" over a database file that no
   * longer exists. The context's own `wipeAndStartOver`
   * (contexts/lock_context.tsx) wraps that same call with the double-tap
   * guard AND the state transition that actually matters here: status becomes
   * `needs_onboarding`, the one status `app/lock.tsx` renders
   * `app/(onboarding)/index.tsx` from directly — the fresh-install branch
   * that DOES run device lock and DOES issue a brand-new phrase. That is also
   * why nothing here navigates any more: with no keys, `app/_layout.tsx`'s
   * AppShell stops rendering the Stack this screen lives in and renders the
   * lock gate instead, so a `router.replace("/")` would only push router
   * state at a navigator that is being unmounted underneath it.
   *
   * AND NOTHING HERE CALLS `bootstrapApp()` ANY MORE. It cannot run: the
   * database FILE is deleted by this point and bootstrap needs a DEK that no
   * longer exists, so it would throw DatabaseLockedError every time. Verified
   * against the onboarding path rather than assumed — the three pre-flow
   * screens (device_lock → recovery_phrase → providers) never bootstrap;
   * provisioning ends in `keysProvisioned()`, which moves the lock to
   * "locked", and it is the ordinary unlock afterwards that flips AppShell's
   * `lockStatus` to "unlocked" and fires `bootstrapApp()` from its own effect
   * there. Re-seeding the default categories and the bundled ruleset
   * therefore still happens on the way back in, just at the one moment there
   * is a key to do it with.
   *
   * A FAILURE DOES NOT ARRIVE AS A REJECTION. The context's
   * `wipeAndStartOver` NEVER REJECTS — its own doc says so, and
   * contexts/__tests__/lock_context.test.tsx pins both failure kinds as
   * `resolves` — because its first call site (app/lock.tsx) fires it as
   * `void onWipe()`, where a rejection would be an unhandled promise on the
   * screen a silent failure is most dangerous on. Every outcome lands in the
   * context's `status`/`errorMessage` instead, and which of the two failures
   * happened decides whether this screen is even still mounted to report it:
   *
   * - A failure AFTER `wipeDatabase()` (`WipeIncompleteError`) moves status to
   *   "needs_onboarding", so app/_layout.tsx's AppShell replaces this entire
   *   Stack with the lock gate, and app/lock.tsx prints the context's message
   *   above the fresh setup flow. Nothing this file renders is on screen by
   *   then, and nothing it could set would ever be seen.
   * - A `wipeDatabase()` failure destroyed nothing, so status deliberately
   *   stays "unlocked" and this screen stays mounted — and until this handler
   *   read `errorMessage`, that user watched the spinner stop and got no
   *   message at all. Its `catch` never ran, because there was no rejection to
   *   catch. That is the silent failure the block below actually prevents.
   *
   * THE CATCH STILL IS NOT OPTIONAL, and now branches. It is what stands
   * between a future context that does reject and that same stopped spinner —
   * and if it ever fires it must not repeat the bug it was written with: one
   * message for both kinds told a user whose ledger was untouched that their
   * data had been erased. `WipeIncompleteError` is the only thing that can say
   * which side of the database file the sequence stopped on.
   */
  const handleWipeConfirmed = async () => {
    setWiping(true);
    setWipeError(null);
    setWipeAttempted(false);
    try {
      await wipeAndStartOver();
      setWipeAttempted(true);
    } catch (error) {
      if (error instanceof WipeIncompleteError) {
        console.warn("privacy: wipe could not finish after the database was cleared", error);
        setWipeError(WIPE_INCOMPLETE_BODY);
      } else {
        console.warn("privacy: wipe stopped before anything was erased", error);
        setWipeError(WIPE_NOT_STARTED_BODY);
      }
    } finally {
      setWiping(false);
    }
  };

  /**
   * The catch's message first (it only exists for a rejection this screen has
   * no other account of), then the context's, which is where every failure the
   * app can currently produce actually reports itself.
   */
  const wipeNotice = wipeError ?? (wipeAttempted ? lockErrorMessage : null);

  return (
    <ScrollView
      testID="privacy-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-6 p-4"
    >
      {/* task-4 brief step 2: the green reassurance banner. Body copy is the
          screen's EXISTING `INTRO_BODY` verbatim, per the brief's own
          instruction ("body from the existing copy") — not the board's own
          sentence, which names a stronger promise ("no account, no cloud
          sync, no analytics SDK") that lives in
          docs/07-privacy-and-compliance.md §1 but has never actually shipped
          as this screen's copy (m3b Task 8's report already caught this once:
          "I keep asserting what the design says as though it were what the
          code does"). Reusing the real, checkable sentence rather than the
          board's stronger one keeps that history from repeating here. */}
      <View testID="privacy-reassurance" className="gap-2 rounded-2xl bg-brand-soft p-4 dark:bg-brand-soft-dark">
        <View className="flex-row items-center gap-2">
          <SmartphoneIcon size={17} className="text-brand-ink dark:text-brand-ink-dark" />
          {/* branch-review-design.md F3: this was raw `text-base` (16px/24px),
              not one of tailwind.config.ts's eight named sizes. `section`
              (15px/20px) is the nearest by actual pixel value (1px away,
              versus 2px for `body` and 4px for `title`) — and it is also this
              scale's own token for a section-level heading, which is exactly
              this line's role. */}
          <Text className="text-section font-bold text-brand-ink dark:text-brand-ink-dark">
            Everything stays on this phone
          </Text>
        </View>
        {/* Was raw `text-sm` (14px/20px) — a pixel-for-pixel duplicate of
            `body` (14px/20px) under the wrong class name (branch-review-
            design.md F3). */}
        <Text className="text-body text-brand-ink dark:text-brand-ink-dark">{INTRO_BODY}</Text>
      </View>

      <SectionHeader title="Listening" />
      <CaptureToggle
        enabled={captureEnabled}
        health={health}
        onChange={(enabled) => setCaptureEnabled.mutate(enabled)}
        onOpenAccessSettings={openAccessSettings}
        busy={setCaptureEnabled.isPending}
      />

      <View className="gap-2">
        {/* Pre-existing raw `text-base`, same off-scale class this file's
            reassurance banner shipped with (branch-review-design.md F3
            widened this fix to the whole screen) — mapped to `section`,
            the nearest scale entry, for the same reason as that banner's
            heading. */}
        <Text className="text-section font-semibold text-fg dark:text-fg-dark">Providers</Text>
        <ProviderSwitchList
          items={switchItems}
          onToggle={handleToggleProvider}
          busyProviderKey={busyProviderKey}
        />
      </View>

      <View className="gap-2">
        {/* Same F3 sweep as "Providers" above — text-base/text-sm mapped to
            the nearest scale entries. */}
        <Text className="text-section font-semibold text-fg dark:text-fg-dark">
          What PeraPlano captured
        </Text>
        <Text className="text-body text-fg-2 dark:text-fg-2-dark">{CAPTURED_LIST_BODY}</Text>
        <CapturedList items={capturedItems} />
      </View>

      {/*
        task-4 brief step 2 also draws a "WHAT'S STORED" table (three rows,
        each a record count and an on-disk size) and a second "Delete source
        notifications now" action beside Export. Neither exists here, and not
        for lack of time:

          - No repository anywhere in this app computes a row count OR a
            byte size for any table (grepped `lib/db/repos/**`,
            `lib/privacy/data_export.ts` and `lib/privacy/data_wipe.ts` — the
            two files that already enumerate every table for a different
            reason, `listDataTableNames`/`listWipeableTables`, neither counts
            rows or measures bytes). Building it means new repo functions,
            and `lib/db/repos/**` is outside this task's file list.
          - "Delete source notifications now" has no function behind it
            either: `raw_notifications_repo.ts` exposes exactly one delete
            path, `purgeExpiredRawCaptures(now)`, which only removes rows
            already past their 30-day `expires_at` — not an on-demand
            "delete everything captured so far" primitive. A button wired to
            nothing, or wired to the expiry purge under a label that promises
            more, is the exact non-interactive-control trap the revamp's own
            constraints warn against.
          - Fetching full tables client-side just to print a count was
            considered and rejected: this file's own `CapturedList` already
            paid for that mistake once (see captured_list.tsx's header — a
            7707px screen from rendering every capture unpaginated) — and
            "Rules & limits" has no single existing query either, since it
            would need to combine `limits_repo.ts` with `user_rules_repo.ts`,
            for which no query hook exists at all today.

        Export, Wipe, and the captured-notifications list above (the actual,
        already-real proof of what is stored) are what ship instead. Noted
        here as follow-up rather than silently dropped.
      */}
      <View className="gap-2">
        {/* Same F3 sweep as "Providers"/"What PeraPlano captured" above. */}
        <Text className="text-section font-semibold text-fg dark:text-fg-dark">Your data</Text>
        <Button
          testID="export-everything"
          title="Export all my data"
          variant="secondary"
          onPress={() => void handleExport()}
          loading={exporting}
        />
        {exportError ? (
          <Text testID="privacy-export-error" className="text-body text-danger dark:text-danger-dark">
            {exportError}
          </Text>
        ) : null}
        <WipeFlow onConfirmed={handleWipeConfirmed} busy={wiping} />
        {wipeNotice ? (
          <Text testID="privacy-wipe-error" className="text-body text-danger dark:text-danger-dark">
            {wipeNotice}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
