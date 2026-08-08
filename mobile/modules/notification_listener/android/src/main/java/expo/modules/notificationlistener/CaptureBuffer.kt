package expo.modules.notificationlistener

import android.content.Context
import android.security.keystore.UserNotAuthenticatedException
import android.util.Log
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Bounded, disk-backed FIFO of captures taken while no JS listener was
 * attached.
 *
 * Android can restart the process purely to host the notification-listener
 * service, with no JS running at all; whatever lands while JS is dead has to
 * survive on disk until the app is next opened (interface contract §4: the
 * "buffered-while-dead queue"). Every operation here takes a `File` rather
 * than a `Context`, which is exactly what keeps this a plain-JVM unit test
 * away from the Android framework.
 *
 * On-disk format: NDJSON -- one sealed [CaptureEnvelope] line per capture,
 * "\n"-terminated, oldest first. This replaced a single-JSON-array-per-file
 * format (M1a Task 3) for a reason that only exists once encryption enters
 * the picture (docs/12-encryption-and-app-lock.md §6): a sealed envelope is
 * a self-contained per-record blob by construction, and a single encrypted
 * blob spanning the whole file could never be appended to without
 * decrypting the whole file first -- which the notification listener,
 * running with no user present, can never do. Line-delimited means append
 * only ever has to know how many lines already exist and what their raw
 * bytes are, never what they mean.
 *
 * THE PROPERTY THIS BUYS: [append] and [size] never decrypt anything -- they
 * read and write opaque sealed-line strings. Only [drain] ever calls
 * [CaptureEnvelope.open], which needs the capture keypair's
 * authentication-gated private key. This is not an optimization; it is the
 * whole reason this design works. If [append] had to open every existing
 * line just to count them, the buffer would stop accepting new captures the
 * moment the app locked -- exactly the scenario (§6) this buffer exists to
 * survive.
 *
 * Corruption handling, now expressed per-line instead of per-file:
 *  - a line that fails to open -- truncated (the realistic shape of a
 *    process kill mid-write; see [writeLines]'s atomic-move, and its
 *    non-atomic fallback which is NOT crash-safe), corrupt, or sealed under
 *    a capture key that no longer exists -- is skipped and counted; every
 *    other line is unaffected. RSA-OAEP's padding check cannot distinguish
 *    "wrong/rotated key" from "corrupt bytes", and that is fine: both are
 *    equally unrecoverable.
 *  - [UserNotAuthenticatedException] is different IN KIND from the above --
 *    it is not a property of the line at all, it means [drain] was called
 *    before the private key's authentication window was open. Folding it
 *    into "skip and count" would make an early call look identical to every
 *    buffered capture being corrupt, and would then discard them for good.
 *    [drain] keeps this from ever costing a byte by decrypting BEFORE it
 *    ever touches the file on disk -- see its doc.
 */
object CaptureBuffer {

  /** Hard cap. Past this, the OLDEST capture is evicted -- never the newest. */
  const val MAX_CAPTURES = 500

  const val FILE_NAME = "pending_captures.ndjson"

  private const val TAG = "CaptureBuffer"
  private const val LINE_SEPARATOR = "\n"

  // Guards every read-modify-write against another thread doing the same
  // thing concurrently (e.g. two rapid-fire notifications hitting the
  // listener service back to back). Every public function below takes this
  // lock for its entire body, including drain(), so an append can never be
  // interleaved between drain's read and its clear.
  private val lock = Any()

  /** `<filesDir>/pending_captures.ndjson` -- not exercised by these JVM tests. */
  fun fileFor(context: Context): File =
    File(context.applicationContext.filesDir, FILE_NAME)

  /**
   * Seals [record] and appends it, evicting the oldest LINE past the cap.
   * Never decrypts an existing line -- see the class doc for why that
   * property is load-bearing, not incidental.
   */
  fun append(file: File, record: CaptureRecord): Int = synchronized(lock) {
    val lines = readLines(file).toMutableList()
    lines.add(CaptureEnvelope.seal(record, KeyStoreBridge.capturePublicKeySpki()))
    while (lines.size > MAX_CAPTURES) {
      lines.removeAt(0) // oldest survivors first; the newest is never the one dropped
    }
    writeLines(file, lines)
    lines.size
  }

  /**
   * Returns everything pending, decrypted, and clears the buffer as a single
   * operation under the same lock [append] uses -- a concurrent append can
   * never see (or be lost between) the read and the clear here.
   *
   * Decryption happens BEFORE the file is touched on disk, not after: if
   * [openAll] throws [UserNotAuthenticatedException] (called too early,
   * before the private key's auth window is open), this function exits via
   * that exception with the file completely untouched, so the exact same
   * drain can simply be retried once the caller has actually authenticated.
   * Only a normal return -- every line either opened or was individually
   * skipped-and-counted as unrecoverable -- reaches the delete below.
   */
  fun drain(file: File): List<CaptureRecord> = synchronized(lock) {
    val lines = readLines(file)
    val records = openAll(lines)
    if (file.exists()) {
      file.delete()
    }
    records
  }

  /** Line count. Never decrypts -- see the class doc. */
  fun size(file: File): Int = synchronized(lock) { readLines(file).size }

  private fun readLines(file: File): List<String> {
    if (!file.exists()) return emptyList()

    val raw = try {
      file.readText()
    } catch (error: Exception) {
      Log.e(TAG, "failed to read the pending-capture file; treating it as empty")
      return emptyList()
    }
    if (raw.isBlank()) return emptyList()

    return raw.split(LINE_SEPARATOR).filter { it.isNotEmpty() }
  }

  private fun openAll(lines: List<String>): List<CaptureRecord> {
    var skipped = 0
    val records = lines.mapNotNull { line ->
      try {
        CaptureEnvelope.open(line)
      } catch (notAuthenticated: UserNotAuthenticatedException) {
        // Not a per-line failure -- see the class doc. Aborts the whole
        // drain before the file is ever deleted.
        throw notAuthenticated
      } catch (error: Exception) {
        skipped++
        null // one unreadable line must not cost us the rest
      }
    }
    if (skipped > 0) {
      Log.w(TAG, "skipped $skipped of ${lines.size} pending-capture line(s) that failed to open")
    }
    return records
  }

  private fun writeLines(file: File, lines: List<String>) {
    val payload = lines.joinToString(separator = "") { it + LINE_SEPARATOR }

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
      Log.w(TAG, "atomic move unavailable for the pending-capture file; falling back to a direct write")
      temp.delete()
      file.writeText(payload)
    }
  }
}
