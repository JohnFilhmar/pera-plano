package expo.modules.notificationlistener

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

/**
 * Covers everything in `NotificationListenerModule.kt` that is reachable
 * without an `AppContext`:
 *
 *  - the bridge-level exception mapping -- [mapKeyErrors] and
 *    [requireDeviceKekPresent] -- which is the crux of the encryption plan's
 *    Task 4 rejection taxonomy (docs/12-encryption-and-app-lock.md §6/§9;
 *    interface contract §4). A code review caught that this mapping
 *    previously had NO test at all -- only a successful compile and a reading
 *    of the vendor source stood behind it. Without a test, a future refactor
 *    that breaks the mapping (e.g. swapping two `catch` branches, or losing
 *    the presence check) produces a green build and a broken unlock.
 *  - the M1a Task 6 bridge surface -- notification-access grant, the two
 *    user-facing switches, listener health, the live-capture sink, and the
 *    shape `drainPendingCaptures` hands JS.
 *
 * THE SEAM, and its one honest limitation. Every function under test here is
 * a top-level, `Module`-free function that the `ModuleDefinition` block calls
 * in one line, exactly like [isDeviceSecure]/[openSecuritySettings] before
 * them. Nothing in this file constructs a `Module` or an `AppContext`,
 * because an `AsyncFunction` body cannot be invoked without the JSI runtime
 * those need. That buys real coverage of every decision the bridge makes and
 * leaves exactly one thing unproven: that each `AsyncFunction` is wired to
 * the helper it names. Keep the DSL bodies one-liners so that stays the only
 * gap.
 *
 * Robolectric, not plain JUnit: `SharedPreferences`, `Settings.Secure`,
 * `NotificationManagerCompat` and `android.util.Base64` (reached through
 * [CaptureBuffer]/[CaptureEnvelope]) are real framework classes that throw
 * "not mocked" under ordinary JUnit. The taxonomy tests below were written
 * before this file needed a runtime and are unaffected by running under one --
 * neither [mapKeyErrors] nor [requireDeviceKekPresent] touches anything
 * Android-specific beyond the exception CLASSES themselves.
 *
 * [KeyStoreBridge.vault] is swapped for a [FakeKeyVault] exactly like every
 * other test in this module -- [CaptureBuffer.append] seals every record
 * under the capture public key, so without it nothing can be buffered at all.
 */
// sdk 34, matching every other Robolectric suite in this module (see
// CaptureEnvelopeTest's doc for why: this module's real compileSdk 36 needs
// Java 21, and this project's toolchain is Java 17).
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class NotificationListenerModuleTest {

  /** Interface contract §4 `RawCapture`, verbatim. Nothing else may appear. */
  private val contractKeys = setOf(
    "id", "packageName", "title", "text", "subText", "bigText", "postedAt", "capturedAt",
  )

  /** Interface contract §4 `getListenerHealth`, verbatim. */
  private val healthKeys = setOf("granted", "serviceConnected", "lastCaptureAt")

  // ILLUSTRATIVE package names -- real PH e-wallet package ids used only as
  // opaque allowlist strings; nothing here needs them to exist on the device.
  private val gcash = "com.globe.gcash.android"
  private val maya = "com.paymaya"

  private lateinit var context: Context

  @Before
  fun setUp() {
    KeyStoreBridge.vault = FakeKeyVault()
    context = RuntimeEnvironment.getApplication()
    PeraPlanoNotificationListenerService.liveSink = null
  }

  @After
  fun tearDown() {
    // Defensive, same reasoning as every other test file here: both of these
    // are process-global singletons, and a fake vault or a stale sink left
    // installed would silently defang whichever test runs next.
    KeyStoreBridge.vault = AndroidKeyVault
    PeraPlanoNotificationListenerService.liveSink = null
  }

  // ---------------------------------------------------------------------
  // mapKeyErrors
  // ---------------------------------------------------------------------

  @Test
  fun `mapKeyErrors maps KeyPermanentlyInvalidatedException to DeviceKeyInvalidatedException coded DeviceKeyInvalidated`() {
    val thrown = assertThrows(DeviceKeyInvalidatedException::class.java) {
      mapKeyErrors<Unit> { throw KeyPermanentlyInvalidatedException() }
    }

    assertEquals("DeviceKeyInvalidated", thrown.code)
  }

  @Test
  fun `mapKeyErrors maps UserNotAuthenticatedException to NotAuthenticatedException coded NotAuthenticated`() {
    val thrown = assertThrows(NotAuthenticatedException::class.java) {
      mapKeyErrors<Unit> { throw UserNotAuthenticatedException() }
    }

    assertEquals("NotAuthenticated", thrown.code)
  }

  @Test
  fun `mapKeyErrors lets an unrelated exception propagate completely unchanged`() {
    val original = IllegalArgumentException("not a Keystore failure at all")

    val propagated = assertThrows(IllegalArgumentException::class.java) {
      mapKeyErrors<Unit> { throw original }
    }

    // Not just "same exception type" -- the exact same instance, proving
    // mapKeyErrors never wraps or replaces what it doesn't recognize.
    assertSame(original, propagated)
  }

  @Test
  fun `mapKeyErrors returns the block's result untouched when nothing is thrown`() {
    val result = mapKeyErrors { "unaffected" }

    assertEquals("unaffected", result)
  }

  // ---------------------------------------------------------------------
  // requireDeviceKekPresent
  // ---------------------------------------------------------------------

  @Test
  fun `requireDeviceKekPresent throws DeviceKeyMissingException coded DeviceKeyMissing when the device KEK was never created`() {
    // setUp installs a brand-new FakeKeyVault -- no ensureDeviceKek call at
    // all, so the alias genuinely does not exist yet.
    val thrown = assertThrows(DeviceKeyMissingException::class.java) {
      requireDeviceKekPresent()
    }

    assertEquals("DeviceKeyMissing", thrown.code)
  }

  @Test
  fun `requireDeviceKekPresent does not throw once the device KEK has been created`() {
    KeyStoreBridge.ensureDeviceKek()

    requireDeviceKekPresent() // must not throw
  }

  // ---------------------------------------------------------------------
  // The taxonomy's four codes are pairwise distinct strings -- collapsing
  // any two would be exactly the bug class this task exists to avoid.
  // ---------------------------------------------------------------------

  @Test
  fun `the four bridge error codes are pairwise distinct`() {
    val codes = listOf(
      DeviceKeyInvalidatedException().code,
      DeviceKeyMissingException().code,
      NotAuthenticatedException().code,
      CaptureBufferReadFailedException().code,
    )

    assertEquals(4, codes.toSet().size)
    assertEquals("DeviceKeyInvalidated", codes[0])
    assertEquals("DeviceKeyMissing", codes[1])
    assertEquals("NotAuthenticated", codes[2])
    assertEquals("CaptureBufferReadFailed", codes[3])
    // Belt-and-suspenders pairwise check, spelled out rather than only
    // relying on set-size: makes the failure message point at exactly
    // which two codes collided if this regresses.
    for (i in codes.indices) {
      for (j in codes.indices) {
        if (i != j) assertNotEquals(codes[i], codes[j])
      }
    }
  }

  // =====================================================================
  // drainPendingCaptures (M1a plan Task 6 rules 3 and 6)
  //
  // The AsyncFunction was already implemented by the encryption plan and
  // already returns `records.map { it.toMap() }`; what was missing was any
  // test at this level at all. `CaptureBufferTest` proves drain's storage
  // behaviour and `CaptureRecordTest` proves toMap's key names, but nothing
  // proved the two compose into what JS actually receives -- and "returned
  // the records but never cleared the file" is a bug that both of those
  // suites pass with flying colours.
  // =====================================================================

  @Test
  fun `drainPendingCaptures returns buffered records and empties the buffer`() {
    KeyStoreBridge.ensureCaptureKeyPair()
    val file = CaptureBuffer.fileFor(context)
    CaptureBuffer.clear(file)

    val first = sampleRecord(id = "11111111-1111-4111-8111-111111111111", text = "Sent PHP 100.00")
    val second = sampleRecord(id = "22222222-2222-4222-8222-222222222222", text = "Sent PHP 250.50")
    CaptureBuffer.append(file, first)
    CaptureBuffer.append(file, second)
    assertEquals(2, CaptureBuffer.size(file))

    val drained = drainAsTheBridgeDoes()

    // Both records come back, oldest first, with their payloads intact -- a
    // drain that cleared without returning fails right here.
    assertEquals(listOf(first.id, second.id), drained.map { it["id"] })
    assertEquals("Sent PHP 100.00", drained[0]["text"])
    assertEquals("Sent PHP 250.50", drained[1]["text"])

    // ...and the buffer is genuinely gone from DISK, not merely reported
    // empty. A drain that returned the records but left the file behind
    // would replay every one of them on the next drain.
    assertFalse("drain must not leave the pending-capture file behind", file.exists())
    assertEquals(0, CaptureBuffer.size(file))
  }

  @Test
  fun `a second drain returns an empty list`() {
    KeyStoreBridge.ensureCaptureKeyPair()
    val file = CaptureBuffer.fileFor(context)
    CaptureBuffer.clear(file)
    CaptureBuffer.append(file, sampleRecord())

    assertEquals(1, drainAsTheBridgeDoes().size)

    // The clear half of drain, observed the way JS observes it. This is the
    // one that catches "returned fine, deleted nothing": the first drain
    // above passes either way, and only a second call distinguishes them.
    assertEquals(emptyList<Map<String, Any?>>(), drainAsTheBridgeDoes())

    // A genuinely empty buffer is not an error -- it resolves with `[]`
    // (see NotificationListenerModule's class doc on the fifth outcome), so
    // a third drain on a buffer that was never written must behave the same.
    assertEquals(emptyList<Map<String, Any?>>(), drainAsTheBridgeDoes())
  }

  @Test
  fun `drained maps carry exactly the eight contract field names`() {
    KeyStoreBridge.ensureCaptureKeyPair()
    val file = CaptureBuffer.fileFor(context)
    CaptureBuffer.clear(file)

    val populated = sampleRecord(id = "33333333-3333-4333-8333-333333333333")
    val sparse = sampleRecord(
      id = "44444444-4444-4444-8444-444444444444",
      title = null,
      subText = null,
      bigText = null,
    )
    CaptureBuffer.append(file, populated)
    CaptureBuffer.append(file, sparse)

    val drained = drainAsTheBridgeDoes()

    // The EXACT key set, not a containsKey sweep: a per-field containsKey
    // check passes happily when a ninth key leaks in, and an extra key on
    // this map is how a native field escapes into JS's RawCapture.
    assertEquals(2, drained.size)
    for (map in drained) {
      assertEquals(contractKeys, map.keys)
    }

    assertEquals(populated.id, drained[0]["id"])
    assertEquals(gcash, drained[0]["packageName"])
    assertEquals("GCash", drained[0]["title"])
    assertEquals("You received PHP 1,500.00 from JUAN D.", drained[0]["text"])
    assertEquals("Main wallet", drained[0]["subText"])
    assertEquals("Ref. no. 0091 2837 4655", drained[0]["bigText"])
    assertEquals(1_754_060_400_000L, drained[0]["postedAt"])
    assertEquals(1_754_060_400_777L, drained[0]["capturedAt"])

    // An absent notification extra stays a present key with a null value --
    // contract §4 types every string field `string | null`, so dropping the
    // key instead would hand JS `undefined` where it expects `null`.
    for (key in listOf("title", "subText", "bigText")) {
      assertTrue("a null field must keep its key", drained[1].containsKey(key))
      assertNull(drained[1][key])
    }
    assertEquals("You received PHP 1,500.00 from JUAN D.", drained[1]["text"])
  }

  // =====================================================================
  // The two user-facing switches (contract §4; plan Task 6)
  // =====================================================================

  @Test
  fun `setCaptureEnabled and setProviderFilter write through to CapturePrefs`() {
    setCaptureEnabled(context, false)
    setProviderFilter(context, listOf(gcash, maya, gcash))

    // Read back through a CapturePrefs that did NOT perform the write. The
    // listener service is started by Android in a process that may have been
    // created purely to host it, long after this one died -- a value the
    // bridge only kept in memory would be invisible there, and the visible
    // symptom would be capture continuing from providers the user just
    // de-selected.
    val fresh = CapturePrefs(context)
    assertFalse(fresh.isCaptureEnabled())
    // The duplicate above collapses: contract §4 passes an array, CapturePrefs
    // stores a set.
    assertEquals(setOf(gcash, maya), fresh.getProviderFilter())
    assertFalse("the pause switch outranks the allowlist", fresh.shouldCapture(gcash))

    // Both switches have to move in BOTH directions -- a write-once
    // implementation passes everything above and strands the user with
    // capture permanently off and an allowlist they cannot clear.
    setCaptureEnabled(context, true)
    setProviderFilter(context, emptyList())

    val reopened = CapturePrefs(context)
    assertTrue(reopened.isCaptureEnabled())
    // Empty means ALLOW ALL, not deny all -- see CapturePrefs.getProviderFilter.
    assertEquals(emptySet<String>(), reopened.getProviderFilter())
    assertTrue(reopened.shouldCapture("com.some.bank.nobody.allowlisted"))
  }

  // =====================================================================
  // getListenerHealth (contract §4; plan Task 6 rule 4)
  // =====================================================================

  @Test
  fun `getListenerHealth reports granted, serviceConnected and lastCaptureAt`() {
    denyNotificationAccess()

    val fresh = listenerHealth(context)

    assertEquals(healthKeys, fresh.keys)
    assertEquals(false, fresh["granted"])
    // Never claim a binding that has not been observed: the health screen
    // exists precisely to catch the case where Android never bound the
    // service.
    assertEquals(false, fresh["serviceConnected"])
    // The never-captured case, asserted explicitly. `0L` is a valid epoch
    // millisecond, so a 0L-as-absent sentinel would tell the health UI the
    // last capture happened on 1 January 1970 instead of "not yet".
    assertTrue("lastCaptureAt must be reported, not omitted", fresh.containsKey("lastCaptureAt"))
    assertNull("nothing captured yet is null, not the epoch", fresh["lastCaptureAt"])

    // Now change all three underneath it and ask again. `granted` in
    // particular has to be a LIVE query -- the user can revoke notification
    // access from system settings at any moment, and some OEMs revoke it on
    // reboot, so a value cached at module init would report a listener that
    // stopped working days ago as healthy.
    grantNotificationAccess()
    val prefs = CapturePrefs(context)
    prefs.recordListenerConnected(true)
    prefs.recordCapture(1_754_060_400_000L)

    val live = listenerHealth(context)

    assertEquals(healthKeys, live.keys)
    assertEquals(true, live["granted"])
    assertEquals(true, live["serviceConnected"])
    assertEquals(1_754_060_400_000L, live["lastCaptureAt"])

    // ...and revoking access has to be visible too, not just granting it.
    denyNotificationAccess()
    assertEquals(false, listenerHealth(context)["granted"])
  }

  // =====================================================================
  // The live-capture sink (plan Task 6 rule 5)
  // =====================================================================

  @Test
  fun `OnStartObserving installs a liveSink and OnStopObserving clears it`() {
    assertNull(
      "nothing may be listening before OnStartObserving runs",
      PeraPlanoNotificationListenerService.liveSink,
    )

    val emitted = mutableListOf<Map<String, Any?>>()
    installLiveSink { payload -> emitted += payload }

    val sink = PeraPlanoNotificationListenerService.liveSink
    assertNotNull("OnStartObserving must install a sink the service can reach", sink)

    // What the service hands the sink is a CaptureRecord; what crosses the
    // bridge must be the contract §4 map, produced by CaptureRecord.toMap()
    // rather than by a second hand-rolled mapping that can drift from it.
    val record = sampleRecord()
    requireNotNull(sink).invoke(record)
    assertEquals(listOf(record.toMap()), emitted)
    assertEquals(contractKeys, emitted.single().keys)

    clearLiveSink()

    // The half that actually matters. A sink left installed after JS stops
    // listening points at a dead bridge -- both a leak and a crash -- and a
    // test that only asserted "start installed one" lets a permanent sink
    // pass unnoticed.
    assertNull(
      "OnStopObserving must clear the sink, not merely stop using it",
      PeraPlanoNotificationListenerService.liveSink,
    )

    // ...and nothing arrives after the clear, which is the observable
    // consequence of the assertion above.
    installLiveSink { payload -> emitted += payload }
    clearLiveSink()
    assertEquals(1, emitted.size)
  }

  // =====================================================================
  // Fixtures
  // =====================================================================

  /**
   * The `drainPendingCaptures` AsyncFunction's body, minus the
   * `requireContext()` that needs an `AppContext` -- see the class doc's
   * note on the seam. The error-mapping half of that body (`mapKeyErrors`
   * and the `ReadFailedException` -> `CaptureBufferReadFailedException`
   * translation) is covered by the taxonomy tests above and by
   * `CaptureBufferTest`; what these three tests exercise is the composition
   * of [CaptureBuffer.drain] with [CaptureRecord.toMap], which is what JS
   * actually receives.
   */
  // ---------------------------------------------------------------------
  // openAccessSettings. Not in the plan's six-test list, but rule 2 of the
  // task brief is a behavioural requirement like any other, and this is the
  // one navigation the whole feature depends on: until the user reaches the
  // Notification Access screen, nothing is ever captured. Mirrors the pair
  // DeviceSecurityTest keeps on its twin, openSecuritySettings.
  // ---------------------------------------------------------------------

  @Test
  fun `openAccessSettings starts an Intent for ACTION_NOTIFICATION_LISTENER_SETTINGS`() {
    val context = RuntimeEnvironment.getApplication()

    openAccessSettings(context)

    val started = Shadows.shadowOf(context).nextStartedActivity
    assertNotNull("openAccessSettings must actually call startActivity", started)
    // The security-settings action is the near-miss to guard against: it is
    // the twin helper's action, one screen away, and lands the user somewhere
    // that cannot grant notification access at all.
    assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, started.action)
  }

  @Test
  fun `openAccessSettings sets FLAG_ACTIVITY_NEW_TASK -- required because the caller is not an Activity Context`() {
    val context = RuntimeEnvironment.getApplication()

    openAccessSettings(context)

    val started = Shadows.shadowOf(context).nextStartedActivity
    assertTrue(
      "starting an Activity from a non-Activity Context throws on a real device without this flag",
      (started.flags and Intent.FLAG_ACTIVITY_NEW_TASK) != 0,
    )
  }

  private fun drainAsTheBridgeDoes(): List<Map<String, Any?>> =
    CaptureBuffer.drain(CaptureBuffer.fileFor(context)).map { it.toMap() }

  /**
   * Every string below is ILLUSTRATIVE: invented sample copy in the shape of
   * a PH e-wallet alert, never a real message. postedAt and capturedAt are
   * deliberately different values -- identical fixtures would let a mapping
   * that conflates the two sail through.
   */
  private fun sampleRecord(
    id: String = "3f1c6a2e-9b47-4c1d-8f52-77a0d1b6e904",
    title: String? = "GCash",
    text: String? = "You received PHP 1,500.00 from JUAN D.",
    subText: String? = "Main wallet",
    bigText: String? = "Ref. no. 0091 2837 4655",
  ) = CaptureRecord(
    id = id,
    packageName = gcash,
    title = title,
    text = text,
    subText = subText,
    bigText = bigText,
    postedAt = 1_754_060_400_000L,
    capturedAt = 1_754_060_400_777L,
  )

  /**
   * `NotificationManagerCompat.getEnabledListenerPackages` reads exactly this
   * secure setting and parses it as a colon-separated list of
   * `package/class` component names -- the same string the system writes when
   * the user toggles an app on in the Notification Access screen.
   */
  private fun setEnabledNotificationListeners(value: String) {
    Settings.Secure.putString(context.contentResolver, "enabled_notification_listeners", value)
  }

  private fun grantNotificationAccess() {
    setEnabledNotificationListeners(
      "${context.packageName}/${PeraPlanoNotificationListenerService::class.java.name}",
    )
  }

  /**
   * A non-empty setting naming a DIFFERENT app, not an empty one: "some
   * listener is enabled, just not ours" is the state that distinguishes a
   * real membership check from a "is anything enabled at all" check.
   */
  private fun denyNotificationAccess() {
    setEnabledNotificationListeners("com.some.other.app/com.some.other.app.SomeListener")
  }
}
