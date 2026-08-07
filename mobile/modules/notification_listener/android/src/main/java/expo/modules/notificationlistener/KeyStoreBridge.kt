package expo.modules.notificationlistener

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Wraps the Android Keystore for the two keys the encryption design
 * (docs/12-encryption-and-app-lock.md §3, §6) needs on the native side:
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
 * Every function here is deliberately Context-free: none of the Keystore
 * APIs used (`KeyStore`, `KeyGenerator`, `KeyPairGenerator`, `Cipher`, all
 * via the "AndroidKeyStore" provider) need one. StrongBox is requested
 * opportunistically for the device KEK by attempting key generation with
 * it enabled and catching [StrongBoxUnavailableException] on devices that
 * don't have the hardware -- that probe-and-fall-back is what lets this
 * object skip taking a `PackageManager` (and therefore a `Context`) just to
 * check `FEATURE_STRONGBOX_KEYSTORE` up front. The whole attempt is guarded
 * behind an API 28 check because neither `setIsStrongBoxBacked` nor
 * `StrongBoxUnavailableException` exist below that, and this app's minSdk
 * is 24.
 *
 * SECURITY: nothing here may put key material, plaintext, or ciphertext
 * into a log, an exception message, or a stack trace. Every exception path
 * below either lets the original (unmodified) platform exception propagate
 * or throws a new one whose message names the *operation* that failed,
 * never its *input*. Resist "helpfully" adding blob/plaintext detail to an
 * error -- that is exactly what a crash reporter would exfiltrate.
 */
object KeyStoreBridge {

  private const val PROVIDER = "AndroidKeyStore"

  private const val DEVICE_KEK_ALIAS = "peraplano.device_kek"
  private const val CAPTURE_KEY_ALIAS = "peraplano.capture_keypair"

  private const val AES_TRANSFORMATION = "AES/GCM/NoPadding"
  private const val RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"

  private const val GCM_TAG_LENGTH_BITS = 128
  private const val GCM_IV_LENGTH_BYTES = 12

  private const val AUTH_TYPES =
    KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL

  // ---- Device KEK (AES-256-GCM) -----------------------------------------

  /** Idempotent: a second call on an existing key is a no-op, never a rotation. */
  fun ensureDeviceKek() {
    if (keyStore().containsAlias(DEVICE_KEK_ALIAS)) return

    withStrongBoxFallback { strongBox ->
      val builder = KeyGenParameterSpec.Builder(
        DEVICE_KEK_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(true)
        .setUserAuthenticationParameters(0, AUTH_TYPES)
        // Secure default is `true`; deliberately `false` here. See
        // docs/12-encryption-and-app-lock.md §5: enrolling a new biometric
        // already requires the device screen-lock credential, so the
        // attacker `true` would guard against is one already outside this
        // app's threat model (§4) -- while `true` itself would silently
        // destroy the only device-side wrap of the user's DEK the next
        // time they add a fingerprint, a routine settings action. Do NOT
        // "fix" this back to true; the recovery phrase (§5) is the
        // deliberate second path, not this flag.
        .setInvalidatedByBiometricEnrollment(false)
      if (strongBox) builder.setIsStrongBoxBacked(true)

      KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).apply {
        init(builder.build())
        generateKey()
      }
    }
  }

  /** Returns `iv || ciphertext` (GCM tag is part of the trailing ciphertext bytes). */
  fun wrapWithDeviceKek(plaintext: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(AES_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, deviceKekKey())
    // The Keystore-backed GCM cipher generates a fresh random IV on every
    // ENCRYPT_MODE init; it cannot be supplied by the caller (randomized
    // encryption is required by default for Keystore AES/GCM keys). That
    // is exactly what makes two wraps of the same plaintext differ.
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
    cipher.init(Cipher.DECRYPT_MODE, deviceKekKey(), GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
    // A tampered ciphertext or tag fails GCM's authentication check here
    // and doFinal throws AEADBadTagException (a BadPaddingException) --
    // deliberately left unhandled so it propagates as-is rather than being
    // caught and turned into a result.
    return cipher.doFinal(ciphertext)
  }

  /** False once the device KEK has been permanently invalidated (e.g. screen lock removed). */
  fun isDeviceKekUsable(): Boolean {
    val keyStore = keyStore()
    if (!keyStore.containsAlias(DEVICE_KEK_ALIAS)) return false
    return try {
      val key = keyStore.getKey(DEVICE_KEK_ALIAS, null) as SecretKey
      // Keystore surfaces permanent invalidation at Cipher#init, before any
      // data is touched -- this is the standard probe for it.
      Cipher.getInstance(AES_TRANSFORMATION).init(Cipher.ENCRYPT_MODE, key)
      true
    } catch (invalidated: KeyPermanentlyInvalidatedException) {
      false
    }
  }

  // ---- Capture keypair (RSA-2048-OAEP) ----------------------------------

  /** Idempotent: a second call on an existing keypair is a no-op, never a rotation. */
  fun ensureCaptureKeyPair() {
    if (keyStore().containsAlias(CAPTURE_KEY_ALIAS)) return

    val spec = KeyGenParameterSpec.Builder(
      CAPTURE_KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setKeySize(2048)
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
      // Gates the PRIVATE key only. The public half is read via the
      // certificate (see capturePublicKeySpki below), which the Keystore
      // never gates on authentication -- that asymmetry is the entire
      // point of this keypair (§6): the listener seals captures with no
      // user present and no way to authenticate.
      .setUserAuthenticationRequired(true)
      .setUserAuthenticationParameters(0, AUTH_TYPES)
      // Same rationale as the device KEK above: a capture already sealed
      // under the OLD public key becomes permanently undecryptable if the
      // private key is invalidated by biometric re-enrollment, and that
      // re-enrollment already required the device credential -- the same
      // attacker this app doesn't defend against (§4/§5).
      .setInvalidatedByBiometricEnrollment(false)
      .build()

    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, PROVIDER).apply {
      initialize(spec)
      generateKeyPair()
    }
  }

  /** SPKI-encoded public key. Readable with NO authentication -- see class doc. */
  fun capturePublicKeySpki(): ByteArray {
    val certificate = keyStore().getCertificate(CAPTURE_KEY_ALIAS)
      ?: error("capture keypair has not been created")
    return certificate.publicKey.encoded
  }

  /** Requires authentication (the private key is user-auth-gated). */
  fun decryptWithCaptureKey(wrapped: ByteArray): ByteArray {
    val privateKey = keyStore().getKey(CAPTURE_KEY_ALIAS, null) as PrivateKey
    val cipher = Cipher.getInstance(RSA_TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, privateKey)
    return cipher.doFinal(wrapped)
  }

  // ---- shared helpers -----------------------------------------------------

  private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  private fun deviceKekKey(): SecretKey = keyStore().getKey(DEVICE_KEK_ALIAS, null) as SecretKey

  /**
   * Runs [generate] with `strongBox = true` first when the API level even
   * has the concept (28+); falls back to `strongBox = false` when the
   * hardware doesn't have a StrongBox module ([StrongBoxUnavailableException])
   * or the API level is too old for StrongBox to exist at all.
   */
  private fun withStrongBoxFallback(generate: (strongBox: Boolean) -> Unit) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        generate(true)
        return
      } catch (unavailable: StrongBoxUnavailableException) {
        // No StrongBox module on this hardware -- fall through below.
      }
    }
    generate(false)
  }
}
