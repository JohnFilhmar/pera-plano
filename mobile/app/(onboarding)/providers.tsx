// app/(onboarding)/providers.tsx — the onboarding step that turns the seed's
// guesses and the listener's learned package names into a filter the user
// actually chose (provider-selection plan Task 4; docs/04-features/01-onboarding.md
// step 6). Reached from app/(onboarding)/battery.tsx; advances to wallets.tsx;
// skippable, like every onboarding step except the device lock and the phrase.
//
// IT IS A NUMBERED STEP NOW, NOT A PRE-FLOW ONE (GAP-091). It used to run in
// app/(onboarding)/index.tsx's own sequencer, straight after the recovery
// phrase and before "welcome" -- which is BEFORE notification access is
// granted. The listener has observed nothing until it is bound, so
// `listObservedPackages()` returned an empty list on every fresh install and
// this screen's whole subject, "Apps we've seen", could never have anything in
// it. It now occupies the slot ONBOARDING_STEPS always reserved for it, after
// "battery", where docs step 6 puts it.
//
// IT NAVIGATES ITSELF, like every other routed step. `onDone` is kept and still
// takes precedence, because the step suites drive this screen directly and
// assert on it -- see app/(onboarding)/wallets.tsx's header for the same
// arrangement and the silent no-op that made it necessary.
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
// user tapped Skip" therefore write `setProviderFilter([], false)` and change
// nothing else.
//
// THE `false` IS THE DENY-ALL FLAG, AND IT STAYS `false` HERE (GAP-103). The
// bridge can now say "block every package", which is what the Privacy centre
// sends when the user pauses every provider. Ticking nothing at onboarding is
// not that: it is a user who has not chosen yet, and answering them with a
// block would be the same never-tracks-anything app the next paragraph refuses
// to build out of `setCaptureEnabled(false)`.
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
//
// AND THE SELECTION IS ALSO WRITTEN DOWN NOW, WHICH IS WHERE THAT RULE BITES
// HARDEST (GAP-116). `paused_provider_packages` — the row the Privacy switches
// read back and lib/bootstrap.ts re-asserts on every launch — holds the
// COMPLEMENT of the allowlist this screen sends, so recording an empty
// allowlist as "every provider paused" would hand every user who taps Skip
// exactly the deny-all the paragraph above refuses.
// lib/onboarding/pending_provider_pause.ts owns that inversion and the empty
// case. There IS an open database on this screen now that it runs inside the
// numbered flow, so the record is persisted here rather than waiting for the
// next launch -- `bootstrapApp()` has already run by this point, so waiting
// would have left the Privacy switches stale until the app was restarted, and
// the wallets step reads the same row one screen later. The hand-off through
// that module is kept regardless: it is what survives a write that fails, and
// the launch drain still recovers it.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { ProviderPicker } from "@/components/onboarding/provider_picker";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { applyAppLabels, buildProviderChoices } from "@/lib/ingest/provider_catalogue";
import { SEED_BUNDLE } from "@/lib/ingest/seed_rules";
import { DEFAULT_TRAIT_SIGNALS, DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import {
  persistPendingProviderPause,
  recordOnboardingProviderPause,
} from "@/lib/onboarding/pending_provider_pause";
import {
  getAppLabels,
  isAccessGranted,
  listObservedPackages,
  setProviderFilter,
} from "@/modules/notification_listener";

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
  const router = useRouter();
  const [choices, setChoices] = useState<ProviderChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Same double-tap discipline as recovery_phrase.tsx's initializingRef and
  // device_lock.tsx's checkInFlightRef — a ref, not state, because it has to be
  // true for the SECOND synchronous tap of a double-tap, before React has
  // re-rendered.
  const writeInFlightRef = useRef(false);
  // Every package the ruleset behind the catalogue knows about — the universe
  // the paused record is inverted against. A ref rather than state because
  // `commit` is the only reader and nothing renders from it, so putting it in
  // that callback's dependencies would rebuild the callback for no visible
  // change. Starts empty, which records nothing rather than something wrong;
  // it is always set by the time a tile is tappable, since the same
  // `if (!cancelled)` block below publishes both it and `choices`.
  // The catalogue is built ONCE, however often this component re-renders. The
  // effect below has to depend on `advance` -- it is what a declined access
  // grant calls -- and `advance` is only as stable as `useRouter()`, which is
  // one identity change away from re-running a bridge round trip on every
  // render. Same discipline as app/(onboarding)/wallets.tsx's own
  // `initializedRef`, for the same reason.
  const initializedRef = useRef(false);
  const universeRef = useRef<string[]>([]);

  // nextStep("providers") === "wallets" (lib/onboarding/onboarding_state.ts),
  // hardcoded so the literal matches a real file for expo-router to resolve.
  const advance = useCallback(() => {
    if (onDone) {
      onDone();
      return;
    }
    router.push("/(onboarding)/wallets");
  }, [onDone, router]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let cancelled = false;
    // THREE STEPS, AND THE THIRD CANNOT BE PARALLELISED WITH THE OTHER TWO:
    // the label lookup is keyed on the package list, and the package list is
    // what `buildProviderChoices` produces. The tiles are still rendered once,
    // fully named — never named from the seed and then re-labelled a beat
    // later, which would flicker a stale brand across the screen for exactly
    // as long as it takes to read it.
    (async () => {
      // SKIPPED ENTIRELY WHEN ACCESS WAS DECLINED (docs rule 8: "provider
      // picker is skipped too if access was declined, since matchers would have
      // nothing to match"). Only reachable now that this step runs AFTER the
      // grant -- before the move there was no answer to ask for at this point
      // in the flow, which is why the rule had never been implemented.
      //
      // A BRIDGE FAILURE SHOWS THE PICKER. "Granted" is the assumption that
      // costs less when wrong: an unnecessary picker is one skippable screen,
      // where a wrongly skipped one silently removes a choice the user was
      // promised and cannot get back inside this flow.
      const granted = await isAccessGranted().catch(() => true);
      if (cancelled) return;
      if (!granted) {
        advance();
        return;
      }

      const [observed, bundle] = await Promise.all([loadObserved(), loadBundle()]);
      const catalogue = buildProviderChoices(observed, bundle);
      const labels = await loadAppLabels(catalogue.map((choice) => choice.packageName));
      if (cancelled) return;
      universeRef.current = bundle.providers.flatMap((provider) => provider.packageNames);
      setChoices(applyAppLabels(catalogue, labels));
    })();
    return () => {
      cancelled = true;
    };
  }, [advance]);

  const commit = useCallback(
    (packageNames: string[]) => {
      if (writeInFlightRef.current) return;
      writeInFlightRef.current = true;
      setBusy(true);
      // RECORDED BEFORE THE BRIDGE CALL, NEVER AFTER IT (GAP-116). The call
      // below can reject, the `.catch` deliberately carries on, and the entire
      // point of the record is that it survives exactly that — so it is a
      // synchronous in-memory assignment that runs whichever way the bridge
      // goes, not a `.then`.
      //
      // THE OPPOSITE ORDER TO THE PRIVACY CENTRE'S, DELIBERATELY.
      // `hooks/mutations/use_set_provider_pause.ts` writes native first and
      // refuses to record a scope that did not land, because its row is what a
      // switch list reads back and a row nobody applied would lie to the user
      // standing in front of it. This record is an intent, not a claim about
      // the listener: lib/bootstrap.ts persists it and pushes it across the
      // bridge in the same launch, and there is nobody on this screen left to
      // mislead — only a selection with nothing to recover it from.
      recordOnboardingProviderPause(packageNames, universeRef.current);
      // `false`, always: this screen writes an ALLOWLIST and never a deny-all,
      // including when the list is empty. See the header comment.
      setProviderFilter(packageNames, false)
        .catch((error: unknown) => {
          // Allow-all is already the on-disk default, so a failed write leaves
          // the app capturing everything — degraded, but still tracking. The
          // user can narrow it later in Settings; stranding them on this step
          // would be the worse outcome, and there is nothing here for them to
          // fix.
          //
          // GAP-114 MADE THIS BRANCH REACHABLE ON PURPOSE, and it is why the
          // native side reports a dropped write as a REJECTION rather than as
          // a returned flag: this handler is the identical bug one screen
          // away, and a `false` would have passed straight through it while
          // the Privacy centre looked fixed. The Privacy centre refuses to
          // record a scope that did not land because it keeps a readable row
          // that would otherwise lie.
          //
          // THIS SCREEN NOW KEEPS A RECORD TOO, AND KEEPS IT REGARDLESS
          // (GAP-116) — the opposite rule, for the opposite reason. A selection
          // that failed to seal used to end here and nowhere else: not applied,
          // not written down, and never re-offered either, because
          // app/(onboarding)/index.tsx does not re-run this step for an install
          // that already has keys. `recordOnboardingProviderPause` above ran
          // before the call that just failed, so `bootstrapApp()` stores the
          // same selection in `paused_provider_packages` and pushes it back
          // across the bridge as soon as there is a database to hold it.
          console.error("setProviderFilter failed; the listener keeps its existing filter", error);
        })
        // AWAITED BEFORE MOVING ON (GAP-091), and after the `.catch` rather
        // than inside a `.then` on the raw call, so a failed push still writes
        // the row -- that is the whole point of the record. The wallets step
        // reads it on the very next screen to know which providers the user
        // actually kept, so navigating first would race it. The call swallows
        // its own failures and always resolves.
        .then(() => persistPendingProviderPause())
        .finally(() => {
          writeInFlightRef.current = false;
          setBusy(false);
          advance();
        });
    },
    [advance],
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
