package expo.modules.notificationlistener

import android.app.Notification
import android.content.Context
import android.os.Process
import android.service.notification.StatusBarNotification
import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * [PeraPlanoNotificationListenerService] is the only part of this app that runs
 * when the app is closed (M1a plan Task 5; interface contract §4). A capture it
 * drops is gone with no trace and no UI anywhere to report it, so every test
 * here is about a specific way it could silently drop -- or silently leak -- a
 * notification, never about "the happy path works".
 *
 * TWO SEAMS, deliberately different:
 *
 *  - [PeraPlanoNotificationListenerService.extractCapture] is a pure companion
 *    function, so the parsing tests need no `Service` at all.
 *  - The posted flow is tested through
 *    [PeraPlanoNotificationListenerService.handlePosted], which takes the
 *    buffer `File` and the [CapturePrefs] explicitly. THE BUFFER FILE IS THE
 *    OBSERVATION SEAM: [CaptureBuffer] is a Kotlin `object` with no injectable
 *    instance, so there is nothing to mock -- and nothing worth mocking. Every
 *    assertion below reads the real sealed NDJSON the real [CaptureBuffer]
 *    really wrote, which is the only thing a restarted process would actually
 *    find. A recorded "append() was called" would still pass if the write
 *    never reached disk.
 *
 * One test (`onNotificationPosted appends to the buffer...`) deliberately goes
 * through a REAL service instance and the REAL production buffer path
 * ([CaptureBuffer.fileFor]), because the seam-level tests by construction
 * cannot catch an `onNotificationPosted` override that was never wired to the
 * flow at all.
 *
 * [KeyStoreBridge.vault] is swapped for a [FakeKeyVault] exactly like
 * `CaptureBufferTest` -- `CaptureBuffer.append` seals every record under the
 * capture public key, so without it nothing can be appended at all.
 *
 * Every notification string below is ILLUSTRATIVE: invented sample copy in the
 * shape of a PH e-wallet alert, never a real message.
 */
// sdk 34, matching every other Robolectric suite in this module (see
// CaptureEnvelopeTest's doc for why: this module's real compileSdk 36 needs
// Java 21, and this project's toolchain is Java 17).
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class PeraPlanoNotificationListenerServiceTest {

  // ILLUSTRATIVE package names -- real PH e-wallet package ids used only as
  // opaque allowlist strings; nothing here needs them to exist on the device.
  private val gcash = "com.globe.gcash.android"
  private val maya = "com.paymaya"

  // Epoch milliseconds, interface contract §1. postedAt and capturedAt are
  // deliberately DIFFERENT values everywhere in this file: identical fixtures
  // would let an implementation that conflates sbn.postTime with "now" pass.
  private val postedAt = 1754060400000L
  private val capturedAt = 1754060400777L

  // Four distinct values, one per extra. Same-valued fixtures would let a
  // swapped title/text (or subText/bigText) sail straight through.
  private val sampleTitle = "GCash"                                   // ILLUSTRATIVE
  private val sampleText = "You received PHP 1,500.00 from JUAN D."   // ILLUSTRATIVE
  private val sampleSubText = "Main wallet"                           // ILLUSTRATIVE
  private val sampleBigText = "Ref. no. 0091 2837 4655 -- balance PHP 3,240.10" // ILLUSTRATIVE

  private lateinit var context: Context
  private lateinit var prefs: CapturePrefs
  private lateinit var bufferFile: File

  /** Everything liveSink saw, in the order it saw it. */
  private val sinkRecords = mutableListOf<CaptureRecord>()

  /**
   * What was ALREADY durably on disk at the instant liveSink ran -- the whole
   * point of the ordering test. Recorded from inside the sink, never after.
   */
  private val bufferSeenFromInsideSink = mutableListOf<List<String>>()

  /** [CapturePrefs.lastCaptureAt] as seen from inside the sink. */
  private val lastCaptureSeenFromInsideSink = mutableListOf<Long?>()

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
    prefs = CapturePrefs(context)

    val dir = Files.createTempDirectory("listener_service_test").toFile()
    bufferFile = File(dir, CaptureBuffer.FILE_NAME)

    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensureCaptureKeyPair()
    // CapturePrefs seals the provider filter and the capture timestamp under
    // the prefs KEK (provider-selection plan Task 2), so handlePosted cannot
    // read the filter or record a capture without one. That production
    // creates this key itself -- in `onListenerConnected`, on a device where
    // the app has never been opened -- is asserted below against a VIRGIN
    // vault, deliberately not by this line.
    KeyStoreBridge.ensurePrefsKek()

    sinkRecords.clear()
    bufferSeenFromInsideSink.clear()
    lastCaptureSeenFromInsideSink.clear()
    PeraPlanoNotificationListenerService.liveSink = null
  }

  @After
  fun tearDown() {
    // Both of these are process-global singletons: a fake or a stale sink left
    // installed would silently defang whichever test file runs next.
    PeraPlanoNotificationListenerService.liveSink = null
    KeyStoreBridge.vault = AndroidKeyVault
  }

  // =====================================================================
  // extractCapture -- pure, no Service required (plan rule 1).
  // =====================================================================

  @Test
  fun `extractCapture pulls package, title, text and postTime into a CaptureRecord`() {
    val sbn = statusBarNotification(
      packageName = gcash,
      notification = notification(
        title = sampleTitle,
        text = sampleText,
        subText = sampleSubText,
        bigText = sampleBigText,
      ),
    )

    val record = PeraPlanoNotificationListenerService.extractCapture(sbn, capturedAt)

    assertNotNull(record)
    requireNotNull(record)
    assertEquals(gcash, record.packageName)
    // Four distinct values asserted against four distinct fields -- this is
    // what makes a cross-wired title/text or subText/bigText fail here.
    assertEquals(sampleTitle, record.title)
    assertEquals(sampleText, record.text)
    assertEquals(sampleSubText, record.subText)
    assertEquals(sampleBigText, record.bigText)
    // postedAt is the notification's own postTime; capturedAt is now. Two
    // different facts, two different fields -- conflating them would make
    // every buffered capture look like it arrived the moment it was drained.
    assertEquals(postedAt, record.postedAt)
    assertEquals(capturedAt, record.capturedAt)
    assertNotEquals(record.postedAt, record.capturedAt)

    // Interface contract §1: ids are client-generated UUIDv4 strings.
    assertEquals(4, UUID.fromString(record.id).version())
    val second = PeraPlanoNotificationListenerService.extractCapture(sbn, capturedAt)
    assertNotEquals("each capture needs its own id", record.id, second?.id)
  }

  @Test
  fun `extractCapture reads bigText and subText when present`() {
    // No EXTRA_TITLE/EXTRA_TEXT at all: an implementation that only reads
    // those two returns null here instead of a record, and one that reads
    // them but forgets subText/bigText returns a record with both null.
    val sbn = statusBarNotification(
      packageName = maya,
      notification = notification(subText = sampleSubText, bigText = sampleBigText),
    )

    val record = PeraPlanoNotificationListenerService.extractCapture(sbn, capturedAt)

    requireNotNull(record)
    assertEquals(sampleSubText, record.subText)
    assertEquals(sampleBigText, record.bigText)
    assertNull(record.title)
    assertNull(record.text)
  }

  @Test
  fun `extractCapture returns null when every text field is blank`() {
    // Shape 1: the extras are genuinely absent.
    val absent = statusBarNotification(packageName = gcash, notification = notification())
    assertNull(PeraPlanoNotificationListenerService.extractCapture(absent, capturedAt))

    // Shape 2: every extra is PRESENT but whitespace-only. Plan rule 2 says
    // "null or blank" -- a null-only check passes shape 1 and must fail here.
    val blank = statusBarNotification(
      packageName = gcash,
      notification = notification(title = "   ", text = "\t", subText = " ", bigText = "\n  "),
    )
    assertNull(PeraPlanoNotificationListenerService.extractCapture(blank, capturedAt))

    // ...and the mirror image: ONE non-blank field is still a capture. An
    // over-eager "any blank field drops the notification" would fail here,
    // and real e-wallet alerts routinely carry only two of the four.
    val partial = statusBarNotification(
      packageName = gcash,
      notification = notification(title = "  ", text = sampleText, subText = "", bigText = "   "),
    )
    val record = PeraPlanoNotificationListenerService.extractCapture(partial, capturedAt)
    requireNotNull(record)
    assertEquals(sampleText, record.text)
    // Blank normalizes to null so downstream parsers have exactly one
    // "nothing here" shape (contract §4: every string field is `string | null`).
    assertNull(record.title)
    assertNull(record.subText)
    assertNull(record.bigText)
  }

  // =====================================================================
  // onNotificationPosted -- the flow. Plan rule 3.
  // =====================================================================

  @Test
  fun `onNotificationPosted appends to the buffer when shouldCapture is true`() {
    // Through the REAL override on a REAL service instance, against the REAL
    // production buffer path -- the seam-level tests below cannot catch an
    // onNotificationPosted that was never wired to the flow at all.
    val service = Robolectric.buildService(PeraPlanoNotificationListenerService::class.java).get()
    val productionBuffer = CaptureBuffer.fileFor(context)
    val sbn = statusBarNotification(
      packageName = gcash,
      notification = notification(title = sampleTitle, text = sampleText),
    )

    val before = System.currentTimeMillis()
    service.onNotificationPosted(sbn)
    val after = System.currentTimeMillis()

    val stored = CaptureBuffer.drain(productionBuffer).single()
    assertEquals(gcash, stored.packageName)
    assertEquals(sampleTitle, stored.title)
    assertEquals(sampleText, stored.text)
    assertEquals(postedAt, stored.postedAt)
    assertTrue(
      "capturedAt must be the moment of capture, not the notification's postTime",
      stored.capturedAt in before..after,
    )
    // Plan rule 3's recordCapture step, which feeds getListenerHealth.
    assertEquals(postedAt, prefs.lastCaptureAt())
  }

  @Test
  fun `onNotificationPosted appends nothing when capture is disabled`() {
    prefs.setCaptureEnabled(false)
    recordSink()

    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))

    assertEquals(emptyList<String>(), bufferedIds())
    assertNull(prefs.lastCaptureAt())
    // A sink that fires on a dropped notification hands JS exactly the text
    // the user switched capture off to avoid.
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)
  }

  @Test
  fun `onNotificationPosted appends nothing for a package outside a non-empty filter`() {
    // Capture stays ENABLED here -- that is what makes this test distinct
    // from the one above. A service that consults only isCaptureEnabled()
    // passes that one and must fail this one.
    prefs.setProviderFilter(setOf(maya))
    recordSink()

    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))

    assertTrue(prefs.isCaptureEnabled())
    assertEquals(emptyList<String>(), bufferedIds())
    assertNull(prefs.lastCaptureAt())
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)

    // ...and the allowlisted package in the same filter still gets through,
    // so this cannot be passed by a service that simply drops everything.
    post(statusBarNotification(maya, notification(title = sampleTitle, text = sampleText)))
    assertEquals(1, bufferedIds().size)
    assertEquals(1, sinkRecords.size)
  }

  @Test
  fun `onNotificationPosted skips ongoing notifications`() {
    recordSink()

    // A persistent "app is running" / "download in progress" notification.
    // Never a transaction, and it re-posts constantly -- capturing it would
    // flood the bounded buffer and evict real captures.
    post(
      statusBarNotification(
        gcash,
        notification(title = sampleTitle, text = sampleText, ongoing = true),
      ),
    )

    assertEquals(emptyList<String>(), bufferedIds())
    assertNull(prefs.lastCaptureAt())
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)

    // The identical notification without the ongoing flag IS captured, which
    // rules out "this test passes because nothing is ever captured".
    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))
    assertEquals(1, bufferedIds().size)
  }

  @Test
  fun `onNotificationPosted drops an all-blank notification without appending or invoking liveSink`() {
    recordSink()

    post(statusBarNotification(gcash, notification(title = "   ", text = "  ")))

    assertEquals(emptyList<String>(), bufferedIds())
    assertNull(prefs.lastCaptureAt())
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)
  }

  // ---------------------------------------------------------------------
  // Plan rule 3's ORDER, not merely its membership. Buffer first, notify
  // second: if JS dies mid-delivery the capture is already durable. A test
  // that only asserts "both happened" is satisfied by the reverse order,
  // which is the bug -- so the sink itself records what was already on disk
  // at the exact instant it ran.
  // ---------------------------------------------------------------------

  @Test
  fun `onNotificationPosted invokes liveSink after the buffer append`() {
    recordSink()

    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))

    assertEquals(1, sinkRecords.size)
    val delivered = sinkRecords.single()

    // The capture the sink was handed was ALREADY sealed on disk when the sink
    // ran -- matched by its own id, not merely by a non-zero line count. A
    // sink-first implementation observes an empty list here.
    assertEquals(
      "the capture must already be durable before liveSink is told about it",
      listOf(listOf(delivered.id)),
      bufferSeenFromInsideSink,
    )
    // recordCapture sits between the append and the sink (plan rule 3), so it
    // must have already happened too.
    assertEquals(listOf(postedAt), lastCaptureSeenFromInsideSink)

    // And what the sink got is the same record that survived on disk.
    assertEquals(listOf(delivered.id), bufferedIds())
    assertEquals(sampleText, delivered.text)
  }

  // ---------------------------------------------------------------------
  // Never throw out of the posted flow. It runs headless on a binder thread;
  // an exception escaping costs every subsequent capture, silently, with no
  // UI anywhere to report it -- the same reasoning as CapturePrefs' rule.
  // ---------------------------------------------------------------------

  @Test
  fun `onNotificationPosted never throws and never reaches liveSink when the buffer append fails`() {
    recordSink()
    // A directory where the buffer file belongs makes CaptureBuffer's read
    // throw ReadFailedException -- the same storage-layer failure trick
    // CaptureBufferTest uses, and a failure the listener cannot do anything
    // about at 3am with no user present.
    bufferFile.mkdirs()

    // Must not throw.
    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))

    // The capture never became durable, so nothing may claim it did: no sink
    // delivery, and no lastCaptureAt for the health screen to report.
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)
    assertNull(prefs.lastCaptureAt())

    // And a later notification, once storage is healthy again, still works --
    // one failure must not wedge capture for the life of the process.
    assertTrue(bufferFile.delete())
    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))
    assertEquals(1, bufferedIds().size)
    assertEquals(1, sinkRecords.size)
  }

  // =====================================================================
  // OBSERVED PACKAGES (provider-selection plan Task 3).
  //
  // Not one of the fifteen package names in `seed.json` has been checked
  // against a device or a Play listing, and a wrong one is a SILENT
  // failure -- that provider is never routed, captures nothing, logs nothing,
  // and looks to the user like their bank simply does not work. This service
  // already receives `sbn.packageName` for every notification on the device,
  // so it is the one place that can learn the real names, with NO new
  // permission (deliberately not QUERY_ALL_PACKAGES).
  // =====================================================================

  @Test
  fun `handlePosted records the observed package of a captured notification`() {
    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))

    // It really was captured -- otherwise this test would pass against a
    // service that dropped everything and recorded on the way out.
    assertEquals(1, bufferedIds().size)

    val observed = prefs.listObservedPackages().single()
    assertEquals(gcash, observed.packageName)
    assertEquals(1, observed.count)
    // The time the listener SAW it, so a package's recency reflects the
    // device's clock rather than whatever postTime the posting app claimed.
    assertEquals(capturedAt, observed.lastSeenAt)
  }

  /**
   * THE TEST THAT MATTERS IN THIS TASK, and the one a careless implementation
   * passes without.
   *
   * A package the user has NOT selected is precisely the one that must appear
   * in the picker -- that is the picker's entire job. An implementation that
   * recorded only CAPTURED notifications would surface exactly the apps the
   * user already chose, which makes the list useless for choosing anything.
   *
   * Capture stays ENABLED here: the drop is the provider filter's doing, not
   * the pause switch's, so a service that only recorded while capture was on
   * still fails.
   */
  @Test
  fun `handlePosted records the package of a notification the provider filter dropped`() {
    prefs.setProviderFilter(setOf(maya))
    recordSink()

    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))

    // Genuinely dropped -- nothing buffered, nothing delivered to JS.
    assertTrue(prefs.isCaptureEnabled())
    assertEquals(emptyList<String>(), bufferedIds())
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)

    // ...and yet the app now knows this package exists, which is the whole
    // point: an unselected bank is exactly what the picker has to offer.
    assertEquals(listOf(gcash), prefs.listObservedPackages().map { it.packageName })
  }

  @Test
  fun `handlePosted records the package of an ongoing notification it dropped`() {
    recordSink()

    // The second drop path, and the earliest return in handlePosted: a
    // persistent "app is running" tile never reaches the filter at all, so a
    // recording placed after the ongoing check misses it entirely -- and a
    // bank app's foreground-service tile can easily be the only notification
    // it ever posts before the user picks providers.
    post(
      statusBarNotification(
        gcash,
        notification(title = sampleTitle, text = sampleText, ongoing = true),
      ),
    )

    assertEquals(emptyList<String>(), bufferedIds())
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)
    assertEquals(listOf(gcash), prefs.listObservedPackages().map { it.packageName })
  }

  /**
   * THE WRITE-FREQUENCY TEST, and the one the recording-on-every-delivery
   * implementation fails.
   *
   * The tile above is not posted once. A media player, a download and a
   * navigation session each re-post the SAME ongoing notification roughly
   * once a second for as long as they run, and every one of those arrivals
   * reaches `handlePosted` on the binder thread. Recording each one charged a
   * whole-file re-seal plus an fsync -- 3.8 ms, per `CapturePrefs`' own
   * measurement -- to the capture path, indefinitely, and inflated the "seen
   * N times" ranking the picker reads until it named whichever app re-posts
   * most rather than the bank.
   */
  @Test
  fun `ten re-posts of one ongoing notification cost one write and leave the count at one`() {
    recordSink()

    val tile = statusBarNotification(
      gcash,
      notification(title = sampleTitle, text = sampleText, ongoing = true),
    )

    post(tile)
    val afterFirstSight = rawObservedPackagesBlob()
    assertNotNull("the first sighting must still be recorded, ongoing or not", afterFirstSight)

    // Nine more arrivals of the same tile, a second apart.
    for (index in 1..9) {
      post(tile, capturedAt + index * 1_000L)
    }

    // BYTE-IDENTICAL. Every seal mints a fresh random IV
    // (KeyStoreBridge.sealPrefsValue), so a re-seal could not reproduce the
    // same string even for identical plaintext -- an unchanged blob is proof
    // no commit happened, which a "the value is still the same" assertion
    // could never be.
    assertEquals(
      "a re-posting tile must not write once per arrival",
      afterFirstSight,
      rawObservedPackagesBlob(),
    )

    val observed = prefs.listObservedPackages().single()
    assertEquals(gcash, observed.packageName)
    assertEquals("the count means distinct posts, and this was one", 1, observed.count)
    assertEquals(capturedAt, observed.lastSeenAt)

    // Still the ongoing drop path throughout: nothing captured, nothing
    // delivered to JS. See the mirror rule in the service's class doc.
    assertEquals(emptyList<String>(), bufferedIds())
    assertEquals(emptyList<CaptureRecord>(), sinkRecords)
  }

  @Test
  fun `handlePosted records the package when capture is paused and when there is no text to capture`() {
    // The remaining two drop paths, so all four are covered: pause switch,
    // provider filter, ongoing, and nothing-worth-capturing. "Every
    // notification the listener sees" has no exceptions.
    prefs.setCaptureEnabled(false)

    post(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))
    post(statusBarNotification(maya, notification(title = "   ", text = "  ")))

    assertEquals(emptyList<String>(), bufferedIds())
    assertEquals(
      setOf(gcash, maya),
      prefs.listObservedPackages().map { it.packageName }.toSet(),
    )
  }

  /**
   * PACKAGE NAMES ONLY -- never a title, never body text (plan Task 3 rule 2).
   *
   * This list is sealed, so a sweep of the raw preferences file alone would
   * pass against an implementation that stored the whole notification: the
   * ciphertext hides everything equally. So the blob is OPENED here and the
   * PLAINTEXT swept, which is the only assertion that can tell the two apart.
   * Adding content would make this a shadow copy of the notification history
   * the sealed buffer exists to protect, sitting under a weaker key -- the
   * prefs KEK is deliberately not auth-bound (docs/12 §4).
   */
  @Test
  fun `the stored observed packages carry no notification title or body`() {
    post(
      statusBarNotification(
        gcash,
        notification(
          title = sampleTitle,
          text = sampleText,
          subText = sampleSubText,
          bigText = sampleBigText,
        ),
      ),
    )

    val plaintext = openObservedPackagesBlob()

    // Looking at the right blob: the package name IS in there...
    assertTrue("the observed package must be what was stored: $plaintext", plaintext.contains(gcash))
    // ...and nothing the notification said is.
    for (content in listOf(sampleTitle, sampleText, sampleSubText, sampleBigText)) {
      assertFalse("no notification content may be stored: $plaintext", plaintext.contains(content))
    }

    // And the same sweep over the raw file, which catches the other half of
    // the same mistake -- content stored unsealed under some other key.
    val onDisk = rawPrefsText()
    for (content in listOf(sampleTitle, sampleText, sampleSubText, sampleBigText, gcash)) {
      assertFalse("nothing may reach the prefs file in plaintext: $onDisk", onDisk.contains(content))
    }
  }

  /**
   * The recording is bookkeeping for a screen the user visits once. A real
   * notification arrives once and never again -- so a recording that failed
   * must cost nothing at all.
   *
   * A device with NO prefs KEK is what that failure looks like from here: the
   * seal that stores the list cannot run. If recording threw instead of
   * giving up quietly, handlePosted's catch would turn it into one silently
   * dropped capture per notification, which is the failure mode this whole
   * class is written to avoid.
   */
  @Test
  fun `a notification is still captured when the observed package cannot be recorded`() {
    KeyStoreBridge.vault = FakeKeyVault()
    // The buffer still needs its own key; the prefs KEK deliberately stays
    // absent, because that absence IS the test.
    KeyStoreBridge.ensureCaptureKeyPair()
    val prefsWithoutKey = CapturePrefs(context)
    recordSink()

    PeraPlanoNotificationListenerService.handlePosted(
      sbn = statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)),
      prefs = prefsWithoutKey,
      bufferFile = bufferFile,
      nowMillis = capturedAt,
    )

    // The capture survived -- durable on disk and delivered to JS.
    assertEquals(1, bufferedIds().size)
    assertEquals(1, sinkRecords.size)
    assertEquals(sampleText, sinkRecords.single().text)
    // ...and nothing was learned, which is the acceptable half of the trade.
    assertEquals(emptyList<ObservedPackage>(), prefsWithoutKey.listObservedPackages())
  }

  // =====================================================================
  // Connection state (plan rule 4) -- half of getListenerHealth.
  // =====================================================================

  /**
   * REGRESSION, found on a real device (docs/13-on-device-verification.md,
   * Part 3). On a fresh install where the user grants notification access
   * from Android Settings BEFORE ever opening the app, every notification was
   * silently dropped:
   *
   * ```
   * E PeraPlanoListener: dropped one notification capture: IllegalStateException
   * ```
   *
   * `CaptureBuffer.append` looks the capture public key up on every append,
   * but the keypair was only ever created by the APP (via the bridge's
   * `getCapturePublicKey`), so with the app never launched `getPublicKey`
   * threw `error("capture keypair has not been created")`. The never-throw
   * rule turned that into a dropped capture and one logcat line -- contained,
   * but the notification is gone for good.
   *
   * Every other test in this file missed it because [setUp] itself calls
   * `KeyStoreBridge.ensureCaptureKeyPair()` -- the harness was doing the very
   * thing production code had forgotten. So this test deliberately installs a
   * VIRGIN vault and never pre-creates anything: that absence is the whole
   * point, and re-adding a setup call here would silently retire the test.
   */
  @Test
  fun `a listener bound before the app has ever run creates the capture keypair itself`() {
    // A brand-new vault: no capture keypair, exactly like a fresh install
    // whose app has never been opened.
    KeyStoreBridge.vault = FakeKeyVault()

    val service = Robolectric.buildService(PeraPlanoNotificationListenerService::class.java).get()
    service.onListenerConnected()

    val sbn = statusBarNotification(
      packageName = gcash,
      notification = notification(title = sampleTitle, text = sampleText),
    )
    service.onNotificationPosted(sbn)

    // The assertion that matters: the capture is DURABLE, not merely
    // "no exception was thrown". A drop is silent by design, so anything
    // weaker than reading the record back out of the buffer would pass
    // against the very bug this test exists for.
    val stored = CaptureBuffer.drain(CaptureBuffer.fileFor(context)).single()
    assertEquals(gcash, stored.packageName)
    assertEquals(sampleText, stored.text)
  }

  /**
   * THE SAME REGRESSION, ONE KEY OVER (provider-selection plan Task 2).
   *
   * `KeyStoreBridge.ensurePrefsKek()` was added by Task 1 and called by
   * nothing. The prefs KEK is what seals the provider filter, and the filter
   * is what `handlePosted` consults on EVERY delivery -- so a listener bound
   * on a device where PeraPlano has never been opened has to create this key
   * itself, exactly as it already does for the capture keypair above. Its
   * KDoc says so in as many words, because this is the second time the shape
   * has come up.
   *
   * VIRGIN VAULT, and no other operation before the assertion: the key's
   * EXISTENCE is the claim. Sealing something first and checking it
   * round-trips would pass against an implementation that created the key
   * lazily somewhere else entirely, which is precisely the wiring this test
   * exists to pin.
   */
  @Test
  fun `a listener bound before the app has ever run creates the prefs KEK itself`() {
    KeyStoreBridge.vault = FakeKeyVault()

    val service = Robolectric.buildService(PeraPlanoNotificationListenerService::class.java).get()
    service.onListenerConnected()

    assertTrue(
      "onListenerConnected must create the prefs KEK -- the filter is unreadable without it",
      KeyStoreBridge.vault.hasAesKey(KeyStoreBridge.PREFS_KEK_ALIAS),
    )

    // ...and it is genuinely usable, so the listener can honour a filter the
    // user set on this device rather than falling back to allow-all forever.
    CapturePrefs(context).setProviderFilter(setOf(gcash))
    val reopened = CapturePrefs(context)
    assertEquals(setOf(gcash), reopened.getProviderFilter())
    assertFalse(reopened.shouldCapture(maya))
  }

  @Test
  fun `onListenerConnected and onListenerDisconnected update the recorded connection state`() {
    val service = Robolectric.buildService(PeraPlanoNotificationListenerService::class.java).get()

    // Read through a CapturePrefs the service never touched: the flag has to
    // reach shared storage, not a field on whoever wrote it.
    assertFalse(CapturePrefs(context).isListenerConnected())

    service.onListenerConnected()
    assertTrue(
      "a bound listener must be visible to the health screen",
      CapturePrefs(context).isListenerConnected(),
    )

    // BOTH directions. Writing only on connect leaves a killed service
    // permanently reported as bound -- which is exactly the failure the
    // health screen exists to surface, reported as success.
    service.onListenerDisconnected()
    assertFalse(
      "a disconnected listener must stop being reported as bound",
      CapturePrefs(context).isListenerConnected(),
    )
  }

  // =====================================================================
  // Fixtures
  // =====================================================================

  /**
   * Runs the posted flow through the explicit seam -- no Service instance.
   *
   * [nowMillis] defaults to the single fixture clock; the re-post test passes
   * its own, because the whole point there is deliveries separated in time.
   */
  private fun post(sbn: StatusBarNotification, nowMillis: Long = capturedAt) {
    PeraPlanoNotificationListenerService.handlePosted(sbn, prefs, bufferFile, nowMillis)
  }

  /**
   * Installs a liveSink that records, at the instant it runs, what is ALREADY
   * durable -- see [bufferSeenFromInsideSink].
   */
  private fun recordSink() {
    PeraPlanoNotificationListenerService.liveSink = { record ->
      sinkRecords += record
      bufferSeenFromInsideSink += bufferedIds()
      lastCaptureSeenFromInsideSink += prefs.lastCaptureAt()
    }
  }

  /**
   * Ids currently sealed in the buffer file, WITHOUT draining -- drain deletes
   * the file, which would destroy the very thing the ordering test is about to
   * assert on (and cannot be called from inside the sink at all).
   */
  private fun bufferedIds(): List<String> {
    if (!bufferFile.exists() || bufferFile.isDirectory) return emptyList()
    return bufferFile.readText()
      .split("\n")
      .filter { it.isNotEmpty() }
      .map { CaptureEnvelope.open(it).id }
  }

  /**
   * The preferences file as an attacker holding the bytes would see it --
   * every stored key and value, plus the on-disk XML when it exists. The same
   * sweep `CapturePrefsTest` makes, repeated here because this is the suite
   * where real notification TEXT enters the system.
   */
  private fun rawPrefsText(): String {
    val prefsFile = context.getSharedPreferences(CapturePrefs.PREFS_NAME, Context.MODE_PRIVATE)
    val entries = prefsFile.all.entries.joinToString("\n") { "${it.key}=${it.value}" }
    val xml = File(File(context.applicationInfo.dataDir, "shared_prefs"), "${CapturePrefs.PREFS_NAME}.xml")
    return if (xml.isFile) entries + "\n" + xml.readText() else entries
  }

  /**
   * The observed-package list DECRYPTED -- what is actually being stored,
   * rather than what a sealed blob happens to look like from outside. The key
   * name is a literal for the same reason `CapturePrefsTest` spells its keys
   * out: this is the storage format, and asking the code under test what it
   * calls its own key would rename in lockstep and stop testing anything.
   */
  private fun openObservedPackagesBlob(): String {
    val blob = rawObservedPackagesBlob()
    assertNotNull("nothing was stored for the observed packages at all", blob)
    return String(KeyStoreBridge.openPrefsValue(requireNotNull(blob)), Charsets.UTF_8)
  }

  /**
   * The sealed observed-package string exactly as it sits on disk, or `null`
   * if nothing has been stored. Compared across deliveries it answers "did a
   * write happen?" rather than "what is the value?" -- see the re-post test
   * for why those are different questions here.
   */
  private fun rawObservedPackagesBlob(): String? = context
    .getSharedPreferences(CapturePrefs.PREFS_NAME, Context.MODE_PRIVATE)
    .getString("observed_packages_sealed", null)

  private fun notification(
    title: CharSequence? = null,
    text: CharSequence? = null,
    subText: CharSequence? = null,
    bigText: CharSequence? = null,
    ongoing: Boolean = false,
  ): Notification {
    val builder = Notification.Builder(context, "peraplano_test_channel")
    if (title != null) builder.setContentTitle(title)
    if (text != null) builder.setContentText(text)
    if (subText != null) builder.setSubText(subText)
    if (bigText != null) builder.setStyle(Notification.BigTextStyle().bigText(bigText))
    builder.setOngoing(ongoing)
    return builder.build()
  }

  @Suppress("DEPRECATION") // the only StatusBarNotification constructor apps can call
  // =====================================================================
  // THE SHADE AT BIND TIME (GAP-125).
  //
  // The observed list is written only by onNotificationPosted, so it was
  // EMPTY at the instant the user granted notification access and filled only
  // from what posted afterwards. The onboarding provider picker runs seconds
  // later and its whole subject is "apps we've seen", so it had nothing to
  // show on a fresh install. recordObservedFrom is the catch-up.
  //
  // Tested through the pure companion function rather than through a bound
  // service, for the reason the class doc gives about handlePosted:
  // `activeNotifications` belongs to a bound NotificationListenerService, and
  // a test that had to bind one could only assert that binding works. The
  // wiring itself is covered by the real-service test at the end.
  // =====================================================================

  @Test
  fun `recordObservedFrom records every package already sitting in the shade`() {
    val active = arrayOf(
      statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)),
      statusBarNotification(maya, notification(title = sampleTitle, text = sampleText)),
    )

    PeraPlanoNotificationListenerService.recordObservedFrom(active, prefs, capturedAt)

    assertEquals(
      setOf(gcash, maya),
      prefs.listObservedPackages().map { it.packageName }.toSet(),
    )
  }

  @Test
  fun `a snapshot is stamped with the post time, not with the moment of the bind`() {
    // A notification posted three hours ago is not a sighting that just
    // happened. Stamping it "now" would sort it above genuinely recent posts
    // and reorder the picker on a lie -- and the list is capped, so the
    // ordering decides what survives.
    val active = arrayOf(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)))

    PeraPlanoNotificationListenerService.recordObservedFrom(active, prefs, capturedAt)

    val observed = prefs.listObservedPackages().single()
    assertEquals(postedAt, observed.lastSeenAt)
    assertNotEquals(capturedAt, observed.lastSeenAt)
    assertEquals(1, observed.count)
  }

  // =====================================================================
  // THE GAP AN OEM KILL LEAVES (GAP-050).
  //
  // docs/03 principle 5: what is still on screen when the listener rebinds is
  // the one partial recovery available for a kill, and nothing read it. The
  // shade was enumerated for PACKAGE NAMES only (GAP-125 above); the captures
  // themselves were never taken.
  //
  // BOUNDED BY THE LAST CAPTURE, and that bound is the whole design. Feeding
  // the entire shade through on every bind would re-capture whatever is still
  // sitting there from yesterday, hours past the replay window that would
  // otherwise recognise it, and a re-captured bank notification becomes a
  // SECOND transaction. Everything posted after the last capture is exactly
  // the gap, and nothing older can be new.
  // =====================================================================

  @Test
  fun `the shade is captured on a rebind, but only what posted after the last capture`() {
    prefs.recordCapture(postedAt - 60_000)
    val active = arrayOf(
      // Already captured before the listener died, and still on screen.
      statusBarNotification(
        gcash,
        notification(title = sampleTitle, text = sampleText),
        postTime = postedAt - 120_000,
      ),
      // Arrived while nothing was listening: this is the one to recover.
      statusBarNotification(
        maya,
        notification(title = sampleTitle, text = sampleText),
        postTime = postedAt,
      ),
    )

    PeraPlanoNotificationListenerService.captureActiveSince(active, prefs, bufferFile, capturedAt)

    assertEquals(listOf(maya), CaptureBuffer.drain(bufferFile).map { it.packageName })
  }

  @Test
  fun `a device that has never captured anything takes nothing from the shade`() {
    // No floor means no gap to recover: a fresh install has no idea which of
    // these the user has already dealt with, and the live path takes
    // everything posted from here on. Capturing the whole shade on the first
    // bind would hand the Review Queue a pile of history nobody asked for.
    val active = arrayOf(
      statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText)),
    )

    PeraPlanoNotificationListenerService.captureActiveSince(active, prefs, bufferFile, capturedAt)

    assertEquals(0, CaptureBuffer.size(bufferFile))
  }

  @Test
  fun `a package already observed is neither re-counted nor re-stamped`() {
    // THE TEST THAT RULES OUT A LOOP OVER recordObservedPackage, which is the
    // obvious implementation and the wrong one: it INCREMENTS count on every
    // call, so every rebind would inflate the count of everything already
    // known -- and count is exactly the signal the picker uses to separate a
    // bank the user actually uses from a one-off.
    prefs.recordObservedPackage(gcash, capturedAt)
    val before = prefs.listObservedPackages().single()

    PeraPlanoNotificationListenerService.recordObservedFrom(
      arrayOf(statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText))),
      prefs,
      capturedAt + 1,
    )

    val after = prefs.listObservedPackages().single()
    assertEquals(before.count, after.count)
    assertEquals(before.lastSeenAt, after.lastSeenAt)
  }

  @Test
  fun `the latest post wins when one package is in the shade twice`() {
    val active = arrayOf(
      statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText), postTime = postedAt),
      statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText), postTime = postedAt + 900),
    )

    PeraPlanoNotificationListenerService.recordObservedFrom(active, prefs, capturedAt)

    assertEquals(postedAt + 900, prefs.listObservedPackages().single().lastSeenAt)
  }

  @Test
  fun `a post time of zero is recorded as seen now rather than sorted to the bottom`() {
    // Not a real instant. Letting it through would make that package the
    // first thing dropped at the cap, which silently loses an app the picker
    // exists to offer.
    val active = arrayOf(
      statusBarNotification(gcash, notification(title = sampleTitle, text = sampleText), postTime = 0L),
    )

    PeraPlanoNotificationListenerService.recordObservedFrom(active, prefs, capturedAt)

    assertEquals(capturedAt, prefs.listObservedPackages().single().lastSeenAt)
  }

  @Test
  fun `an empty shade records nothing, and neither does a missing one`() {
    PeraPlanoNotificationListenerService.recordObservedFrom(emptyArray(), prefs, capturedAt)
    assertEquals(emptyList<ObservedPackage>(), prefs.listObservedPackages())

    PeraPlanoNotificationListenerService.recordObservedFrom(null, prefs, capturedAt)
    assertEquals(emptyList<ObservedPackage>(), prefs.listObservedPackages())
  }

  @Test
  fun `onListenerConnected still reports the binding when the shade cannot be read`() {
    // Through a REAL service instance, because the seam tests above cannot
    // catch a recordActiveNotifications that was never wired into the
    // callback -- the same gap the posted flow has its own real-service test
    // for.
    //
    // Robolectric binds no NotificationManager, so `activeNotifications`
    // either throws or answers with nothing; this asserts the outcome that
    // must hold either way. Reporting the binding is plan rule 4 and the
    // health screen reads it, so a snapshot that failed must never be able to
    // take that down with it.
    val service = Robolectric.buildService(PeraPlanoNotificationListenerService::class.java).get()

    service.onListenerConnected()

    assertTrue(prefs.isListenerConnected())
  }

  private fun statusBarNotification(
    packageName: String,
    notification: Notification,
    postTime: Long = postedAt,
  ): StatusBarNotification = StatusBarNotification(
    packageName,
    packageName,
    /* id = */ 42,
    /* tag = */ null,
    /* uid = */ 10042,
    /* initialPid = */ 0,
    /* score = */ 0,
    notification,
    Process.myUserHandle(),
    postTime,
  )
}
