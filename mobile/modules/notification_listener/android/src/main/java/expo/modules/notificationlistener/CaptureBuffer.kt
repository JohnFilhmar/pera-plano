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
 *  - a WHOLE-FILE read failure (permission, EMFILE, a transient I/O error --
 *    anything not about the file's contents) is ALSO different in kind from
 *    "corrupt" or "empty": [readLines] throws [ReadFailedException] rather
 *    than returning an empty list, precisely so [append], [drain], and
 *    [size] can never mistake "could not read this" for "there is nothing
 *    here". A transient hiccup on any of those three must cost nothing --
 *    conflating the two would mean the very next [drain] permanently
 *    destroys every buffered capture over a filesystem blip that had
 *    nothing to do with them.
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
   * Thrown when the pending-capture file EXISTS but could not be read for a
   * reason unrelated to its contents -- permission, `EMFILE`, a transient
   * I/O error. Deliberately distinct from an empty/never-written buffer
   * (which is not an error at all) so that [append], [drain], and [size]
   * can never treat "couldn't read it" as "there's nothing there" -- see
   * the class doc.
   */
  class ReadFailedException(cause: Throwable) :
    Exception("failed to read the pending-capture file", cause)

  /**
   * Seals [record] and appends it, evicting the oldest LINE past the cap.
   * Never decrypts an existing line -- see the class doc for why that
   * property is load-bearing, not incidental.
   *
   * If the file exists but can't be read right now ([ReadFailedException]),
   * this throws before writing anything -- the alternative, treating the
   * unreadable file as empty, would silently overwrite however many
   * captures it actually holds with just this one new record.
   */
  fun append(file: File, record: CaptureRecord): Int = synchronized(lock) {
    val lines = readLines(file).toMutableList()
    // Looked up fresh on every append, deliberately not cached: a cached
    // SPKI would go stale the moment the capture keypair is regenerated
    // (e.g. a wipe-and-start-over per docs §11a), and every capture sealed
    // under a stale public key afterward would be silently, permanently
    // unopenable -- there is no private key anywhere that matches it
    // anymore. That is real data loss traded for a Keystore certificate
    // lookup's microseconds. If this lookup ever measurably matters, the
    // fix is a cache with EXPLICIT invalidation tied to keypair
    // regeneration, not a bare cache -- do not "optimize" this away.
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
   *
   * The same protection applies to [ReadFailedException] from [readLines]
   * itself: it throws out of the `val lines = readLines(file)` line above,
   * before [openAll] or the delete ever run, so a transient read failure
   * (as opposed to the file genuinely being empty) never costs a capture.
   */
  fun drain(file: File): List<CaptureRecord> = synchronized(lock) {
    val lines = readLines(file)
    val records = openAll(lines)
    if (file.exists()) {
      file.delete()
    }
    records
  }

  /**
   * Line count. Never decrypts -- see the class doc.
   *
   * Throws [ReadFailedException], rather than reporting 0, if the file
   * exists but can't currently be read -- see [readLines].
   */
  fun size(file: File): Int = synchronized(lock) { readLines(file).size }

  /**
   * Reads the pending-capture file's lines.
   *
   * A MISSING file is genuinely empty -- nothing has ever been written --
   * and returns an empty list normally. An EXISTING file that fails to read
   * throws [ReadFailedException] instead of returning an empty list.
   * Conflating the two would be indistinguishable from every capture being
   * gone: [drain] would proceed straight to deleting a file it never
   * actually looked inside, and [append] would silently overwrite however
   * many buffered captures the file actually holds with just the one new
   * record. Every caller relies on this exception propagating BEFORE any
   * write or delete happens -- see [append]'s and [drain]'s docs.
   */
  private fun readLines(file: File): List<String> {
    if (!file.exists()) return emptyList()

    val raw = try {
      file.readText()
    } catch (error: Exception) {
      Log.e(TAG, "failed to read the pending-capture file")
      throw ReadFailedException(error)
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
