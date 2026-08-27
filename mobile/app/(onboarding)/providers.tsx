// app/(onboarding)/providers.tsx — the onboarding step that turns the seed's
// guesses and the listener's learned package names into a filter the user
// actually chose (provider-selection plan Task 4; docs/04-features/01-onboarding.md
// step 6). Reached from app/(onboarding)/index.tsx once the recovery phrase is
// captured; skippable, like every onboarding step except the device lock and
// the phrase.
//
// Same split device_lock.tsx uses: components/onboarding/provider_picker.tsx is
// purely presentational, and everything that crosses the native bridge or
// touches the database lives here.
//
// ---------------------------------------------------------------------------
// SELECTING NOTHING MEANS CAPTURE-EVERYTHING, NOT CAPTURE-NOTHING (rule 2).
//
// `CapturePrefs.shouldCapture` returns true when the provider filter is empty —
// that is the allow-all default a fresh install depends on, and it is pinned on
// the Kotlin side by CapturePrefsTest. Both "the user ticked nothing" and "the
// user tapped Skip" therefore write `setProviderFilter([])` and change nothing
// else.
//
// THIS FILE DELIBERATELY DOES NOT IMPORT `setCaptureEnabled`. Not an omission
// to helpfully fill in later: pausing capture because the user chose no
// providers would produce an app that installs, onboards cleanly, and then
// never records a single transaction — no error, no empty state, no log line,
// just a money tracker that tracks nothing. `setCaptureEnabled(false)` is the
// global pause switch and belongs to Settings, never to this screen.
//
// SKIP AND "TICKED NOTHING" GO THROUGH THE SAME `commit([])`. Wiring them to
// two handlers is exactly how one of them ends up safe and the other does not.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { ProviderPicker } from "@/components/onboarding/provider_picker";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { applyAppLabels, buildProviderChoices } from "@/lib/ingest/provider_catalogue";
import { SEED_BUNDLE } from "@/lib/ingest/seed_rules";
import { DEFAULT_TRAIT_SIGNALS, DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { getAppLabels, listObservedPackages, setProviderFilter } from "@/modules/notification_listener";

import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";
import type { ObservedPackage } from "@/modules/notification_listener";
import type { RulesetBundle } from "@/lib/ingest/ruleset_types";

/**
 * What the listener has learned, or nothing.
 *
 * A bridge failure degrades to the seed catalogue rather than to an error
 * screen: a picker showing only the thirteen guessed providers is the exact
 * behaviour that shipped before Task 3, and it is far better than blocking
 * onboarding over a list that is an optimisation.
 */
async function loadObserved(): Promise<ObservedPackage[]> {
  try {
    return await listObservedPackages();
  } catch {
    return [];
  }
}

/**
 * The real app names for `packageNames`, or nothing.
 *
 * DEGRADES TO `{}`, NEVER TO AN ERROR, for the same reason `loadObserved`
 * does: a picker labelled from the seed's brand names is exactly what shipped
 * before this call existed. The names are an improvement on the fallback
 * chain, not a prerequisite for it, and failing onboarding over them would
 * trade a stale label for a dead screen.
 */
async function loadAppLabels(packageNames: string[]): Promise<Record<string, string>> {
  try {
    // `?? {}` IS LOAD-BEARING, not belt-and-braces. This screen is one of the
    // few whose failure mode is INVISIBLE: a nullish map reaches
    // `applyAppLabels`, the property read throws inside the effect, and the
    // screen sits on "Looking for apps on your phone…" forever with no error
    // shown and onboarding unable to continue. A missing label is worth
    // nothing; a wedged onboarding step costs the whole install.
    return (await getAppLabels(packageNames)) ?? {};
  } catch {
    return {};
  }
}

/**
 * The installed ruleset, or the bundled seed.
 *
 * BOTH FALLBACKS ARE REAL, not defensive padding. On a fresh install this
 * screen renders inside app/lock.tsx's "needs_onboarding" branch, which sits
 * ABOVE the unlock gate in app/_layout.tsx — so `getDatabase()` still throws
 * `DatabaseLockedError` and there is no seeded ruleset row to read yet
 * (bootstrapApp() has not run). Reading the active ruleset first still matters
 * for every other entry: a server-updated catalogue is the one that knows about
 * providers the bundled JSON predates.
 */
async function loadBundle(): Promise<RulesetBundle> {
  try {
    const active = await getActiveRuleset();
    if (active) return active;
  } catch {
    // The database is not open yet — expected during first-run onboarding.
  }
  // `tunables` and `traitSignals` are both absent from the seed JSON by design
  // (seed_rules.ts's header); the repository fills them on read, and so does
  // this fallback path.
  return {
    ...SEED_BUNDLE,
    tunables: DEFAULT_TUNABLES,
    traitSignals: SEED_BUNDLE.traitSignals ?? DEFAULT_TRAIT_SIGNALS,
  };
}

export default function ProvidersScreen({ onDone }: { onDone?: () => void } = {}) {
  const [choices, setChoices] = useState<ProviderChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Same double-tap discipline as recovery_phrase.tsx's initializingRef and
  // device_lock.tsx's checkInFlightRef — a ref, not state, because it has to be
  // true for the SECOND synchronous tap of a double-tap, before React has
  // re-rendered.
  const writeInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // THREE STEPS, AND THE THIRD CANNOT BE PARALLELISED WITH THE OTHER TWO:
    // the label lookup is keyed on the package list, and the package list is
    // what `buildProviderChoices` produces. The tiles are still rendered once,
    // fully named — never named from the seed and then re-labelled a beat
    // later, which would flicker a stale brand across the screen for exactly
    // as long as it takes to read it.
    (async () => {
      const [observed, bundle] = await Promise.all([loadObserved(), loadBundle()]);
      const catalogue = buildProviderChoices(observed, bundle);
      const labels = await loadAppLabels(catalogue.map((choice) => choice.packageName));
      if (!cancelled) setChoices(applyAppLabels(catalogue, labels));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback(
    (packageNames: string[]) => {
      if (writeInFlightRef.current) return;
      writeInFlightRef.current = true;
      setBusy(true);
      setProviderFilter(packageNames)
        .catch((error: unknown) => {
          // Allow-all is already the on-disk default, so a failed write leaves
          // the app capturing everything — degraded, but still tracking. The
          // user can narrow it later in Settings; stranding them on this step
          // would be the worse outcome, and there is nothing here for them to
          // fix.
          console.error("setProviderFilter failed; capture stays unfiltered", error);
        })
        .finally(() => {
          writeInFlightRef.current = false;
          setBusy(false);
          onDone?.();
        });
    },
    [onDone],
  );

  const handleSkip = useCallback(() => commit([]), [commit]);

  // Nothing renders until BOTH sources have answered. A half-built list is
  // tappable, and a tap on it writes a filter that omits the user's own apps —
  // which then silently drops every transaction from them.
  if (!choices) {
    return (
      <View
        testID="provider-picker-loading"
        className="flex-1 items-center justify-center bg-bg px-6 dark:bg-bg-dark"
      >
        <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
          Looking for apps on your phone…
        </Text>
        <View className="mt-6 w-full">
          <LoadingSkeleton rows={5} />
        </View>
      </View>
    );
  }

  return <ProviderPicker choices={choices} busy={busy} onConfirm={commit} onSkip={handleSkip} />;
}
