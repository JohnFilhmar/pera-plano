// app/dev_harness.tsx — the on-device verification harness screen.
//
// NOT A PRODUCT SURFACE. Nothing in the app links here; the only way in is a
// deep link, which is how `scripts/device/run_gate_a.ps1` drives it:
//
//   adb shell am start -a android.intent.action.VIEW \
//     -d "peraplano://dev_harness?gate=a&autorun=1&runs=5&warmups=1"
//
// WHY A ROUTE AT ALL, rather than a script that pokes JS from outside. There
// is no way to poke JS from outside. Gate A's whole point is that the
// derivation must execute in the app's own Hermes instance (see
// lib/dev_harness/gate_a.ts's header), and the only things that execute inside
// that instance are the app's own modules. A route is the smallest surface
// that (a) runs real app code in the real engine, (b) is addressable from adb
// with no human tapping, and (c) can be switched off at build time. The
// alternatives were each worse: a JVM/Node benchmark measures the wrong
// engine, an instrumented Android test cannot reach JS at all, and hanging the
// measurement off an existing product screen would put verification code on a
// path real users walk.
//
// HOW IT IS KEPT OUT OF PRODUCTION, and how that is CHECKED rather than
// asserted:
//
//   1. `process.env.EXPO_PUBLIC_DEV_HARNESS` is inlined by Metro at bundle
//      time (that is what the EXPO_PUBLIC_ prefix means). With the variable
//      unset — which is every build that does not deliberately opt in,
//      production included — the comparison below folds to a constant and the
//      component is a `return null`.
//   2. eas.json is deliberately NOT modified. No build profile turns this on.
//      A preview build that wants the harness sets the variable on the command
//      line, per the runbook in docs/13.
//   3. `scripts/device/verify_harness_absent.ps1` exports the production
//      bundle and greps it for `DEV_HARNESS_SENTINEL`. That is the check that
//      matters: point 1 is a claim about the minifier, and this repo has
//      already been bitten once by trusting a bundler's default behaviour
//      (docs/13's route-table scare, resolved the same way — by exporting the
//      bundle and grepping it). If the sentinel is present, delete this file
//      and lib/dev_harness/ before cutting the release build.
//
// THE LOCK GATE IS UPSTREAM OF THIS SCREEN, and deliberately not bypassed.
// app/_layout.tsx renders `<LockScreen />` instead of the Stack whenever the
// lock status is anything but "unlocked", so this route is unreachable during
// onboarding and on a locked app. Adding a `__DEV__` escape hatch to the root
// layout's lock gate would put a conditional lock bypass into a finance app's
// most security-sensitive file, and Gate A does not need one: Argon2id
// derivation costs the same before and after onboarding, because it touches
// neither the database nor the Keystore. The runbook states the precondition —
// unlock the app first — instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import {
  DEV_HARNESS_SENTINEL,
  type GateAResult,
  emit_result,
  run_gate_a,
} from "@/lib/dev_harness/gate_a";

const HARNESS_ENABLED = process.env.EXPO_PUBLIC_DEV_HARNESS === "1";

type Status = "idle" | "running" | "done" | "error";

function parse_count(value: string | string[] | undefined, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export default function DevHarnessScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    gate?: string;
    autorun?: string;
    runs?: string;
    warmups?: string;
  }>();
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<GateAResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A second concurrent run would interleave two derivations on one JS thread
  // and time both of them wrong. Autorun plus an impatient tap is exactly how
  // that happens.
  const running_ref = useRef(false);

  const runs = parse_count(params.runs, 5);
  const warmups = parse_count(params.warmups, 1);

  const run = useCallback(async () => {
    if (running_ref.current) return;
    running_ref.current = true;
    setStatus("running");
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: runs + warmups });
    try {
      const measured = await run_gate_a({
        runs,
        warmups,
        on_progress: (done, total) => setProgress({ done, total }),
      });
      setResult(measured);
      setStatus("done");
      // Emitted last, so the line in logcat means "the number on screen is
      // final", not "a run started".
      emit_result(measured);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
      console.error("[dev_harness] gate A failed", err);
    } finally {
      running_ref.current = false;
    }
  }, [runs, warmups]);

  const autorun = params.autorun === "1" && (params.gate ?? "a").toLowerCase() === "a";
  useEffect(() => {
    if (!HARNESS_ENABLED) return;
    if (!autorun) return;
    void run();
    // Deliberately mount-only. Re-firing on `run`'s identity would restart the
    // measurement every time a param re-parsed, which is the "forever-looping"
    // shape this codebase already names as a bug class in app/_layout.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!HARNESS_ENABLED) return null;

  return (
    <ScrollView
      testID="dev-harness"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
      contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48, gap: 12 }}
      className="flex-1 bg-bg dark:bg-bg-dark"
    >
      <Text className="text-title font-bold text-fg dark:text-fg-dark">
        Gate A — Argon2id derivation timing
      </Text>
      <Text testID="harness-sentinel" className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
        {DEV_HARNESS_SENTINEL}
      </Text>
      <Text className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
        Runs the app&apos;s own deriveRecoveryKey. Nothing here is a pass or a fail — record the
        number in docs/13 and decide there.
      </Text>

      <View className="mt-2">
        <Button
          testID="harness-run-button"
          title={status === "running" ? "Running…" : "Run Gate A"}
          size="lg"
          disabled={status === "running"}
          onPress={() => void run()}
        />
      </View>

      {status === "running" && progress ? (
        <Text testID="harness-progress" className="text-body font-medium text-fg dark:text-fg-dark">
          {`Derivation ${progress.done} of ${progress.total}…`}
        </Text>
      ) : null}

      {status === "error" ? (
        <Text testID="harness-error" className="text-body font-medium text-danger dark:text-danger-dark">
          {error}
        </Text>
      ) : null}

      {result ? (
        <View className="gap-2">
          <Text testID="harness-median" className="text-hero font-extrabold text-fg dark:text-fg-dark">
            {`${result.median_ms} ms`}
          </Text>
          <Text className="text-body font-medium text-fg-2 dark:text-fg-2-dark">
            {`median of ${result.runs_ms.length} · min ${result.min_ms} · max ${result.max_ms} · spread ${result.spread_ms}`}
          </Text>
          <Text className="text-body font-medium text-fg-2 dark:text-fg-2-dark">
            {`m=${result.params.m_kib} KiB, t=${result.params.t}, p=${result.params.p}, dkLen=${result.params.dk_len}`}
          </Text>
          <Text className="text-body font-medium text-fg-2 dark:text-fg-2-dark">
            {`hermes=${result.engine.hermes} · __DEV__=${result.engine.dev_bundle} · band=${result.band}`}
          </Text>
          <Text className="text-body font-medium text-fg-2 dark:text-fg-2-dark">
            {`vs 2026-08-15 dev-client median (${result.reference.median_ms} ms): ${
              result.delta_vs_reference_ms >= 0 ? "+" : ""
            }${result.delta_vs_reference_ms} ms`}
          </Text>
          {result.warnings.map((warning) => (
            <Text
              key={warning}
              className="text-secondary font-medium text-warn dark:text-warn-dark"
            >
              {warning}
            </Text>
          ))}
          {/* The same JSON that went to logcat, so a session with no adb
              attached can still be transcribed by hand. */}
          <Text testID="harness-json" selectable className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
            {JSON.stringify(result)}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
