package expo.modules.llamabridge

import java.io.File
import java.security.MessageDigest

/** Bytes read per pass. A model runs to 1.1 GB, so it is never held in memory whole. */
private const val BUFFER_BYTES = 1024 * 1024

/**
 * SHA-256 of [file]'s bytes as they are on disk, as 64 lowercase hex characters.
 *
 * The downloader compares this against the catalogue digest before a `.part`
 * becomes a model, so what gets hashed is the file as written, never a copy.
 *
 * @throws java.io.FileNotFoundException when [file] does not exist or is a directory.
 */
internal fun sha256Hex(file: File): String {
  val digest = MessageDigest.getInstance("SHA-256")
  val buffer = ByteArray(BUFFER_BYTES)
  file.inputStream().use { input ->
    var read = input.read(buffer)
    while (read != -1) {
      digest.update(buffer, 0, read)
      read = input.read(buffer)
    }
  }
  return digest.digest().joinToString("") { "%02x".format(it) }
}
