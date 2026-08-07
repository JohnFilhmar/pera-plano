package expo.modules.notificationlistener

import android.content.Context
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.json.JSONArray

/**
 * Bounded, disk-backed FIFO of captures taken while no JS listener was
 * attached.
 *
 * Android can restart the process purely to host the notification-listener
 * service, with no JS running at all; whatever lands while JS is dead has to
 * survive on disk until the app is next opened (interface contract §4: the
 * "buffered-while-dead queue"). Every operation here takes a `File` rather
 * than a `Context`, which is exactly what keeps this a plain-JVM unit test
 * away from the Android framework -- Robolectric is deliberately staged
 * into Task 4 (the first task that actually needs SharedPreferences), not
 * this one.
 *
 * On-disk format: the whole pending buffer lives as ONE JSON array in ONE
 * file, rewritten in full on every append/drain -- not one JSON object per
 * line (NDJSON). `CaptureRecord.fromJson` throws on a malformed object
 * rather than silently defaulting fields, so corruption has to be handled
 * explicitly at two different levels for this format:
 *
 *  - the OUTER array doesn't parse at all (non-JSON garbage, or a write
 *    truncated by a killed process before it produced a complete array) --
 *    there is no reliable way to recover individual entries out of a blob
 *    that isn't even valid JSON, so the whole file is discarded and treated
 *    as empty. Losing one already-buffered batch this way is rare (writes
 *    go through [writeAll]'s temp-file-then-atomic-move, so a kill has to
 *    land in a narrow window) and is still strictly better than either
 *    throwing (which would wedge every future capture behind it forever)
 *    or attempting a byte-level guess at recovery, which risks minting
 *    fabricated `CaptureRecord`s from garbage.
 *  - the outer array parses fine but ONE element inside it doesn't (e.g. a
 *    future schema change, or a hand-edited/foreign entry) -- only that one
 *    element is skipped; every other capture in the same file survives.
 *    This is the "one bad line must not cost the rest" property, expressed
 *    for a JSON-array file instead of NDJSON.
 */
object CaptureBuffer {

  /** Hard cap. Past this, the OLDEST capture is evicted -- never the newest. */
  const val MAX_CAPTURES = 500

  const val FILE_NAME = "pending_captures.json"

  // Guards every read-modify-write against another thread doing the same
  // thing concurrently (e.g. two rapid-fire notifications hitting the
  // listener service back to back). Every public function below takes this
  // lock for its entire body, including drain(), so an append can never be
  // interleaved between drain's read and its clear.
  private val lock = Any()

  /** `<filesDir>/pending_captures.json` -- not exercised by these JVM tests. */
  fun fileFor(context: Context): File =
    File(context.applicationContext.filesDir, FILE_NAME)

  /** Appends one capture, evicting the oldest past the cap. Returns the resulting pending count. */
  fun append(file: File, record: CaptureRecord): Int = synchronized(lock) {
    val records = readAll(file).toMutableList()
    records.add(record)
    while (records.size > MAX_CAPTURES) {
      records.removeAt(0) // oldest survivors first; the newest is never the one dropped
    }
    writeAll(file, records)
    records.size
  }

  /**
   * Returns everything pending and clears the buffer as a single operation
   * under the same lock [append] uses -- a concurrent append can never see
   * (or be lost between) the read and the clear here.
   *
   * The file is only removed AFTER its contents are already sitting in the
   * `records` local that this function returns, so a crash between the read
   * and the delete costs nothing: worst case the file is still there next
   * launch and the same batch drains again (a safe duplicate the caller can
   * dedupe by id), never a silent loss.
   */
  fun drain(file: File): List<CaptureRecord> = synchronized(lock) {
    val records = readAll(file)
    if (file.exists()) {
      file.delete()
    }
    records
  }

  fun size(file: File): Int = synchronized(lock) { readAll(file).size }

  private fun readAll(file: File): List<CaptureRecord> {
    if (!file.exists()) return emptyList()

    val raw = try {
      file.readText()
    } catch (error: Exception) {
      return emptyList()
    }
    if (raw.isBlank()) return emptyList()

    val array = try {
      JSONArray(raw)
    } catch (error: Exception) {
      // Outer structure doesn't parse at all -- see the class doc for why
      // this discards the whole file instead of guessing at recovery.
      file.delete()
      return emptyList()
    }

    return (0 until array.length()).mapNotNull { index ->
      try {
        CaptureRecord.fromJson(array.getJSONObject(index))
      } catch (error: Exception) {
        null // one unreadable entry must not cost us the rest
      }
    }
  }

  private fun writeAll(file: File, records: List<CaptureRecord>) {
    val array = JSONArray()
    records.forEach { array.put(it.toJson()) }
    val payload = array.toString()

    // Write the new contents to a sibling temp file first, then swap it into
    // place with an atomic move. A process killed while writing the temp
    // file leaves the real file exactly as it was; a process killed during
    // the move either lands before or after, never mid-write. This is what
    // makes append() crash-safe against the "half-written buffer" scenario.
    val temp = File("${file.absolutePath}.tmp")
    temp.writeText(payload)
    try {
      Files.move(
        temp.toPath(),
        file.toPath(),
        StandardCopyOption.REPLACE_EXISTING,
        StandardCopyOption.ATOMIC_MOVE,
      )
    } catch (error: Exception) {
      // Same-volume atomic replace unavailable for some reason (unusual
      // filesystem, transient lock, ...). Fall back to a direct write --
      // not atomic, but every append already rewrites the whole file, so
      // this is no less safe than that baseline.
      temp.delete()
      file.writeText(payload)
    }
  }
}
