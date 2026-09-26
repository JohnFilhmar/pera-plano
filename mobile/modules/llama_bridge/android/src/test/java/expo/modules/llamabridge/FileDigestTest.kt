package expo.modules.llamabridge

import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Covers `FileDigest.kt`, the hash that decides whether a downloaded model is
 * activated or deleted. The JS suites stand a JS hasher in for this one, so
 * these tests are the only place the native digest meets a known answer.
 */
class FileDigestTest {
  @get:Rule
  val temp = TemporaryFolder()

  @Test
  fun `abc hashes to the published SHA-256 test vector`() {
    val file = temp.newFile("abc.bin").apply { writeBytes("abc".toByteArray()) }

    assertEquals(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sha256Hex(file),
    )
  }

  @Test
  fun `a file several buffers long hashes the same as its bytes in one pass`() {
    // Three full 1 MiB reads and a ragged tail: a read loop that dropped or
    // repeated bytes at a buffer boundary would change the answer.
    val bytes = ByteArray(3 * 1024 * 1024 + 17) { (it * 7 % 251).toByte() }
    val file = temp.newFile("model.gguf.part").apply { writeBytes(bytes) }

    val onePass = MessageDigest.getInstance("SHA-256").digest(bytes)
      .joinToString("") { "%02x".format(it) }
    assertEquals(onePass, sha256Hex(file))
  }

  @Test
  fun `a missing file throws instead of hashing nothing`() {
    assertThrows(FileNotFoundException::class.java) {
      sha256Hex(File(temp.root, "gone.gguf.part"))
    }
  }
}
