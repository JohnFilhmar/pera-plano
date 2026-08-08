package expo.modules.notificationlistener

import android.util.Base64
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Task 3 of the encryption plan (docs/12-encryption-and-app-lock.md §6).
 *
 * Runs under Robolectric -- NOT for the Keystore (Robolectric has no shadow
 * for it at all, see KeyVault's class doc and KeyStoreBridgeTest's), but for
 * `android.util.Base64`/`Log`, which [CaptureEnvelope] and [CaptureBuffer]
 * both call and which throw "not mocked" under plain JUnit. [KeyStoreBridge.vault]
 * is swapped for a [FakeKeyVault] exactly like KeyStoreBridgeTest, so every
 * test here exercises the REAL AES-GCM/RSA-OAEP crypto in [CaptureEnvelope]
 * and [KeyStoreBridge] against a plain-JCE in-memory key.
 *
 * These tests are written to DISCRIMINATE against plausible-but-broken
 * implementations, not just to prove a round trip works -- see each test's
 * comment for exactly which broken variant it catches.
 */
// sdk 34 (Android 14), not the module's compileSdk 36 -- Robolectric 4.16.1's
// SDK-36 shadow jar requires Java 21 to load, and this project's toolchain is
// Java 17. Pinning here is an environment/toolchain choice about which
// Robolectric SDK jar loads, not a statement about the app's real
// minSdk/targetSdk (24/36), and every Android class this suite touches
// (Base64, Log, the UserNotAuthenticatedException type) is unaffected by
// which SDK level's shadows are loaded.
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class CaptureEnvelopeTest {

  @Before
  fun setUp() {
    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensureCaptureKeyPair()
  }

  @After
  fun tearDown() {
    // Defensive, same reasoning as KeyStoreBridgeTest: KeyStoreBridge.vault
    // is process-global, so leaving a fake installed would silently defang
    // any test file that assumes the real AndroidKeyVault is in place.
    KeyStoreBridge.vault = AndroidKeyVault
  }

  private fun publicKey() = KeyStoreBridge.capturePublicKeySpki()

  private fun record(
    text: String? = "You have sent PHP 500.00 to JUAN DELA CRUZ",
    subText: String? = "Wallet",
    bigText: String? = "You have sent PHP 500.00 to JUAN DELA CRUZ. Ref 1234567",
  ) = CaptureRecord(
    id = "3f1c6a2e-9b47-4c1d-8f52-77a0d1b6e904",
    packageName = "com.globe.gcash.android",
    title = "GCash",
    text = text,
    subText = subText,
    bigText = bigText,
    postedAt = 1_754_524_800_000L,
    capturedAt = 1_754_524_800_321L,
  )

  // ---------------------------------------------------------------------
  // Property 1: a sealed line must not contain its plaintext. The single
  // most important assertion in this task -- a seal that silently no-ops
  // (e.g. returns base64 of the plain JSON, with no encryption at all)
  // would still pass every round-trip test below but fail this one.
  // ---------------------------------------------------------------------

  @Test
  fun `a sealed line does not contain the plaintext merchant name`() {
    val merchant = "JUAN DELA CRUZ"
    val sealed = CaptureEnvelope.seal(record(), publicKey())

    assertFalse(
      "the base64 text of a sealed line must not contain the plaintext substring",
      sealed.contains(merchant),
    )

    val rawBytes = Base64.decode(sealed, Base64.NO_WRAP)
    assertFalse(
      "a no-op seal would still pass a round-trip test but leak the plaintext " +
        "straight into the sealed bytes -- this is the assertion that catches that",
      rawBytes.containsSubsequence(merchant.toByteArray(Charsets.UTF_8)),
    )
  }

  // ---------------------------------------------------------------------
  // Round trip, including the hostile characters PH notification text is
  // full of, and null fields.
  // ---------------------------------------------------------------------

  @Test
  fun `seal then open round-trips a record exactly, including null fields and hostile text`() {
    val hostile = record(
      text = "Sent \"₱1,000.00\"\nto JUAN D.\nRef\\No: 12/34\\56 -- ₱ balance left",
      subText = null,
      bigText = null,
    )

    val sealed = CaptureEnvelope.seal(hostile, publicKey())
    val opened = CaptureEnvelope.open(sealed)

    assertEquals(hostile, opened)
    assertNull(opened.subText)
    assertNull(opened.bigText)
  }

  // ---------------------------------------------------------------------
  // Property 2: fresh AES key AND fresh IV per record. Sealing the same
  // record twice must differ. Catches: a hardcoded/cached AES key, or a
  // GCMParameterSpec that pins a fixed IV instead of letting the cipher
  // mint a fresh one.
  //
  // NOTE: comparing the two sealed LINES for inequality is not enough on
  // its own -- RSA-OAEP's own randomized padding makes the wrapped-key
  // segment differ on every call regardless of whether the AES key or IV
  // underneath was reused, so a whole-line comparison could pass even with
  // a completely broken AES layer. This test decodes the wire format and
  // compares the IV and ciphertext segments directly, bypassing OAEP's
  // randomness entirely.
  // ---------------------------------------------------------------------

  @Test
  fun `sealing the same record twice produces different lines, IVs, and ciphertexts`() {
    val original = record()
    val first = decodeWireFormat(CaptureEnvelope.seal(original, publicKey()))
    val second = decodeWireFormat(CaptureEnvelope.seal(original, publicKey()))

    // NOTE: this is a basic OAEP sanity check, not evidence about AES key
    // freshness -- RSA-OAEP's own randomized padding guarantees the wrapped
    // bytes differ on every call regardless of whether the AES key
    // underneath was reused, so passing here proves OAEP's randomization is
    // working, nothing more. The `iv` and `ciphertext` assertions below are
    // the ones that actually pin AES key/IV freshness.
    assertFalse(
      "the wrapped AES key must differ across seals of the same record -- " +
        "identical wrapped bytes here would mean OAEP's own randomized " +
        "padding was broken",
      first.wrappedAesKey.contentEquals(second.wrappedAesKey),
    )
    assertFalse(
      "the GCM IV must differ across seals -- reusing an IV under the same " +
        "key leaks the XOR of the two plaintexts and breaks GCM authentication",
      first.iv.contentEquals(second.iv),
    )
    assertFalse(
      "the ciphertext must differ across seals of an IDENTICAL record -- for " +
        "GCM, identical ciphertext from identical plaintext means the key " +
        "and IV together were effectively reused even if the outer wrapped " +
        "key looked different (OAEP's own randomized padding would mask that)",
      first.ciphertext.contentEquals(second.ciphertext),
    )

    // Both must still independently open to the same content.
    assertEquals(original, CaptureEnvelope.open(Base64.encodeToString(first.raw, Base64.NO_WRAP)))
    assertEquals(original, CaptureEnvelope.open(Base64.encodeToString(second.raw, Base64.NO_WRAP)))
  }

  // ---------------------------------------------------------------------
  // Property 3: line-delimited, newline-safe. Base64 has no newline in its
  // alphabet, so this should hold by construction -- proven, not assumed.
  // ---------------------------------------------------------------------

  @Test
  fun `a sealed line never contains a raw newline even when the source text is full of them`() {
    val hostile = record(text = "line one\nline two\r\nline three\n\n\n")
    val sealed = CaptureEnvelope.seal(hostile, publicKey())

    assertFalse(
      "a sealed line must be safe to join with \\n as a record separator",
      sealed.contains("\n"),
    )
    assertEquals(hostile, CaptureEnvelope.open(sealed))
  }

  // ---------------------------------------------------------------------
  // Corrupt input never fabricates a record.
  // ---------------------------------------------------------------------

  @Test
  fun `opening a corrupt line throws instead of returning a fabricated record`() {
    assertThrows(Exception::class.java) {
      CaptureEnvelope.open("this is not a valid sealed line at all")
    }
  }

  @Test
  fun `opening a line sealed under a different keypair throws instead of returning garbage`() {
    val sealedUnderFirstKey = CaptureEnvelope.seal(record(), publicKey())

    // Simulate the capture keypair having been rotated/regenerated -- e.g.
    // after a recovery-phrase-driven reset -- by installing a brand new
    // keypair under the SAME alias. RSA-OAEP's padding check cannot tell
    // "wrong key" apart from "corrupt bytes", which is the point: both are
    // equally unrecoverable, and both must throw rather than decrypt into
    // nonsense.
    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensureCaptureKeyPair()

    assertThrows(Exception::class.java) {
      CaptureEnvelope.open(sealedUnderFirstKey)
    }
  }
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

/**
 * Test-only mirror of [CaptureEnvelope]'s wire-format parsing, used to
 * inspect the IV and ciphertext segments directly -- see
 * `sealing the same record twice produces different lines, IVs, and
 * ciphertexts` for why a whole-line comparison alone is not a strong enough
 * assertion.
 */
private data class DecodedWireFormat(
  val wrappedAesKey: ByteArray,
  val iv: ByteArray,
  val ciphertext: ByteArray,
  val raw: ByteArray,
)

private fun decodeWireFormat(line: String): DecodedWireFormat {
  val bytes = Base64.decode(line, Base64.NO_WRAP)
  val wrappedKeyLength = ((bytes[0].toInt() and 0xFF) shl 8) or (bytes[1].toInt() and 0xFF)
  val wrappedKeyStart = 2
  val wrappedKeyEnd = wrappedKeyStart + wrappedKeyLength
  val ivEnd = wrappedKeyEnd + 12
  return DecodedWireFormat(
    wrappedAesKey = bytes.copyOfRange(wrappedKeyStart, wrappedKeyEnd),
    iv = bytes.copyOfRange(wrappedKeyEnd, ivEnd),
    ciphertext = bytes.copyOfRange(ivEnd, bytes.size),
    raw = bytes,
  )
}
