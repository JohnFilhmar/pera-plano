package expo.modules.notificationlistener

import android.util.Base64
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
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Task 2 of the encryption plan (docs/12-encryption-and-app-lock.md §3, §6),
 * plus Task 1 of the provider-selection plan (the no-auth prefs KEK, §4).
 *
 * [KeyStoreBridge.vault] is swapped for a [FakeKeyVault] below, so every test
 * here exercises the REAL AES-GCM/RSA-OAEP `Cipher` logic in [KeyStoreBridge]
 * against a plain-JCE in-memory key. See [KeyVault]'s class doc for exactly
 * what that does and does not prove: the real Android-Keystore configuration
 * (hardware backing, auth-required, StrongBox, invalidation) is invisible
 * here by construction and is covered instead by
 * `src/androidTest/.../KeyStoreBridgeInstrumentedTest.kt` and by manual
 * on-device checks.
 *
 * RUNNER: this used to be plain JUnit, deliberately -- Robolectric was
 * pointless here because it has no Android Keystore at all. It is now
 * Robolectric for one narrow reason that has nothing to do with the
 * Keystore: [KeyStoreBridge.sealPrefsValue] returns `android.util.Base64`
 * text (the same encoder [CaptureEnvelope] uses, chosen over
 * `java.util.Base64` because that one needs API 26 and this app's minSdk is
 * 24), and `android.util.Base64` throws "not mocked" under plain JUnit.
 * Nothing about the swap makes any Keystore property testable here that
 * wasn't before -- Robolectric still has no shadow for `AndroidKeyStore`, so
 * `isUserAuthenticationRequired` remains unprovable on the JVM by
 * construction.
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
// sdk 34, matching every other Robolectric suite in this module (see
// CaptureEnvelopeTest's doc for why: this module's real compileSdk 36 needs
// Java 21, and this project's toolchain is Java 17).
@Config(sdk = [34])
@RunWith(RobolectricTestRunner::class)
class KeyStoreBridgeTest {

  @Before
  fun setUp() {
    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensureDeviceKek()
    KeyStoreBridge.ensureCaptureKeyPair()
    KeyStoreBridge.ensurePrefsKek()
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
    val cipher = Cipher.getInstance(KeyStoreBridge.RSA_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, publicKey, KeyStoreBridge.RSA_OAEP_PARAMS)
    val wrappedUnderFirstKey = cipher.doFinal(plaintext)

    KeyStoreBridge.ensureCaptureKeyPair() // second call on this launch; must be a no-op

    val unwrapped = KeyStoreBridge.decryptWithCaptureKey(wrappedUnderFirstKey)
    assertArrayEquals(plaintext, unwrapped)
  }

  // ---- recreateDeviceKek: the recovery primitive, deliberately NOT idempotent -----

  @Test
  fun `recreateDeviceKek replaces the key -- an old wrap becomes unopenable under the new one`() {
    val wrappedUnderOldKey = KeyStoreBridge.wrapWithDeviceKek("secret".toByteArray())

    KeyStoreBridge.recreateDeviceKek()

    // Proves this actually rotated the key, not merely a no-op like
    // ensureDeviceKek's second call -- a broken "recreate" that quietly
    // kept the old key would pass a naive "still round-trips" test.
    assertThrows(BadPaddingException::class.java) {
      KeyStoreBridge.unwrapWithDeviceKek(wrappedUnderOldKey)
    }
  }

  @Test
  fun `recreateDeviceKek's replacement key is fully usable -- a fresh wrap-unwrap round-trips`() {
    KeyStoreBridge.recreateDeviceKek()

    val wrapped = KeyStoreBridge.wrapWithDeviceKek("secret".toByteArray())
    val unwrapped = KeyStoreBridge.unwrapWithDeviceKek(wrapped)

    assertArrayEquals("secret".toByteArray(), unwrapped)
  }

  @Test
  fun `recreateDeviceKek works even when no device KEK has ever been created`() {
    KeyStoreBridge.vault = FakeKeyVault() // fresh vault, no keys at all -- not even via setUp's ensureDeviceKek

    KeyStoreBridge.recreateDeviceKek()

    val wrapped = KeyStoreBridge.wrapWithDeviceKek("secret".toByteArray())
    assertArrayEquals("secret".toByteArray(), KeyStoreBridge.unwrapWithDeviceKek(wrapped))
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

    val cipher = Cipher.getInstance(KeyStoreBridge.RSA_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, publicKey, KeyStoreBridge.RSA_OAEP_PARAMS)
    val wrapped = cipher.doFinal(plaintext)

    val unwrapped = KeyStoreBridge.decryptWithCaptureKey(wrapped)
    assertArrayEquals(plaintext, unwrapped)
  }

  // ---- prefs KEK (AES-256-GCM, NO user authentication) -------------------
  //
  // Provider-selection plan Task 1. Everything here runs against the
  // plain-JCE fake, so it can only ever prove the SEAL/OPEN logic. The one
  // property that actually justifies this key's existence --
  // `isUserAuthenticationRequired == false` on the real Keystore key -- is
  // structurally invisible from the JVM ([FakeKeyVault] never builds a
  // `KeyGenParameterSpec`) and lives in
  // `src/androidTest/.../KeyStoreBridgeInstrumentedTest.kt` instead.

  @Test
  fun `ensurePrefsKek second call does not rotate the key`() {
    val sealedUnderFirstKey = KeyStoreBridge.sealPrefsValue("probe".toByteArray())

    KeyStoreBridge.ensurePrefsKek() // second call on this launch; must be a no-op

    assertArrayEquals("probe".toByteArray(), KeyStoreBridge.openPrefsValue(sealedUnderFirstKey))
  }

  @Test
  fun `sealPrefsValue then openPrefsValue round-trips arbitrary bytes`() {
    val plaintext = randomBytes(64)
    val sealed = KeyStoreBridge.sealPrefsValue(plaintext)
    assertArrayEquals(plaintext, KeyStoreBridge.openPrefsValue(sealed))
  }

  /**
   * An EMPTY provider filter is not the same thing as an absent one: an empty
   * filter means "allow all", which is the fresh-install default the whole
   * capture path depends on (plan Task 4, rule 2). An implementation that
   * treats zero-length input as "nothing to seal" -- returning `""`, or null,
   * or refusing to seal -- would silently turn "capture everything" into
   * "capture nothing" the first time a user deselects every app.
   */
  @Test
  fun `an empty plaintext round-trips as empty rather than being treated as absent`() {
    val sealed = KeyStoreBridge.sealPrefsValue(ByteArray(0))

    assertTrue(
      "an empty value must still produce a real sealed blob -- an empty string " +
        "here means the seal treated zero-length input as 'nothing to store'",
      sealed.isNotEmpty(),
    )
    assertArrayEquals(ByteArray(0), KeyStoreBridge.openPrefsValue(sealed))
  }

  /**
   * The privacy assertion in miniature. A `sealPrefsValue` that base64'd its
   * input and called it a day would pass every round-trip test above.
   */
  @Test
  fun `a sealed prefs blob does not contain the plaintext`() {
    val plaintext = "com.globe.gcash.android".toByteArray(Charsets.UTF_8)
    val sealed = KeyStoreBridge.sealPrefsValue(plaintext)

    assertFalse(
      "the base64 text must not contain the plaintext verbatim",
      sealed.contains("com.globe.gcash.android"),
    )
    assertFalse(
      "the decoded blob must not contain the plaintext bytes -- a no-op 'seal' " +
        "would pass a round-trip test but fail this one",
      Base64.decode(sealed, Base64.NO_WRAP).containsSubsequence(plaintext),
    )
  }

  @Test
  fun `two seals of the same prefs value produce different blobs`() {
    val plaintext = randomBytes(32)
    val first = KeyStoreBridge.sealPrefsValue(plaintext)
    val second = KeyStoreBridge.sealPrefsValue(plaintext)

    assertFalse(
      "identical output for identical input means the GCM IV was reused -- " +
        "catastrophic: it leaks the XOR of the two plaintexts",
      first == second,
    )
    assertArrayEquals(plaintext, KeyStoreBridge.openPrefsValue(first))
    assertArrayEquals(plaintext, KeyStoreBridge.openPrefsValue(second))
  }

  // ---- tampering: the blob must fail to OPEN, never open into garbage -----
  //
  // Two separate tests, hitting two separate regions of the wire format
  // (`iv || ciphertext || tag`), because they fail for different reasons and
  // a single "flip the last byte" test only covers one of them:
  //  - a flipped CIPHERTEXT byte is what a cipher mode with no integrity tag
  //    at all (CBC, CTR) would happily decrypt into different, plausible-
  //    looking bytes -- the "returns garbage" failure this pair exists to
  //    rule out;
  //  - a flipped TAG byte leaves the ciphertext itself intact, so it fails
  //    ONLY if GCM's authentication check actually runs and its result is
  //    actually honoured.

  @Test
  fun `flipping a byte of the prefs ciphertext makes openPrefsValue throw rather than return garbage`() {
    val plaintext = randomBytes(32)
    val blob = Base64.decode(KeyStoreBridge.sealPrefsValue(plaintext), Base64.NO_WRAP)

    // Index 12 is the first byte AFTER the 12-byte IV: squarely inside the
    // ciphertext, nowhere near the trailing 16-byte tag.
    val tampered = blob.copyOf().also { it[GCM_IV_LENGTH_BYTES] = (it[GCM_IV_LENGTH_BYTES].toInt() xor 0x01).toByte() }

    assertThrows(PrefsValueSealException::class.java) {
      KeyStoreBridge.openPrefsValue(Base64.encodeToString(tampered, Base64.NO_WRAP))
    }
  }

  @Test
  fun `flipping a byte of the prefs GCM tag makes openPrefsValue throw rather than return garbage`() {
    val plaintext = randomBytes(32)
    val blob = Base64.decode(KeyStoreBridge.sealPrefsValue(plaintext), Base64.NO_WRAP)

    // Last byte of the trailing 128-bit GCM tag. The ciphertext is untouched,
    // so nothing but the tag check can catch this.
    val last = blob.size - 1
    assertTrue("the tag must be the trailing bytes", last >= GCM_IV_LENGTH_BYTES + plaintext.size)
    val tampered = blob.copyOf().also { it[last] = (it[last].toInt() xor 0x01).toByte() }

    assertThrows(PrefsValueSealException::class.java) {
      KeyStoreBridge.openPrefsValue(Base64.encodeToString(tampered, Base64.NO_WRAP))
    }
  }

  @Test
  fun `a prefs blob sealed under a previous key fails to open rather than returning garbage`() {
    val sealedUnderOldKey = KeyStoreBridge.sealPrefsValue(randomBytes(32))

    // A brand new vault under the SAME alias -- what a reinstall, or a
    // Keystore reset, looks like from this side.
    KeyStoreBridge.vault = FakeKeyVault()
    KeyStoreBridge.ensurePrefsKek()

    assertThrows(PrefsValueSealException::class.java) {
      KeyStoreBridge.openPrefsValue(sealedUnderOldKey)
    }
  }

  @Test
  fun `a prefs blob too short to hold an IV fails to open rather than returning empty bytes`() {
    val runt = Base64.encodeToString(ByteArray(GCM_IV_LENGTH_BYTES), Base64.NO_WRAP)

    assertThrows(PrefsValueSealException::class.java) {
      KeyStoreBridge.openPrefsValue(runt)
    }
  }

  @Test
  fun `text that is not base64 at all fails to open rather than returning empty bytes`() {
    assertThrows(PrefsValueSealException::class.java) {
      KeyStoreBridge.openPrefsValue("this is not a sealed prefs value at all")
    }
  }

  // ---- no failure may carry the plaintext or the key ---------------------
  //
  // Same class of bug as the op-sqlite leak fixed in `fa927b8`, where a
  // third-party open failure interpolated its config -- including the
  // database key -- into an error message that this app then handed straight
  // to logcat. Asserting only that something threw would not have caught
  // that; these assert on what the message SAYS.
  //
  // The probe is the full `printStackTrace` rendering, causes included,
  // because that is exactly what `Log.e(TAG, msg, throwable)` and a crash
  // reporter both emit -- a payload hidden in a nested cause is just as
  // leaked as one in the top-level message.

  @Test
  fun `a sealPrefsValue failure carries neither the plaintext nor the key`() {
    val secret = "SENSITIVE-PROVIDER-FILTER-com.globe.gcash.android"
    val keyProbes = prefsKeyProbes()

    // A vault with no prefs key at all -- the seal has the plaintext in hand
    // and cannot complete, which is the moment a "helpful" error message
    // would interpolate it.
    KeyStoreBridge.vault = FakeKeyVault()

    val thrown = assertThrows(PrefsValueSealException::class.java) {
      KeyStoreBridge.sealPrefsValue(secret.toByteArray(Charsets.UTF_8))
    }
    assertNoLeak(thrown, secret, keyProbes)
  }

  @Test
  fun `an openPrefsValue failure carries neither the blob, the plaintext, nor the key`() {
    val secret = "SENSITIVE-PROVIDER-FILTER-com.globe.gcash.android"
    val keyProbes = prefsKeyProbes()
    val sealed = KeyStoreBridge.sealPrefsValue(secret.toByteArray(Charsets.UTF_8))

    val blob = Base64.decode(sealed, Base64.NO_WRAP)
    val tampered = blob.copyOf().also { it[blob.size - 1] = (it[blob.size - 1].toInt() xor 0x01).toByte() }
    val tamperedB64 = Base64.encodeToString(tampered, Base64.NO_WRAP)

    val thrown = assertThrows(PrefsValueSealException::class.java) {
      KeyStoreBridge.openPrefsValue(tamperedB64)
    }
    assertNoLeak(thrown, secret, keyProbes + tamperedB64 + sealed)
  }

  // ---- helpers ------------------------------------------------------------

  /**
   * Base64 and hex of the live prefs key's raw bytes. Reading them through
   * the vault seam is the only way to assert an error message doesn't
   * contain the key: a test that guessed at the encoding would pass against
   * a leak in the other one.
   */
  private fun prefsKeyProbes(): List<String> {
    val raw = KeyStoreBridge.vault.getAesKey(KeyStoreBridge.PREFS_KEK_ALIAS).encoded
    return listOf(
      Base64.encodeToString(raw, Base64.NO_WRAP),
      raw.joinToString("") { "%02x".format(it) },
    )
  }

  private fun assertNoLeak(thrown: Throwable, plaintext: String, forbidden: List<String>) {
    val rendered = thrown.stackTraceToString()
    assertFalse(
      "the failure must not carry the plaintext -- this is what logcat would print",
      rendered.contains(plaintext),
    )
    forbidden.forEach {
      assertFalse(
        "the failure must not carry key material or the sealed value itself",
        it.isNotEmpty() && rendered.contains(it),
      )
    }
  }

  private fun capturePublicKey() =
    KeyFactory.getInstance("RSA")
      .generatePublic(X509EncodedKeySpec(KeyStoreBridge.capturePublicKeySpki()))

  private fun randomBytes(size: Int): ByteArray =
    ByteArray(size).also { SecureRandom().nextBytes(it) }
}

/**
 * Test-only mirror of [KeyStoreBridge]'s (private) GCM IV length, so the
 * tampering tests can aim at a specific region of the `iv || ciphertext ||
 * tag` wire format rather than "some byte somewhere".
 */
private const val GCM_IV_LENGTH_BYTES = 12

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
