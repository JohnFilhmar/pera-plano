package expo.modules.llamabridge

import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The logcat tag docs/13 Gate 7 reads its digest time from. */
private const val LOG_TAG = "LlamaBridgeDigest"

/**
 * The Kotlin side of `llama_bridge`. It hashes downloaded models and nothing
 * else: tokens come from `llama.rn`'s own JNI layer and never pass through
 * here (spec §1.1).
 *
 * Hashing is native because of spec §6 risk 8. The JS digest took 939,944 ms
 * for a 396,705,472-byte model on the Samsung A54 and held the JS thread at
 * 93% CPU the whole time; `sha256sum` on the same phone hashes 1.1 GB in 3 s.
 */
class LlamaBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LlamaBridge")

    // Takes the `file://` URI the downloader builds. A plain AsyncFunction body
    // runs on expo.modules.AsyncFunctionQueue, one thread shared by every Expo
    // module, and would hold all of their calls for as long as the hash runs.
    // The IO dispatcher leaves that queue free.
    AsyncFunction("sha256File") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        val file = File(URI(uri))
        val startedAt = SystemClock.elapsedRealtime()
        val hex = sha256Hex(file)
        // Gate 7 needs the size and the time. The path and the digest stay out of logcat.
        Log.i(LOG_TAG, "sha256 ${file.length()} bytes in ${SystemClock.elapsedRealtime() - startedAt} ms")
        hex
      }
    }
  }
}
