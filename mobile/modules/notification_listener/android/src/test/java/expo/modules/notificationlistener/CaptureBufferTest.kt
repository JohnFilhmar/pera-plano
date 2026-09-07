package expo.modules.notificationlistener

import android.security.keystore.UserNotAuthenticatedException
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * CaptureBuffer is what makes captures survive Android killing the JS
 * process while the notification-listener service keeps running headless.
 * These tests never reuse in-memory state to prove a property -- every
 * assertion about persistence goes back through a `File`, because that is
 * the only thing a real process relaunch actually has.
 *
 * Runs under Robolectric for `android.util.Base64`/`Log` (see
 * CaptureEnvelopeTest's doc for why); [KeyStoreBridge.vault] is swapped for
 * a [FakeKeyVault] exactly like Task 2's KeyStoreBridgeTest so every seal/
 * open here exercises the real crypto against a plain-JCE in-memory key
 * instead of the real (untestable-off-device) Android Keystore.
 */
// See CaptureEnvelopeTest's doc on the same annotation for why 34, not the
// module's compileSdk 36.
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class CaptureBufferTest {

  private lateinit var file: File
  private lateinit var fakeVault: FakeKeyVault

  @Before
  fun setUp() {
    val dir = Files.createTempDirectory("capture_buffer_test").toFile()
    file = File(dir, CaptureBuffer.FILE_NAME)

    fakeVault = FakeKeyVault()
    KeyStoreBridge.vault = fakeVault
    KeyStoreBridge.ensureCaptureKeyPair()
  }

  @After
  fun tearDown() {
    // Defensive, same reasoning as KeyStoreBridgeTest: KeyStoreBridge.vault
    // is process-global, so leaving a fake installed would silently defang
    // any test file that assumes the real AndroidKeyVault is in place.
    KeyStoreBridge.vault = AndroidKeyVault
  }

  private fun record(n: Int) = CaptureRecord(
    id = "id-$n",
    packageName = "com.globe.gcash.android",
    title = "GCash",
    text = "You have sent PHP $n.00",
    subText = null,
    bigText = null,
    postedAt = 1754060400000L + n,
    capturedAt = 1754060400500L + n,
  )

  // ---------------------------------------------------------------------
  // append / size
  // ---------------------------------------------------------------------

  @Test
  fun `append returns the pending count`() {
    assertEquals(1, CaptureBuffer.append(file, record(1)))
    assertEquals(2, CaptureBuffer.append(file, record(2)))
  }

  // ---------------------------------------------------------------------
  // Bounded really means bounded -- eviction order, not just eviction.
  // ---------------------------------------------------------------------

  @Test
  fun `the buffer is capped and evicts the oldest capture first`() {
    repeat(CaptureBuffer.MAX_CAPTURES + 5) { i -> CaptureBuffer.append(file, record(i)) }

    val drained = CaptureBuffer.drain(file)

    assertEquals(CaptureBuffer.MAX_CAPTURES, drained.size)
    // ids 0..4 must be gone; id-5 is the oldest survivor. An implementation
    // that evicted the NEWEST instead would leave id-0 first and id-499
    // last here instead.
    assertEquals("id-5", drained.first().id)
    assertEquals("id-${CaptureBuffer.MAX_CAPTURES + 4}", drained.last().id)
  }

  @Test
  fun `appending exactly MAX_CAPTURES records evicts nothing`() {
    repeat(CaptureBuffer.MAX_CAPTURES) { i -> CaptureBuffer.append(file, record(i)) }

    assertEquals(CaptureBuffer.MAX_CAPTURES, CaptureBuffer.size(file))

    val drained = CaptureBuffer.drain(file)
    assertEquals("id-0", drained.first().id)
    assertEquals("id-${CaptureBuffer.MAX_CAPTURES - 1}", drained.last().id)
  }

  @Test
  fun `the MAX_CAPTURES plus one-th append evicts exactly the oldest record`() {
    repeat(CaptureBuffer.MAX_CAPTURES) { i -> CaptureBuffer.append(file, record(i)) }

    val countAfterOverflow = CaptureBuffer.append(file, record(CaptureBuffer.MAX_CAPTURES))

    assertEquals(CaptureBuffer.MAX_CAPTURES, countAfterOverflow)
    val drained = CaptureBuffer.drain(file)
    assertEquals(CaptureBuffer.MAX_CAPTURES, drained.size)
    assertEquals("id-1", drained.first().id) // id-0 is the one that got evicted
    assertEquals("id-${CaptureBuffer.MAX_CAPTURES}", drained.last().id)
  }

  // ---------------------------------------------------------------------
  // Survives process death -- prove it via a *new* File handle on the same
  // path, never the one `append` was called through.
  // ---------------------------------------------------------------------

  @Test
  fun `a capture appended through one File handle is readable through a brand new File instance on the same path`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.append(file, record(2))

    val reopened = File(file.absolutePath)
    val drained = CaptureBuffer.drain(reopened)

    assertEquals(listOf("id-1", "id-2"), drained.map { it.id })
  }

  @Test
  fun `null text fields survive the disk round trip`() {
    CaptureBuffer.append(file, record(7))

    val restored = CaptureBuffer.drain(file).single()

    assertNull(restored.subText)
    assertNull(restored.bigText)
    assertEquals("GCash", restored.title)
    assertEquals(1754060400007L, restored.postedAt)
  }

  @Test
  fun `capture text containing raw newlines does not fragment the line-delimited format, and round-trips exactly`() {
    val hostile = record(9).copy(
      text = "You have sent PHP 1,000.00\nRef: 123]},{\"id\":\"evil\"}",
      bigText = "line one\nline two\r\nline three",
      subText = "has\ttab and \"quotes\"",
    )

    CaptureBuffer.append(file, hostile)

    // The hostile record's own embedded newlines must not have fragmented
    // the on-disk format into extra "lines" -- there is exactly one sealed
    // line on disk for the one capture appended, despite `text`/`bigText`
    // containing several raw newline characters. This holds because the
    // sealed payload is base64 (no newline in its alphabet) of an encrypted
    // blob -- the plaintext newlines are inside the ciphertext, never on
    // disk as literal bytes.
    val onDiskLines = file.readText().split("\n").filter { it.isNotEmpty() }
    assertEquals("one hostile capture must produce exactly one line on disk", 1, onDiskLines.size)

    val restored = CaptureBuffer.drain(file).single()
    assertEquals(hostile.text, restored.text)
    assertEquals(hostile.bigText, restored.bigText)
    assertEquals(hostile.subText, restored.subText)
  }

  // ---------------------------------------------------------------------
  // Drain is atomic: everything comes back once, the file backing it is
  // left empty/gone, and a second drain proves there is nothing left.
  // ---------------------------------------------------------------------

  @Test
  fun `drain returns appended records oldest first and clears the buffer`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.append(file, record(2))
    CaptureBuffer.append(file, record(3))

    val drained = CaptureBuffer.drain(file)

    assertEquals(listOf("id-1", "id-2", "id-3"), drained.map { it.id })
    assertEquals(0, CaptureBuffer.size(file))
    // Not just "size() says zero" -- the file backing it must actually be
    // empty or gone, not merely reporting an empty logical view over stale
    // bytes.
    assertTrue("file must be removed or empty after drain", !file.exists() || file.readText().isBlank())
    assertTrue(CaptureBuffer.drain(file).isEmpty())
  }

  @Test
  fun `draining a buffer that was never written returns empty`() {
    assertFalse(file.exists())
    assertTrue(CaptureBuffer.drain(file).isEmpty())
    assertEquals(0, CaptureBuffer.size(file))
  }

  @Test
  fun `concurrent appends from multiple threads do not lose records to a race`() {
    val perThread = 10
    val threadCount = 20
    val threads = (0 until threadCount).map { t ->
      Thread {
        repeat(perThread) { i -> CaptureBuffer.append(file, record(t * 1000 + i)) }
      }
    }

    threads.forEach { it.start() }
    threads.forEach { it.join() }

    // Every append is a read-modify-write of the whole file; without the
    // synchronized block two threads can interleave and one appender's
    // write clobbers another's, silently losing captures.
    assertEquals(threadCount * perThread, CaptureBuffer.size(file))
  }

  // ---------------------------------------------------------------------
  // A corrupt or partially-written buffer cannot take the whole thing down.
  // ---------------------------------------------------------------------

  @Test
  fun `a corrupt buffer file is discarded instead of wedging capture forever`() {
    file.writeText("this is not a valid sealed line at all")

    assertTrue(CaptureBuffer.drain(file).isEmpty())

    CaptureBuffer.append(file, record(1))
    assertEquals(listOf("id-1"), CaptureBuffer.drain(file).map { it.id })
  }

  @Test
  fun `a truncated final line costs only that record -- every earlier line still opens`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.append(file, record(2))

    val goodLines = file.readText().split("\n").filter { it.isNotEmpty() }
    assertEquals(2, goodLines.size)

    // The realistic shape of a process kill mid-write of the newest line:
    // the first line is complete, the second is cut far short of even a
    // valid length header -- no trailing newline at all, exactly what a
    // kill mid-append would leave behind.
    val truncated = goodLines[0] + "\n" + goodLines[1].take(10)
    file.writeText(truncated)

    val drained = CaptureBuffer.drain(file)

    assertEquals(listOf("id-1"), drained.map { it.id })
    assertFalse("file must be cleared after drain even though one line was unrecoverable", file.exists())

    // And capture keeps working afterward -- one bad line must not wedge
    // the buffer forever.
    CaptureBuffer.append(file, record(3))
    assertEquals(listOf("id-3"), CaptureBuffer.drain(file).map { it.id })
  }

  @Test
  fun `a corrupt line between two good ones is skipped with neighbours intact`() {
    val publicKey = KeyStoreBridge.capturePublicKeySpki()
    val line1 = CaptureEnvelope.seal(record(1), publicKey)
    val line2 = CaptureEnvelope.seal(record(2), publicKey)
    file.writeText(listOf(line1, "not-a-valid-sealed-line", line2).joinToString("\n") + "\n")

    val drained = CaptureBuffer.drain(file)

    assertEquals(listOf("id-1", "id-2"), drained.map { it.id })
  }

  // ---------------------------------------------------------------------
  // A read failure is not the same thing as an empty buffer. Conflating
  // them would mean a transient storage hiccup -- not a parseable-but-wrong
  // content problem, an outright inability to read the file at all -- makes
  // drain() delete a file it never looked inside, permanently losing
  // everything pending.
  // ---------------------------------------------------------------------

  @Test
  fun `a read failure opening the pending-capture file is not treated as an empty buffer`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.append(file, record(2))
    assertEquals(2, CaptureBuffer.size(file))

    // Preserve the real, valid bytes CaptureBuffer wrote, then put an
    // unreadable placeholder in their exact place: a directory reliably
    // makes File.readText() throw on every platform (opening a directory as
    // a file always fails), without touching CaptureBuffer's own
    // corruption-handling machinery (base64/crypto) at all -- this is a
    // storage-layer failure, not a content problem.
    val backup = File("${file.absolutePath}.backup")
    Files.move(file.toPath(), backup.toPath())
    file.mkdirs()

    assertThrows(CaptureBuffer.ReadFailedException::class.java) {
      CaptureBuffer.drain(file)
    }
    assertThrows(CaptureBuffer.ReadFailedException::class.java) {
      CaptureBuffer.size(file)
    }
    assertThrows(CaptureBuffer.ReadFailedException::class.java) {
      CaptureBuffer.append(file, record(3))
    }

    // None of the three attempts above may have deleted or overwritten the
    // unreadable placeholder -- proving each one bailed out before ever
    // reaching a write or a delete.
    assertTrue("a failed read must never delete the file it couldn't read", file.exists())
    assertTrue(file.isDirectory)

    // Restore the real bytes and confirm the whole episode cost nothing --
    // the original two captures are still exactly there.
    file.delete()
    Files.move(backup.toPath(), file.toPath())

    assertEquals(2, CaptureBuffer.size(file))
    assertEquals(listOf("id-1", "id-2"), CaptureBuffer.drain(file).map { it.id })
  }

  // ---------------------------------------------------------------------
  // clear() -- the §11a wipe-and-start-over primitive (task-9a-brief).
  // Discriminates against an implementation that forgets the idempotence
  // requirement (throws on a missing file) as much as one that forgets to
  // delete anything at all.
  // ---------------------------------------------------------------------

  @Test
  fun `clear removes a buffer with records in it`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.append(file, record(2))
    assertTrue(file.exists())

    CaptureBuffer.clear(file)

    assertFalse("the file must be gone, not merely emptied", file.exists())
    assertEquals(0, CaptureBuffer.size(file))
  }

  @Test
  fun `clear succeeds cleanly when the file was never written -- a wipe with nothing pending must not throw`() {
    assertFalse(file.exists())

    CaptureBuffer.clear(file) // must not throw

    assertFalse(file.exists())
  }

  @Test
  fun `clear is idempotent -- a second call on an already-cleared buffer does not throw`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.clear(file)

    CaptureBuffer.clear(file) // must not throw
  }

  @Test
  fun `clear also removes the atomic-write tmp sibling, not just the main file`() {
    CaptureBuffer.append(file, record(1))
    val temp = File("${file.absolutePath}.tmp")
    // Simulate a process killed between writeLines' temp write and its
    // atomic move -- the realistic shape of a leftover .tmp file, holding
    // the exact same category of sealed-line content as the main file.
    temp.writeText("leftover-sealed-content-from-a-killed-write")
    assertTrue(temp.exists())

    CaptureBuffer.clear(file)

    assertFalse("the buffer must not leave sealed content behind in its .tmp sibling", temp.exists())
  }

  @Test
  fun `capture keeps working after a clear -- append starts a fresh buffer rather than staying wedged`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.clear(file)

    CaptureBuffer.append(file, record(2))

    assertEquals(listOf("id-2"), CaptureBuffer.drain(file).map { it.id })
  }

  // ---------------------------------------------------------------------
  // The property the whole design rests on (docs §6): the listener must be
  // able to keep writing while the app is locked, and a drain attempted too
  // early must never be indistinguishable from "every buffered capture is
  // corrupt" -- that would silently and permanently destroy recoverable
  // data the very first time drain runs a moment too soon.
  // ---------------------------------------------------------------------

  @Test
  fun `append and size never touch the private key -- the buffer keeps accepting captures while the app stays locked`() {
    KeyStoreBridge.vault = LockedPrivateKeyVault(fakeVault)

    CaptureBuffer.append(file, record(1))
    CaptureBuffer.append(file, record(2))

    assertEquals(2, CaptureBuffer.size(file))

    // drain(), which DOES need the private key, must throw rather than
    // quietly returning an empty list -- and the file must survive that
    // failed attempt untouched, so the same drain can be retried once the
    // caller has actually authenticated.
    assertThrows(UserNotAuthenticatedException::class.java) {
      CaptureBuffer.drain(file)
    }
    assertTrue("a drain that aborts on a locked key must not touch the file", file.exists())
    assertEquals(2, CaptureBuffer.size(file))
  }

  // ---------------------------------------------------------------------
  // A PERMANENTLY INVALIDATED capture private key -- the state removing the
  // device screen lock leaves behind (docs §5).
  //
  // READ THIS BEFORE "FIXING" THE TEST BELOW. It asserts what this code does
  // TODAY, and what it does today is lose the buffer. It is a defect record,
  // not a guarantee: GAP-059 is the entry that changes this behaviour, and
  // when it lands this test MUST go red and be rewritten to assert the new
  // contract (drain rethrows, the file survives, JS decides whether to
  // clear). Do not weaken it to keep the suite green; a red test here is the
  // fix landing correctly.
  //
  // Why it is pinned rather than left unwritten: openAll's `catch (error:
  // Exception)` swallows KeyPermanentlyInvalidatedException (it extends
  // InvalidKeyException) into the per-line skip-and-count path, and drain
  // then deletes the file -- so a device whose key died silently discards
  // every buffered capture and resolves `[]`. Nothing in this suite noticed,
  // because nothing in this suite had ever produced a dead key.
  // ---------------------------------------------------------------------

  @Test
  fun `a dead capture key currently costs the whole buffer and resolves empty -- pinned until GAP-059`() {
    CaptureBuffer.append(file, record(1))
    CaptureBuffer.append(file, record(2))
    assertEquals(2, CaptureBuffer.size(file))

    // The public half still works -- an invalidated alias is not a missing
    // one -- so the listener would happily keep appending here too.
    KeyStoreBridge.vault = InvalidatedPrivateKeyVault(fakeVault)
    assertEquals(3, CaptureBuffer.append(file, record(3)))

    val drained = CaptureBuffer.drain(file)

    // DEFECT, PINNED. Every one of the three is unrecoverable ciphertext and
    // is reported as though the buffer had been empty all along.
    assertTrue(
      "GAP-059: a dead key is swallowed as a per-line skip, so drain resolves empty",
      drained.isEmpty(),
    )
    assertFalse(
      "GAP-059: and the file is deleted afterwards, so the captures are gone for good",
      file.exists(),
    )

    // NOT the auth case, and that distinction is the load-bearing half of
    // this test. UserNotAuthenticatedException aborts the drain with the
    // file intact (the test above); this exception is a sibling of it in the
    // same Keystore family and gets the opposite treatment. If a future
    // change accidentally routed the two together, one of these two tests
    // fails whichever way it went.
    assertEquals(0, CaptureBuffer.size(file))
  }
}
