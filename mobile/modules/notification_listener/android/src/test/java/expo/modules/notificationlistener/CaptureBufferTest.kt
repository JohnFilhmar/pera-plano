package expo.modules.notificationlistener

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * CaptureBuffer is what makes captures survive Android killing the JS
 * process while the notification-listener service keeps running headless.
 * These tests never reuse in-memory state to prove a property -- every
 * assertion about persistence goes back through a `File`, because that is
 * the only thing a real process relaunch actually has.
 */
class CaptureBufferTest {

  private lateinit var file: File

  @Before
  fun setUp() {
    val dir = Files.createTempDirectory("capture_buffer_test").toFile()
    file = File(dir, CaptureBuffer.FILE_NAME)
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
    // ids 0..4 must be gone; id-5 is the oldest survivor. A implementation
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
  fun `capture text containing raw newlines and array-breaking characters round-trips through the file untouched`() {
    val hostile = record(9).copy(
      text = "You have sent PHP 1,000.00\nRef: 123]},{\"id\":\"evil\"}",
      bigText = "line one\nline two\r\nline three",
      subText = "has\ttab and \"quotes\"",
    )

    CaptureBuffer.append(file, hostile)

    // The hostile content must be JSON-escaped on disk, not embedded as a
    // literal control character that could confuse a naive parser or split
    // the file into what looks like extra records.
    val raw = file.readText()
    assertFalse("raw file must not contain a literal newline", raw.contains("\n"))

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
    file.writeText("{not json at all")

    assertTrue(CaptureBuffer.drain(file).isEmpty())

    CaptureBuffer.append(file, record(1))
    assertEquals(listOf("id-1"), CaptureBuffer.drain(file).map { it.id })
  }

  @Test
  fun `a truncated write left behind by a killed process is discarded without throwing`() {
    // The realistic process-kill shape for this file format: a valid first
    // record followed by a second one cut off mid-object, so the file is
    // *not* a parseable JSON array at all.
    val truncated = "[${record(1).toJson()}," +
      """{"id":"id-2","packageName":"com.globe.gcash.android","title":"GCash","text":"You have se"""
    file.writeText(truncated)

    val drained = CaptureBuffer.drain(file)

    assertTrue(drained.isEmpty())
    assertFalse("corrupt file must be cleared, not left behind", file.exists())

    // And capture keeps working afterward -- one bad file must not wedge
    // the buffer forever.
    CaptureBuffer.append(file, record(3))
    assertEquals(listOf("id-3"), CaptureBuffer.drain(file).map { it.id })
  }

  @Test
  fun `an unreadable entry between two good ones is skipped without losing either`() {
    file.writeText("[${record(1).toJson()},{\"id\":\"broken\"},${record(2).toJson()}]")

    val drained = CaptureBuffer.drain(file)

    assertEquals(listOf("id-1", "id-2"), drained.map { it.id })
  }
}
