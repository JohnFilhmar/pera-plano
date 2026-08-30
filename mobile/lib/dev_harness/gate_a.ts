// lib/dev_harness/gate_a.ts — the Gate A measurement (docs/13 Part 1).
//
// NOT PRODUCT CODE. Everything under lib/dev_harness/ is on-device
// verification tooling. It is reachable only from app/dev_harness.tsx, which
// is itself gated behind EXPO_PUBLIC_DEV_HARNESS (see that file's header for
// the build-time story and for the export check that proves it is absent from
// a production bundle).
//
// WHAT GATE A IS. Argon2id parameters are part of the on-disk format: KEK-
// recovery is re-derived by re-running Argon2id with exactly the parameters in
// lib/crypto/recovery_phrase.ts, so once a real user holds a recovery phrase
// those four numbers can never change without a migration that re-wraps under
// both parameter sets. Too slow hangs onboarding and recovery; too fast means
// the phrase is cheaper to attack than intended. The number therefore has to
// be settled BEFORE the first real phrase is issued, and it has to be settled
// on hardware.
//
// WHY THIS RUNS INSIDE THE APP RATHER THAN IN NODE OR A JVM. The derivation is
// pure JavaScript (`@noble/hashes`' argon2idAsync). Hermes is the engine that
// executes it in production, and Hermes is not Node: the same parameters have
// already been measured at ~190 ms under plain Node, 1.2-1.6 s under Jest, and
// 3,351 ms under Hermes on an A54. A measurement taken in the wrong engine is
// not a slow measurement of the right thing, it is a measurement of something
// else.
//
// WHY IT IMPORTS deriveRecoveryKey RATHER THAN CALLING argon2idAsync ITSELF.
// A harness that re-implements the call — even correctly, even copying the
// same four constants — proves something about the copy. This file has no
// Argon2id parameters of its own; it imports both the function and the
// parameter record from lib/crypto/recovery_phrase.ts, and the parameters it
// reports are read from the same frozen object derivation itself reads.
//
// WHAT IT DOES NOT DO. It never decides whether Gate A passed. The 500 ms - 1 s
// target in docs/13 is a design target that the project owner already
// consciously overrode on 2026-08-15 (see the parameter block in
// recovery_phrase.ts). This file reports a number, a band, and a comparison
// against the previously recorded figure. The decision stays with a human.
//
// SECRECY. No recovery phrase belonging to a user is ever timed here. The
// input is the canonical all-zero-entropy BIP-39 test vector, which is public
// and opens nothing, and no field of the emitted result carries a phrase, a
// word, a salt, or a derived key — only its length. Do not add one.

import * as Crypto from "expo-crypto";
import { ARGON2ID_PARAMS, deriveRecoveryKey } from "@/lib/crypto/recovery_phrase";

/**
 * A string that must NOT appear in a production JS bundle.
 *
 * `scripts/device/verify_harness_absent.ps1` exports the production bundle and
 * greps for this token; a non-zero count means the harness survived into a
 * shippable build and must be removed before release. Keep it a single literal
 * that nothing else in the repo would produce by accident.
 */
export const DEV_HARNESS_SENTINEL = "PERAPLANO_DEV_HARNESS_5b1f2c";

/**
 * Prefix on the single-line machine-readable result written to the console.
 *
 * In a dev-client build this reaches logcat under the `ReactNativeJS` tag, so
 * `scripts/device/run_gate_a.ps1` can scrape the JSON out of
 * `adb logcat` without a human transcribing digits off a phone screen.
 */
export const HARNESS_LOG_PREFIX = "PERAPLANO_HARNESS";

/**
 * The canonical BIP-39 test vector for 128 bits of all-zero entropy: twelve
 * real wordlist entries with a valid checksum, published in BIP-39 itself and
 * in every implementation's test fixtures.
 *
 * Deliberately a KNOWN PUBLIC phrase rather than a freshly generated one. A
 * generated phrase would be indistinguishable from a user's, and this file's
 * output is designed to be pasted into a document; a public vector cannot leak
 * anything because there is nothing to leak. Argon2id's cost does not depend
 * on the password's contents, so this measures exactly what a real phrase
 * would.
 */
const TEST_VECTOR_PHRASE = [
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "abandon",
  "about",
];

const SALT_BYTES = 16;

/** The docs/13 Part 1 design target, carried here so the report can say which side of it landed. */
const TARGET_MS = Object.freeze({ low: 500, high: 1000 });

/**
 * The figure already recorded in docs/13 and in recovery_phrase.ts's parameter
 * block: 3,351 ms median, SM-A546E / Exynos 1380 / Android 16, Hermes, on a
 * DEV-CLIENT bundle.
 *
 * Present so a re-run reports a delta rather than a bare number. It is a
 * reference point, not a threshold — nothing here fails for missing it.
 */
const RECORDED_REFERENCE = Object.freeze({
  median_ms: 3351,
  runs_ms: [3351, 3506, 3526, 3263, 3207],
  device: "Samsung SM-A546E (Galaxy A54 5G), Exynos 1380, Android 16",
  bundle: "dev-client",
  recorded_on: "2026-08-15",
});

export type TimingBand = "under_target" | "in_target" | "over_target";

export type GateAEngine = {
  /** True when Hermes is the engine. If this is false the measurement is worthless — see `warnings`. */
  hermes: boolean;
  /**
   * `__DEV__`. A dev-client bundle carries development-only checks a release
   * bundle does not, so a dev-client figure is an upper bound on the release
   * figure rather than the release figure.
   */
  dev_bundle: boolean;
};

export type GateAResult = {
  gate: "A";
  sentinel: string;
  started_at: string;
  /** Read from the same frozen record `deriveRecoveryKey` reads. Never transcribed. */
  params: { t: number; m_kib: number; p: number; dk_len: number };
  engine: GateAEngine;
  warmup_ms: number[];
  runs_ms: number[];
  median_ms: number;
  min_ms: number;
  max_ms: number;
  mean_ms: number;
  /** max - min. The point of running five times is seeing this, not the median. */
  spread_ms: number;
  target_ms: { low: number; high: number };
  band: TimingBand;
  /** Length of the key that came back, in bytes. NEVER the key. */
  derived_key_bytes: number;
  reference: typeof RECORDED_REFERENCE;
  delta_vs_reference_ms: number;
  /** Anything that makes the number un-interpretable. A non-empty list means do not record the figure. */
  warnings: string[];
};

export type GateAOptions = {
  /** Timed runs. Default 5, matching the 2026-08-15 methodology. */
  runs?: number;
  /**
   * Untimed runs first. Default 1.
   *
   * The first derivation in a process pays Hermes' lazy bytecode work and the
   * first allocation of the 2 MiB Argon2id block. Including it in the median
   * measures the warm-up, not the workload.
   */
  warmups?: number;
  /** Called after every run so a screen can show progress on a 20-second job. */
  on_progress?: (done: number, total: number) => void;
};

function now_ms(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}

/** Median of a copy — never sorts the caller's array, which the report also prints in run order. */
export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function classify_band(median_ms: number, target = TARGET_MS): TimingBand {
  if (median_ms < target.low) return "under_target";
  if (median_ms > target.high) return "over_target";
  return "in_target";
}

/**
 * Runs the real `deriveRecoveryKey` `runs` times and reports wall-clock.
 *
 * Wall-clock around the awaited call is the right measure even though
 * `argon2idAsync` yields to the event loop internally: what the gate is about
 * is how long a user waits on the recovery-phrase screen, and a user waits for
 * the wall clock, not for CPU time.
 */
export async function run_gate_a(options: GateAOptions = {}): Promise<GateAResult> {
  const runs = options.runs ?? 5;
  const warmups = options.warmups ?? 1;
  const total = runs + warmups;

  const warnings: string[] = [];
  const hermes = (globalThis as { HermesInternal?: unknown }).HermesInternal != null;
  if (!hermes) {
    warnings.push(
      "Not running on Hermes. Gate A is a question about the shipping JS engine; " +
        "this number does not answer it.",
    );
  }
  const dev_bundle = typeof __DEV__ !== "undefined" && __DEV__;
  if (dev_bundle) {
    warnings.push(
      "Dev-client bundle (__DEV__ is true). Development-only checks are present, " +
        "so treat this as an upper bound on the release figure and re-measure on " +
        "a preview (release) build before settling the parameters.",
    );
  }

  const salt = await Crypto.getRandomBytesAsync(SALT_BYTES);

  const warmup_ms: number[] = [];
  const runs_ms: number[] = [];
  let derived_key_bytes = 0;
  let done = 0;

  for (let i = 0; i < total; i++) {
    const started = now_ms();
    const key = await deriveRecoveryKey(TEST_VECTOR_PHRASE, salt);
    const elapsed = now_ms() - started;
    derived_key_bytes = key.length;
    if (i < warmups) warmup_ms.push(elapsed);
    else runs_ms.push(elapsed);
    done += 1;
    options.on_progress?.(done, total);
  }

  if (derived_key_bytes !== ARGON2ID_PARAMS.dk_len) {
    warnings.push(
      `Derived key was ${derived_key_bytes} bytes, expected ${ARGON2ID_PARAMS.dk_len}. ` +
        "Something other than the shipping derivation ran.",
    );
  }

  const median_ms = Math.round(median(runs_ms));
  const min_ms = Math.round(Math.min(...runs_ms));
  const max_ms = Math.round(Math.max(...runs_ms));
  const mean_ms = Math.round(runs_ms.reduce((sum, v) => sum + v, 0) / runs_ms.length);

  return {
    gate: "A",
    sentinel: DEV_HARNESS_SENTINEL,
    started_at: new Date().toISOString(),
    params: {
      t: ARGON2ID_PARAMS.t,
      m_kib: ARGON2ID_PARAMS.m_kib,
      p: ARGON2ID_PARAMS.p,
      dk_len: ARGON2ID_PARAMS.dk_len,
    },
    engine: { hermes, dev_bundle },
    warmup_ms: warmup_ms.map((v) => Math.round(v)),
    runs_ms: runs_ms.map((v) => Math.round(v)),
    median_ms,
    min_ms,
    max_ms,
    mean_ms,
    spread_ms: max_ms - min_ms,
    target_ms: { ...TARGET_MS },
    band: classify_band(median_ms),
    derived_key_bytes,
    reference: RECORDED_REFERENCE,
    delta_vs_reference_ms: median_ms - RECORDED_REFERENCE.median_ms,
    warnings,
  };
}

/**
 * One line, one JSON object, on stdout — the form `run_gate_a.ps1` scrapes out
 * of `adb logcat -s ReactNativeJS`.
 *
 * `console.log` and not `console.error` on purpose: an error line in logcat is
 * how a real failure is meant to look, and a successful measurement is not one.
 */
export function emit_result(result: GateAResult): void {
  console.log(`${HARNESS_LOG_PREFIX} ${JSON.stringify(result)}`);
}
