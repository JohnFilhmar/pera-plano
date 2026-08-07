package expo.modules.notificationlistener

import android.security.keystore.KeyPermanentlyInvalidatedException
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

/**
 * Wraps the two keys the encryption design (docs/12-encryption-and-app-lock.md
 * §3, §6) needs on the native side:
 *
 *  - `DEVICE_KEK_ALIAS`: an AES-256-GCM key that wraps/unwraps the
 *    database's DEK. Gated behind the device screen-lock credential or a
 *    strong biometric (§5).
 *  - `CAPTURE_KEY_ALIAS`: an RSA-2048 keypair whose PUBLIC half must stay
 *    usable with NO authentication at all -- the notification listener
 *    runs at arbitrary hours with no user present and must be able to seal
 *    a capture it can never itself read back (§6). Its PRIVATE half is
 *    gated exactly like the device KEK.
 *
 * WHERE the keys live (real "AndroidKeyStore", vs. an in-memory fake for
 * JVM tests) is behind [vault], a narrow, test-only-swappable seam -- see
 * [KeyVault]'s class doc for exactly what that seam does and does not prove.
 * Everything else -- which Cipher transformation, the `iv || ciphertext`
 * wire format, IV handling, GCM tag verification -- lives here, in real
 * code exercised by both production and the JVM test suite.
 *
 * Every public function here is deliberately Context-free: nothing needs a
 * `Context`, an `Activity`, or a `PackageManager`. That is what lets a
 * capture get sealed by a background service with no UI and no user
 * present.
 *
 * SECURITY: nothing here may put key material, plaintext, or ciphertext
 * into a log, an exception message, or a stack trace. Every exception path
 * below either lets the original (unmodified) platform exception propagate
 * or throws a new one whose message names the *operation* that failed,
 * never its *input*. Resist "helpfully" adding blob/plaintext detail to an
 * error -- that is exactly what a crash reporter would exfiltrate.
 */
object KeyStoreBridge {

  /**
   * Test-only seam: production never reassigns this and always runs against
   * the real Keystore via [AndroidKeyVault]. JVM tests swap in a
   * `FakeKeyVault` (see `src/test/.../FakeKeyVault.kt`) in `@Before`.
   */
  internal var vault: KeyVault = AndroidKeyVault

  // Visible (not private) only so KeyStoreBridgeInstrumentedTest can look
  // the real keys up by alias to inspect their KeyInfo -- the aliases
  // themselves are still not part of the public API.
  internal const val DEVICE_KEK_ALIAS = "peraplano.device_kek"
  internal const val CAPTURE_KEY_ALIAS = "peraplano.capture_keypair"

  private const val AES_TRANSFORMATION = "AES/GCM/NoPadding"

  // Deliberately a bare "OAEPPadding" transformation, NOT
  // "OAEPWithSHA-256AndMGF1Padding" -- the digest names in the latter are
  // exactly what RSA_OAEP_PARAMS below overrides, and Android Keystore has
  // a well-documented history of ignoring/mishandling the MGF1 digest
  // implied by that string on pre-API-30 Keymaster. Relying on the string
  // is the known-broken path; the explicit OAEPParameterSpec is what
  // actually reaches the provider correctly on every supported API level.
  internal const val RSA_TRANSFORMATION = "RSA/ECB/OAEPPadding"

  /**
   * The exact OAEP parameters used both to decrypt here and (by Task 3, on
   * the notification listener side) to encrypt against the exported public
   * key. Main digest SHA-256; MGF1 digest deliberately SHA-1, not SHA-256:
   * many real devices on API 24-29 hardcode Keymaster's MGF1 digest to
   * SHA-1 regardless of what's requested, so asking for SHA-1 explicitly
   * is the only combination verified to work across this app's whole
   * minSdk 24 range. This does not weaken OAEP -- MGF1's collision
   * resistance isn't what OAEP's security rests on.
   *
   * Task 3 MUST encrypt with `Cipher.getInstance(KeyStoreBridge.RSA_TRANSFORMATION)`
   * and this exact spec. A caller that encrypts against the transformation
   * string alone, or with a different OAEPParameterSpec, produces a blob
   * [decryptWithCaptureKey] cannot open -- and that mismatch would only
   * surface on a real device, never in a JVM test.
   */
  internal val RSA_OAEP_PARAMS = OAEPParameterSpec(
    "SHA-256",
    "MGF1",
    MGF1ParameterSpec.SHA1,
    PSource.PSpecified.DEFAULT,
  )

  private const val GCM_TAG_LENGTH_BITS = 128
  private const val GCM_IV_LENGTH_BYTES = 12

  // ---- Device KEK (AES-256-GCM) -----------------------------------------

  /** Idempotent: a second call on an existing key is a no-op, never a rotation. */
  fun ensureDeviceKek() {
    vault.getOrCreateAesKey(DEVICE_KEK_ALIAS)
  }

  /** Returns `iv || ciphertext` (GCM tag is part of the trailing ciphertext bytes). */
  fun wrapWithDeviceKek(plaintext: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(AES_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, vault.getAesKey(DEVICE_KEK_ALIAS))
    // A correct AES/GCM key generates a fresh random IV on every
    // ENCRYPT_MODE init and refuses a caller-supplied one by default
    // (randomized encryption is required unless explicitly disabled, and
    // nothing here disables it). That is exactly what makes two wraps of
    // the same plaintext differ.
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(plaintext)
    return iv + ciphertext
  }

  /** Throws [KeyPermanentlyInvalidatedException] if the device KEK was invalidated. */
  fun unwrapWithDeviceKek(blob: ByteArray): ByteArray {
    require(blob.size > GCM_IV_LENGTH_BYTES) { "wrapped blob is shorter than one IV" }
    val iv = blob.copyOfRange(0, GCM_IV_LENGTH_BYTES)
    val ciphertext = blob.copyOfRange(GCM_IV_LENGTH_BYTES, blob.size)

    val cipher = Cipher.getInstance(AES_TRANSFORMATION)
    cipher.init(
      Cipher.DECRYPT_MODE,
      vault.getAesKey(DEVICE_KEK_ALIAS),
      GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv),
    )
    // A tampered ciphertext or tag fails GCM's authentication check here
    // and doFinal throws AEADBadTagException (a BadPaddingException) --
    // deliberately left unhandled so it propagates as-is rather than being
    // caught and turned into a result.
    return cipher.doFinal(ciphertext)
  }

  /** False once the device KEK has been permanently invalidated (e.g. screen lock removed). */
  fun isDeviceKekUsable(): Boolean {
    if (!vault.hasAesKey(DEVICE_KEK_ALIAS)) return false
    return try {
      // Keystore surfaces permanent invalidation at Cipher#init, before any
      // data is touched -- this is the standard probe for it. Under a
      // plain-JCE fake this exception can never be thrown, so this branch
      // is only exercised on a real device/emulator -- see KeyVault's doc.
      Cipher.getInstance(AES_TRANSFORMATION).init(Cipher.ENCRYPT_MODE, vault.getAesKey(DEVICE_KEK_ALIAS))
      true
    } catch (invalidated: KeyPermanentlyInvalidatedException) {
      false
    }
  }

  // ---- Capture keypair (RSA-2048-OAEP) ----------------------------------

  /** Idempotent: a second call on an existing keypair is a no-op, never a rotation. */
  fun ensureCaptureKeyPair() {
    vault.getOrCreateRsaKeyPair(CAPTURE_KEY_ALIAS)
  }

  /** SPKI-encoded public key. Readable with NO authentication -- see class doc. */
  fun capturePublicKeySpki(): ByteArray = vault.getPublicKey(CAPTURE_KEY_ALIAS).encoded

  /** Requires authentication (the private key is user-auth-gated). */
  fun decryptWithCaptureKey(wrapped: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(RSA_TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, vault.getPrivateKey(CAPTURE_KEY_ALIAS), RSA_OAEP_PARAMS)
    return cipher.doFinal(wrapped)
  }
}
