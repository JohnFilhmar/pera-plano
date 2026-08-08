package expo.modules.notificationlistener

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * [CapturePrefs] is the one piece of listener state that has to be readable
 * with no JS running and no user present: the notification-listener service
 * is started by Android on its own schedule, long after the process that set
 * these values was killed (M1a plan Task 4; interface contract §4). So every
 * assertion here is about behaviour a fresh process would see -- never about
 * a field on the instance that happened to do the write.
 *
 * Runs under Robolectric because `SharedPreferences` is a real `android.*`
 * framework class with no plain-JVM substitute; under ordinary JUnit
 * `Context.getSharedPreferences` throws "not mocked".
 */
// sdk 34, matching every other Robolectric suite in this module (see
// CaptureEnvelopeTest's doc for why: this module's real compileSdk 36 needs
// Java 21, and this project's toolchain is Java 17).
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class CapturePrefsTest {

  // ILLUSTRATIVE package names throughout -- real PH e-wallet/bank package
  // ids, used only as opaque allowlist strings. Nothing here depends on any
  // of them actually existing on the device.
  private val gcash = "com.globe.gcash.android"
  private val maya = "com.paymaya"
  private val bpi = "com.bpi.mobile"

  private lateinit var context: Context
  private lateinit var prefs: CapturePrefs

  @Before
  fun setUp() {
    // Robolectric hands each test method a fresh Application backed by its
    // own temp data directory, so this is a genuine "fresh install" every
    // time -- no cross-test bleed through the shared prefs file.
    context = RuntimeEnvironment.getApplication()
    prefs = CapturePrefs(context)
  }

  // ---------------------------------------------------------------------
  // The pause switch defaults to ON. A fresh install that captured nothing
  // until the user found a settings toggle would look, to the user, exactly
  // like a broken app.
  // ---------------------------------------------------------------------

  @Test
  fun `capture is enabled by default`() {
    assertTrue(
      "a fresh install must capture without the user turning anything on",
      prefs.isCaptureEnabled(),
    )
  }

  // ---------------------------------------------------------------------
  // The pause switch outranks the allowlist. Asserted with a package that
  // IS in a non-empty filter: a shouldCapture that consulted only the filter
  // would answer `true` there, which is the actual bug being excluded. (An
  // empty filter alone could not isolate it -- a filter-only implementation
  // answers `true` in that case too, but so would several correct ones.)
  // ---------------------------------------------------------------------

  @Test
  fun `setCaptureEnabled false makes shouldCapture false for every package`() {
    prefs.setProviderFilter(setOf(gcash, bpi))
    prefs.setCaptureEnabled(false)

    assertFalse(prefs.isCaptureEnabled())
    assertFalse(
      "a package inside the allowlist must still be refused while capture is paused",
      prefs.shouldCapture(gcash),
    )
    assertFalse(prefs.shouldCapture(bpi))
    assertFalse(prefs.shouldCapture(maya))

    // ...and the same with the allow-all (empty) filter, so no combination
    // of filter state can resurrect capture while the switch is off.
    prefs.setProviderFilter(emptySet())
    assertFalse(prefs.shouldCapture(gcash))
    assertFalse(prefs.shouldCapture(maya))
  }

  // ---------------------------------------------------------------------
  // Empty means "allow all", not "allow nothing". Inverting this is the
  // silent-failure mode: a fresh install would capture nothing at all, with
  // no error anywhere, until the user happened to pick providers.
  // ---------------------------------------------------------------------

  @Test
  fun `an empty provider filter allows any package`() {
    // The fresh-install shape: never set at all.
    assertEquals(emptySet<String>(), prefs.getProviderFilter())
    assertTrue(prefs.shouldCapture(gcash))
    assertTrue(prefs.shouldCapture("com.some.bank.nobody.allowlisted"))

    // ...and the explicitly-cleared shape, which must behave identically to
    // never-set rather than becoming a deny-all.
    prefs.setProviderFilter(setOf(gcash))
    prefs.setProviderFilter(emptySet())

    assertEquals(emptySet<String>(), prefs.getProviderFilter())
    assertTrue(prefs.shouldCapture(gcash))
    assertTrue(prefs.shouldCapture(maya))
  }

  // ---------------------------------------------------------------------
  // A non-empty filter is a real allowlist in the right direction.
  // ---------------------------------------------------------------------

  @Test
  fun `a non-empty filter allows listed packages and rejects unlisted ones`() {
    prefs.setProviderFilter(setOf(gcash, maya))

    assertEquals(setOf(gcash, maya), prefs.getProviderFilter())
    assertTrue(prefs.shouldCapture(gcash))
    assertTrue(prefs.shouldCapture(maya))
    // Not merely "something is rejected" -- an unlisted package must be
    // rejected while the listed ones above are still accepted, which an
    // inverted membership test cannot satisfy at the same time.
    assertFalse(prefs.shouldCapture(bpi))
    assertFalse(prefs.shouldCapture("com.random.chat.app"))
  }

  // ---------------------------------------------------------------------
  // Persistence is the entire reason this class exists. Every assertion
  // below reads through a CapturePrefs instance that did NOT perform the
  // write -- state kept in an instance field would sail through an
  // assertion made on the writer.
  // ---------------------------------------------------------------------

  @Test
  fun `provider filter and enabled flag survive a new CapturePrefs instance`() {
    prefs.setProviderFilter(setOf(gcash, bpi))
    prefs.setCaptureEnabled(false)

    val reopened = CapturePrefs(context)

    assertFalse("the pause switch must outlive the instance that set it", reopened.isCaptureEnabled())
    assertEquals(setOf(gcash, bpi), reopened.getProviderFilter())

    // A write through the second instance must be just as durable as a write
    // through the first -- and must be visible to a third, so the filter and
    // the flag are both genuinely shared storage and not per-instance state
    // that merely happened to be seeded once.
    reopened.setCaptureEnabled(true)
    val third = CapturePrefs(context)

    assertTrue(third.isCaptureEnabled())
    assertTrue(third.shouldCapture(gcash))
    assertFalse(third.shouldCapture(maya))
  }

  // ---------------------------------------------------------------------
  // "Never captured" is null, never 0L. 0L is a perfectly valid epoch
  // millisecond value, so a 0L sentinel would tell the health UI the last
  // capture happened on 1 January 1970 instead of "not yet".
  // ---------------------------------------------------------------------

  @Test
  fun `lastCaptureAt is null before any capture and returns the recorded value after`() {
    assertNull("nothing captured yet is null, not the epoch", prefs.lastCaptureAt())

    // ILLUSTRATIVE timestamp -- epoch milliseconds, per interface contract §1.
    val postedAt = 1754060400000L
    prefs.recordCapture(postedAt)

    assertEquals(postedAt, prefs.lastCaptureAt())
    // And it survives the process, like everything else here.
    assertEquals(postedAt, CapturePrefs(context).lastCaptureAt())

    // Recording an actual 0L must read back as 0L, not as "never captured" --
    // this is what rules out a 0L-as-absent sentinel rather than a real
    // presence check.
    prefs.recordCapture(0L)
    assertEquals(0L, prefs.lastCaptureAt())
  }
}
