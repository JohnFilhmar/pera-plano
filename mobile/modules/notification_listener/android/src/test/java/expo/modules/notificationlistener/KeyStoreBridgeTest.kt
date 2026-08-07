package expo.modules.notificationlistener

import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.X509EncodedKeySpec
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private const val RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"

/**
 * Task 2 of the encryption plan (docs/12-encryption-and-app-lock.md §3, §6).
 *
 * Plain JUnit -- no Robolectric, no device. [KeyStoreBridge.vault] is swapped
 * for a [FakeKeyVault] below, so every test here exercises the REAL
 * AES-GCM/RSA-OAEP `Cipher` logic in [KeyStoreBridge] against a plain-JCE
 * in-memory key. See [KeyVault]'s class doc for exactly what that does and
 * does not prove: the real Android-Keystore configuration (hardware
 * backing, auth-required, StrongBox, invalidation) is invisible here by
 * construction and is covered instead by
 * `src/androidTest/.../KeyStoreBridgeInstrumentedTest.kt` and by manual
 * on-device checks.
 *
 * These tests are written to DISCRIMINATE against plausible-but-broken
 * implementations, not just to prove a round trip works:
 *  - a wrap that returns its input unchanged would still pass a naive
 *    round-trip test, so [wrapped blob does not contain the plaintext]
 *    checks the ciphertext directly;
 *  - a reused GCM IV is a catastrophic real-world failure (it leaks the XOR
 *    of two plaintexts and breaks authentication), so
 *    [two wraps of the same plaintext produce different blobs] pins IV
 *    generation, not just "no exception";
 *  - a cipher mode with no integrity tag would still round-trip untampered
 *    data, so [altering one byte...] proves GCM's tag is actually checked;
 *  - both `ensure*` functions run on every app launch, so their idempotence
 *    tests prove a second call does NOT rotate the key -- by wrapping
 *    something with the FIRST key and unwrapping it only AFTER the second
 *    `ensure*` call.
 */
class KeyStoreBridgeTest {

  @Before
  fun setUp() {
    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensureDeviceKek()
    KeyStoreBridge.ensureCaptureKeyPair()
  }

  @After
  fun tearDown() {
    // Defensive: KeyStoreBridge is a singleton object, so its `vault` var
    // is process-global. Production never touches it, but leaving a fake
    // installed after this class runs would silently defang any future
    // test file that assumes the real AndroidKeyVault is in place.
    KeyStoreBridge.vault = AndroidKeyVault
  }

  // ---- idempotence of the ensure* functions -----------------------------

  @Test
  fun `ensureDeviceKek second call does not rotate the key`() {
    val wrappedUnderFirstKey = KeyStoreBridge.wrapWithDeviceKek("probe".toByteArray())

    KeyStoreBridge.ensureDeviceKek() // second call on this launch; must be a no-op

    val unwrapped = KeyStoreBridge.unwrapWithDeviceKek(wrappedUnderFirstKey)
    assertArrayEquals("probe".toByteArray(), unwrapped)
  }

  @Test
  fun `ensureCaptureKeyPair second call does not rotate the key`() {
    val publicKey = capturePublicKey()
    val plaintext = randomBytes(32)
    val cipher = Cipher.getInstance(RSA_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, publicKey)
    val wrappedUnderFirstKey = cipher.doFinal(plaintext)

    KeyStoreBridge.ensureCaptureKeyPair() // second call on this launch; must be a no-op

    val unwrapped = KeyStoreBridge.decryptWithCaptureKey(wrappedUnderFirstKey)
    assertArrayEquals(plaintext, unwrapped)
  }

  // ---- device KEK wrap / unwrap -----------------------------------------

  @Test
  fun `wrap then unwrap round-trips exactly`() {
    val plaintext = randomBytes(32)
    val wrapped = KeyStoreBridge.wrapWithDeviceKek(plaintext)
    val unwrapped = KeyStoreBridge.unwrapWithDeviceKek(wrapped)
    assertArrayEquals(plaintext, unwrapped)
  }

  @Test
  fun `wrapped blob does not contain the plaintext`() {
    val plaintext = randomBytes(32)
    val wrapped = KeyStoreBridge.wrapWithDeviceKek(plaintext)
    assertFalse(
      "wrapped blob must not contain the plaintext bytes verbatim -- a no-op " +
        "'wrap' would pass a round-trip test but fail this one",
      wrapped.containsSubsequence(plaintext),
    )
  }

  @Test
  fun `two wraps of the same plaintext produce different blobs`() {
    val plaintext = randomBytes(32)
    val first = KeyStoreBridge.wrapWithDeviceKek(plaintext)
    val second = KeyStoreBridge.wrapWithDeviceKek(plaintext)
    assertFalse(
      "identical output for identical plaintext means the GCM IV was reused " +
        "-- catastrophic: it leaks the XOR of the two plaintexts",
      first.contentEquals(second),
    )
  }

  @Test
  fun `altering one byte of a wrapped blob makes unwrap throw`() {
    val plaintext = randomBytes(32)
    val wrapped = KeyStoreBridge.wrapWithDeviceKek(plaintext)
    val tampered = wrapped.copyOf()
    tampered[tampered.size - 1] = (tampered[tampered.size - 1].toInt() xor 0x01).toByte()

    assertThrows(BadPaddingException::class.java) {
      KeyStoreBridge.unwrapWithDeviceKek(tampered)
    }
  }

  @Test
  fun `isDeviceKekUsable is true after ensureDeviceKek`() {
    assertTrue(KeyStoreBridge.isDeviceKekUsable())
  }

  // ---- capture keypair ---------------------------------------------------

  @Test
  fun `capturePublicKeySpki parses as a valid SPKI key`() {
    val publicKey = capturePublicKey()
    assertEquals("RSA", publicKey.algorithm)
    assertEquals("X.509", publicKey.format)
  }

  @Test
  fun `public-encrypt then private-decrypt round-trips`() {
    val publicKey = capturePublicKey()
    val plaintext = randomBytes(32)

    val cipher = Cipher.getInstance(RSA_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, publicKey)
    val wrapped = cipher.doFinal(plaintext)

    val unwrapped = KeyStoreBridge.decryptWithCaptureKey(wrapped)
    assertArrayEquals(plaintext, unwrapped)
  }

  // ---- helpers ------------------------------------------------------------

  private fun capturePublicKey() =
    KeyFactory.getInstance("RSA")
      .generatePublic(X509EncodedKeySpec(KeyStoreBridge.capturePublicKeySpki()))

  private fun randomBytes(size: Int): ByteArray =
    ByteArray(size).also { SecureRandom().nextBytes(it) }
}

private fun ByteArray.containsSubsequence(needle: ByteArray): Boolean {
  if (needle.isEmpty() || needle.size > size) return false
  outer@ for (start in 0..(size - needle.size)) {
    for (i in needle.indices) {
      if (this[start + i] != needle[i]) continue@outer
    }
    return true
  }
  return false
}
