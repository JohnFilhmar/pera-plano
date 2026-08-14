package expo.modules.notificationlistener

import android.content.Context
import android.content.SharedPreferences
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

  // The on-disk key names, spelled out as LITERALS rather than read from
  // [CapturePrefs]' constants. That is deliberate: these four strings are the
  // storage format, and the migration below is only meaningful against a file
  // an OLDER BUILD wrote. A test that asked the current code what it calls its
  // own keys would rename them in lockstep with a refactor and quietly stop
  // testing anything -- including, fatally, that the plaintext key an upgrade
  // must delete is the one the previous build actually used.
  private val legacyKeyProviderFilter = "provider_filter"
  private val legacyKeyLastCaptureAt = "last_capture_at"
  private val sealedKeyProviderFilter = "provider_filter_sealed"
  private val sealedKeyLastCaptureAt = "last_capture_at_sealed"

  private lateinit var context: Context
  private lateinit var prefs: CapturePrefs

  @Before
  fun setUp() {
    // Robolectric hands each test method a fresh Application backed by its
    // own temp data directory, so this is a genuine "fresh install" every
    // time -- no cross-test bleed through the shared prefs file.
    context = RuntimeEnvironment.getApplication()

    // The provider filter and the capture timestamp are sealed under the
    // prefs KEK (provider-selection plan Task 2), so this suite needs a key
    // to seal against. It installs one HERE and not in production code: the
    // assertions that production actually creates this key -- on app launch
    // and, separately, in a listener bound before the app was ever opened --
    // live in NotificationListenerModuleTest and
    // PeraPlanoNotificationListenerServiceTest, against a virgin vault.
    // Doing it here as well would be the harness doing production's job,
    // which is exactly how the capture keypair's equivalent gap (`bca1bcd`)
    // stayed invisible to this module's suite while dropping every capture
    // on a real device.
    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensurePrefsKek()

    prefs = CapturePrefs(context)
  }

  @After
  fun tearDown() {
    // Defensive, same as every other suite here: KeyStoreBridge is a
    // process-global singleton, and a fake vault left installed would
    // silently defang whichever test file runs next.
    KeyStoreBridge.vault = AndroidKeyVault
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

  // ---------------------------------------------------------------------
  // The connection flag. Not one of the six tests the plan names, but it is
  // half of what `getListenerHealth` reports (contract §4) and it has the
  // same process-death requirement as everything else here -- Task 5 covers
  // the SERVICE that calls these, which is a different thing from covering
  // the persistence underneath them.
  //
  // The default is the load-bearing part: `false`. The health screen exists
  // to catch the case where Android silently never bound the service, so a
  // default of `true` would have it report a healthy listener on a device
  // where capture has never once run -- the exact failure it was built to
  // surface, reported as success.
  // ---------------------------------------------------------------------

  @Test
  fun `listener connection defaults to false and survives a new CapturePrefs instance`() {
    assertFalse("an unobserved binding must never be reported as connected", prefs.isListenerConnected())

    prefs.recordListenerConnected(true)
    assertTrue(prefs.isListenerConnected())
    assertTrue("must survive the process that wrote it", CapturePrefs(context).isListenerConnected())

    // Disconnect has to persist too. Only writing on connect would leave a
    // killed service permanently reported as bound.
    prefs.recordListenerConnected(false)
    assertFalse(CapturePrefs(context).isListenerConnected())
  }

  // =====================================================================
  // AT REST (provider-selection plan Task 2; docs/12-encryption-and-app-lock.md §4).
  //
  // §4 puts "a malicious app reading app-private storage on a rooted device"
  // IN scope and promises "the database file is ciphertext; the buffer is
  // ciphertext". The provider filter was neither -- it named every bank and
  // e-wallet the user holds, in plaintext, in
  // `shared_prefs/peraplano_capture_prefs.xml`.
  //
  // EVERY assertion below reads the RAW STORED VALUE, never the accessor.
  // Through `getProviderFilter()` these tests pass identically with and
  // without encryption, which would make them worthless.
  // =====================================================================

  @Test
  fun `the raw stored provider filter is ciphertext -- no package name survives on disk`() {
    prefs.setProviderFilter(setOf(gcash, maya, bpi))

    // The specific value, read exactly as `cat` would see it.
    val stored = rawPrefs().getString(sealedKeyProviderFilter, null)
    assertNotNull("the provider filter must be stored as a sealed string", stored)
    assertFalse("the stored value must not name a package", stored!!.contains(gcash))

    // ...and then the whole file, because a partial seal that left the
    // package names in some OTHER key would sail past the check above. This
    // is the assertion in the plan's completion checklist: someone pulling
    // peraplano_capture_prefs.xml off a stolen phone finds ciphertext and
    // nothing else.
    val onDisk = rawStoredText()
    for (packageName in listOf(gcash, maya, bpi)) {
      assertFalse("no package name may appear anywhere in the prefs file: $onDisk", onDisk.contains(packageName))
    }

    // The accessor still works, which is what makes the above a seal rather
    // than a deletion.
    assertEquals(setOf(gcash, maya, bpi), CapturePrefs(context).getProviderFilter())
  }

  @Test
  fun `the raw stored last capture timestamp is not a readable epoch value`() {
    // ILLUSTRATIVE timestamp -- epoch milliseconds, per interface contract §1.
    val postedAt = 1754060400000L
    prefs.recordCapture(postedAt)

    val stored = rawPrefs().getString(sealedKeyLastCaptureAt, null)
    assertNotNull("the capture timestamp must be stored as a sealed string", stored)

    // A capture timestamp is a behavioural fact about the phone's owner --
    // when they last moved money, and, over a file's history, whether they
    // are being tracked at all. It is sealed for the same reason the filter
    // is, and a plaintext `putLong` would leave the digits right there.
    val onDisk = rawStoredText()
    assertFalse("the epoch value must not appear on disk: $onDisk", onDisk.contains(postedAt.toString()))

    assertEquals(postedAt, CapturePrefs(context).lastCaptureAt())
  }

  @Test
  fun `the two non-sensitive booleans stay plaintext and cost no decrypt`() {
    prefs.setCaptureEnabled(false)
    prefs.recordListenerConnected(true)

    // Read as BOOLEANS straight out of SharedPreferences. Neither reveals
    // anything about the user's finances, and sealing them would buy nothing
    // while costing a decrypt on the hot path (plan Task 2 rule 1) -- so a
    // getBoolean that started throwing ClassCastException here is the
    // regression this pins.
    assertFalse(rawPrefs().getBoolean("capture_enabled", true))
    assertTrue(rawPrefs().getBoolean("listener_connected", false))

    // And, decisively: with NO prefs key in existence at all, both still read
    // back correctly. A boolean that had been swept into the sealing would
    // fall back to its default here instead.
    KeyStoreBridge.vault = FakeKeyVault()
    val withoutAnyKey = CapturePrefs(context)
    assertFalse("the pause switch must not depend on the prefs key", withoutAnyKey.isCaptureEnabled())
    assertTrue("the connection flag must not depend on the prefs key", withoutAnyKey.isListenerConnected())
  }

  // ---------------------------------------------------------------------
  // Migration off the plaintext format (plan Task 2 rule 3).
  //
  // Writing a sealed COPY is the failure that looks like success: the whole
  // point is that the plaintext stops existing on disk, so every test here
  // asserts `contains()` is false for the old key, not merely that the new
  // one appeared.
  // ---------------------------------------------------------------------

  @Test
  fun `migration seals a plaintext provider filter and deletes the plaintext key`() {
    writeLegacyPlaintextFilter(setOf(gcash, bpi))

    val migrated = CapturePrefs(context)

    // The value survives...
    assertEquals(setOf(gcash, bpi), migrated.getProviderFilter())
    assertTrue(migrated.shouldCapture(gcash))
    assertFalse(migrated.shouldCapture(maya))

    // ...and the plaintext is GONE, not merely shadowed by a sealed copy.
    assertFalse(
      "the plaintext key must be removed, not left beside the sealed one",
      rawPrefs().contains(legacyKeyProviderFilter),
    )
    val onDisk = rawStoredText()
    assertFalse("the migrated package names must not remain on disk: $onDisk", onDisk.contains(gcash))
    assertFalse(onDisk.contains(bpi))
  }

  @Test
  fun `migration seals a plaintext last capture timestamp and deletes the plaintext key`() {
    val postedAt = 1754060400000L
    writeLegacyPlaintextCapture(postedAt)

    val migrated = CapturePrefs(context)

    assertEquals(postedAt, migrated.lastCaptureAt())
    assertFalse(
      "the plaintext key must be removed, not left beside the sealed one",
      rawPrefs().contains(legacyKeyLastCaptureAt),
    )
    assertFalse(rawStoredText().contains(postedAt.toString()))
  }

  @Test
  fun `a migrated captured-at-zero stays zero rather than collapsing into never-captured`() {
    // `0L` is a valid epoch millisecond. An upgrade that read the legacy value
    // through a `getLong(key, 0L)`-shaped default and then treated `0L` as
    // "nothing stored" would erase a genuine capture-at-zero, which is the
    // same distinction lastCaptureAt() draws with a presence check.
    writeLegacyPlaintextCapture(0L)

    assertEquals(0L, CapturePrefs(context).lastCaptureAt())
    assertFalse(rawPrefs().contains(legacyKeyLastCaptureAt))
  }

  @Test
  fun `migration runs once -- a second CapturePrefs does not re-seal the already-sealed value`() {
    writeLegacyPlaintextFilter(setOf(gcash, maya))

    CapturePrefs(context)
    val afterFirst = rawPrefs().getString(sealedKeyProviderFilter, null)
    assertNotNull("the first construction must seal the legacy filter", afterFirst)

    // Two more constructions, exactly as a restarted listener process does --
    // CapturePrefs is built fresh on every single notification.
    CapturePrefs(context)
    val third = CapturePrefs(context)

    // BYTE-IDENTICAL, not merely "still openable". Every seal mints a fresh
    // GCM IV, so a migration that ran again would produce a different blob
    // even in the benign case; in the realistic case it re-seals the
    // already-sealed value into a double-wrapped blob nothing can open.
    assertEquals(
      "migration must not run a second time",
      afterFirst,
      rawPrefs().getString(sealedKeyProviderFilter, null),
    )
    assertEquals(setOf(gcash, maya), third.getProviderFilter())
  }

  @Test
  fun `constructing CapturePrefs on a fresh install writes nothing`() {
    // Nothing has ever been stored, so there is nothing to migrate -- and the
    // constructor runs once per notification, in a headless service, on a
    // file that is rewritten in full on every commit. A constructor that
    // sealed its defaults would churn the disk on every delivery and rewrite
    // the file with a fresh IV each time.
    assertTrue(
      "a fresh install must not be written to just by reading it: ${rawStoredText()}",
      rawPrefs().all.isEmpty(),
    )

    CapturePrefs(context)
    CapturePrefs(context)

    assertTrue(rawPrefs().all.isEmpty())
  }

  // ---------------------------------------------------------------------
  // Still never throws (plan Task 2 rule 4). A value that cannot be opened
  // falls back to the documented default -- inside the listener, an escaping
  // exception is caught by handlePosted and turned into a silently dropped
  // capture, one logcat line per notification lost.
  // ---------------------------------------------------------------------

  @Test
  fun `a provider filter sealed under a lost key falls back to allow-all rather than throwing`() {
    prefs.setProviderFilter(setOf(gcash))

    // What a Keystore reset, a restore onto a new device, or a reinstall
    // looks like from this side: the alias is there, the key behind it is
    // not the one the value was sealed under.
    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensurePrefsKek()

    val stranded = CapturePrefs(context)

    assertEquals(emptySet<String>(), stranded.getProviderFilter())
    // Allow-all, never deny-all: degrading toward capturing too much is
    // visible to the user and correctable; capturing nothing is not.
    assertTrue(stranded.shouldCapture(gcash))
    assertTrue(stranded.shouldCapture("com.some.bank.nobody.allowlisted"))
  }

  @Test
  fun `a garbage provider filter value falls back to allow-all rather than throwing`() {
    // The shape a preferences file left behind by an older or foreign build
    // has -- the case the class's never-throw rule was written for.
    rawPrefs().edit().putString(sealedKeyProviderFilter, "this is not a sealed value at all").commit()

    val prefsOverGarbage = CapturePrefs(context)

    assertEquals(emptySet<String>(), prefsOverGarbage.getProviderFilter())
    assertTrue(prefsOverGarbage.shouldCapture(gcash))
  }

  @Test
  fun `an unopenable last capture timestamp reads as never-captured rather than throwing`() {
    prefs.recordCapture(1754060400000L)

    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensurePrefsKek()

    assertNull(
      "an unreadable timestamp is 'not yet', never the epoch",
      CapturePrefs(context).lastCaptureAt(),
    )
  }

  // =====================================================================
  // Helpers
  // =====================================================================

  /**
   * The preferences file as an attacker with the bytes would see it -- the
   * same `SharedPreferences` instance [CapturePrefs] writes through, read
   * with no help from it. `all` is exactly the set of key/value pairs the XML
   * holds, so a package name that survives anywhere in the file shows up in
   * this string. The on-disk XML itself is folded in when it exists, which
   * makes the claim literal rather than merely equivalent.
   */
  private fun rawStoredText(): String {
    val entries = rawPrefs().all.entries.joinToString("\n") { "${it.key}=${it.value}" }
    val xml = File(File(context.applicationInfo.dataDir, "shared_prefs"), "${CapturePrefs.PREFS_NAME}.xml")
    return if (xml.isFile) entries + "\n" + xml.readText() else entries
  }

  private fun rawPrefs(): SharedPreferences =
    context.getSharedPreferences(CapturePrefs.PREFS_NAME, Context.MODE_PRIVATE)

  /** Exactly what a pre-Task-2 build left on disk: a plaintext `StringSet`. */
  private fun writeLegacyPlaintextFilter(packageNames: Set<String>) {
    rawPrefs().edit().putStringSet(legacyKeyProviderFilter, packageNames).commit()
  }

  /** Exactly what a pre-Task-2 build left on disk: a plaintext `Long`. */
  private fun writeLegacyPlaintextCapture(atMillis: Long) {
    rawPrefs().edit().putLong(legacyKeyLastCaptureAt, atMillis).commit()
  }
}
