package expo.modules.notificationlistener

import android.app.KeyguardManager
import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Gate B of docs/13-on-device-verification.md: does draining a FULL capture
 * buffer fit inside the Keystore keys' 10-second authentication window?
 *
 * Why this cannot be answered on the JVM. Every buffered record costs one
 * RSA-2048/OAEP `doFinal` against the secure element. A plain-JVM benchmark
 * put 500 of those at 442 ms, but that number is a floor and nothing more --
 * it measures raw crypto and cannot see Keystore/Binder IPC or StrongBox
 * latency, which is exactly what dominates on real hardware. The whole point
 * of this file is to replace a floor with a measurement.
 *
 * Why it needs a human. `KeyVault` builds both keys with
 * `setUserAuthenticationParameters(10, AUTH_BIOMETRIC_STRONG or
 * AUTH_DEVICE_CREDENTIAL)`, so the private key is usable only for ten seconds
 * after the user last authenticated to the device. An unattended test run has
 * no way to produce that authentication, so this test WAITS for a fresh
 * lock -> unlock transition and starts timing the instant it sees one.
 *
 * Sealing needs no authentication (it uses the public half), so the 500
 * records are written before the wait -- none of that setup burns the window.
 *
 * Read the result with:
 * ```
 * adb logcat -s PeraPlanoBench:I
 * ```
 */
@RunWith(AndroidJUnit4::class)
class DrainBenchmarkInstrumentedTest {

  private companion object {
    const val TAG = "PeraPlanoBench"

    /** `CaptureBuffer.MAX_CAPTURES` -- a full buffer is the worst case and the only one worth timing. */
    const val RECORD_COUNT = CaptureBuffer.MAX_CAPTURES

    /** How long to wait for the human to lock and unlock the device. */
    const val UNLOCK_WAIT_MS = 120_000L

    /**
     * The budget under test. Not an assertion threshold -- the test reports
     * rather than fails, because a number is the deliverable here and a red
     * test would hide it behind a stack trace.
     */
    const val AUTH_WINDOW_MS = 10_000L
  }

  @Test
  fun fullBufferDrainAgainstTheTenSecondAuthWindow() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

    check(keyguard.isDeviceSecure) {
      "this device has no screen lock, so the auth window this test exists to measure does not apply"
    }

    // A benchmark file of its own -- never the real buffer. Draining the real
    // one would destroy captures that belong to whoever is holding the phone.
    val file = File(context.filesDir, "benchmark_captures.ndjson")
    file.delete()

    KeyStoreBridge.ensureCaptureKeyPair()

    // ---- Seal. No authentication required: this is the public half. ----
    val sealStart = SystemClock.elapsedRealtime()
    repeat(RECORD_COUNT) { index -> CaptureBuffer.append(file, benchmarkRecord(index)) }
    val sealMs = SystemClock.elapsedRealtime() - sealStart
    Log.i(TAG, "sealed $RECORD_COUNT records in ${sealMs}ms (public key, no auth window involved)")

    waitForFreshUnlock(keyguard)

    // ---- Drain. Every record costs one doFinal against the secure element. ----
    val drainStart = SystemClock.elapsedRealtime()
    val drained =
      try {
        CaptureBuffer.drain(file)
      } catch (error: Exception) {
        val failedAfter = SystemClock.elapsedRealtime() - drainStart
        // This IS a result, not a crash: it means the window expired mid-drain,
        // which is precisely the production failure this gate exists to catch.
        Log.i(
          TAG,
          "RESULT: drain FAILED after ${failedAfter}ms with ${error.javaClass.simpleName} -- " +
            "the ${AUTH_WINDOW_MS}ms window is TOO TIGHT for $RECORD_COUNT records",
        )
        throw error
      }
    val drainMs = SystemClock.elapsedRealtime() - drainStart

    Log.i(TAG, "RESULT: drained ${drained.size} records in ${drainMs}ms")
    Log.i(TAG, "RESULT: per-record cost ${drainMs.toDouble() / drained.size} ms")
    Log.i(TAG, "RESULT: headroom against the ${AUTH_WINDOW_MS}ms window: ${AUTH_WINDOW_MS - drainMs}ms")
    if (drainMs > AUTH_WINDOW_MS * 0.8) {
      Log.i(TAG, "RESULT: VERDICT widen the window -- within 20% of the ceiling under ideal conditions")
    } else {
      Log.i(TAG, "RESULT: VERDICT the window holds")
    }

    assertEquals("the whole buffer must come back", RECORD_COUNT, drained.size)
  }

  /**
   * Blocks until the device is locked and then unlocked again, so the drain
   * below starts against a window that has just opened rather than one with
   * an unknown amount left on it. Polls rather than using a listener: this is
   * a test, and a broadcast receiver here would need a Looper it does not have.
   */
  private fun waitForFreshUnlock(keyguard: KeyguardManager) {
    Log.i(TAG, "ACTION NEEDED: lock the device (power button), then unlock it. Waiting...")

    val deadline = SystemClock.elapsedRealtime() + UNLOCK_WAIT_MS
    var sawLocked = false
    while (SystemClock.elapsedRealtime() < deadline) {
      val locked = keyguard.isKeyguardLocked
      if (locked) {
        sawLocked = true
      } else if (sawLocked) {
        Log.i(TAG, "fresh unlock observed -- draining immediately")
        return
      }
      Thread.sleep(100)
    }
    error("timed out after ${UNLOCK_WAIT_MS}ms waiting for a lock -> unlock cycle")
  }

  /**
   * ILLUSTRATIVE content, deliberately the shape and length of a real
   * Philippine e-wallet notification -- RSA-OAEP cost is bounded by the
   * modulus rather than the payload, but the AES layer inside the envelope
   * is not, so a toy one-word record would understate the real cost.
   */
  private fun benchmarkRecord(index: Int): CaptureRecord {
    val now = System.currentTimeMillis()
    return CaptureRecord(
      id = UUID.randomUUID().toString(),
      packageName = "com.globe.gcash.android",
      title = "GCash",
      text = "You sent PHP 1,250.00 to JUAN D. Ref. No. 901234567$index",
      subText = null,
      bigText = "You sent PHP 1,250.00 to JUAN D. on $now. Ref. No. 901234567$index. " +
        "Your remaining balance is PHP 4,318.55.",
      postedAt = now - index,
      capturedAt = now,
    )
  }
}
