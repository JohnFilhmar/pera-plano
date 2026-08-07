package expo.modules.notificationlistener

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * The narrow seam between [KeyStoreBridge]'s crypto logic and WHERE the keys
 * it operates on live. This is not a crypto abstraction: every function
 * returns a real `java.security`/`javax.crypto` key object, and
 * [KeyStoreBridge] runs the exact same AES-GCM / RSA-OAEP `Cipher` calls --
 * IV generation, tag handling, all of it -- against whatever this returns,
 * regardless of which implementation supplied it. Only key *creation and
 * retrieval* is behind this interface.
 *
 * [AndroidKeyVault] is the only production implementation, backed by the
 * real "AndroidKeyStore" provider, with every hardware/authentication flag
 * from docs/12-encryption-and-app-lock.md (§3, §5, §6) baked into its OWN
 * key-creation calls -- those flags are not parameters of this interface and
 * are not visible to callers. `FakeKeyVault` (test-only, in
 * `src/test/.../FakeKeyVault.kt`) is a plain-JCE, in-memory implementation
 * used by JVM tests.
 *
 * WHAT THIS BUYS: a JVM test running [KeyStoreBridge] against the fake
 * proves the wrap/unwrap/encrypt/decrypt cipher logic is correct --
 * ciphertext shape, IV freshness, GCM tag verification, idempotence of the
 * `ensure*` functions not rotating a key. All of that is real logic in
 * [KeyStoreBridge] itself, exercised through the exact same code path
 * production uses.
 *
 * WHAT THIS DOES NOT BUY: nothing about whether [AndroidKeyVault] asks the
 * real Keystore for the right thing. A missing `setUserAuthenticationRequired`,
 * a wrong purpose, a forgotten StrongBox request, whether the key is
 * actually hardware-backed, whether it survives biometric re-enrollment,
 * whether it dies when the screen lock is removed -- all of that is
 * INVISIBLE to a test running against the fake, because the fake never
 * constructs a `KeyGenParameterSpec` at all. Those properties are
 * unprovable off a real device by construction (that is the entire point of
 * a secure element) and are covered instead by
 * `src/androidTest/.../KeyStoreBridgeInstrumentedTest.kt` and by the manual
 * on-device checks in the encryption plan (screen-lock removal invalidates
 * the key; biometric enrollment does not; a device with no screen lock
 * cannot create the key at all).
 */
internal interface KeyVault {
  /** Ensures an AES key for [alias] exists, generating one if absent. Idempotent, never rotates. */
  fun getOrCreateAesKey(alias: String)

  /** Ensures an RSA keypair for [alias] exists, generating one if absent. Idempotent, never rotates. */
  fun getOrCreateRsaKeyPair(alias: String)

  /** Fetches an AES key created by [getOrCreateAesKey]. Throws if [alias] doesn't exist. */
  fun getAesKey(alias: String): SecretKey

  /**
   * Fetches an RSA public key with NO authentication required -- this is
   * the entire reason the capture keypair (§6) works, and every
   * implementation of this interface must preserve it.
   */
  fun getPublicKey(alias: String): PublicKey

  /** Fetches an RSA private key. May require authentication in production. */
  fun getPrivateKey(alias: String): PrivateKey

  /** Whether an AES key for [alias] currently exists. */
  fun hasAesKey(alias: String): Boolean
}

/**
 * Production [KeyVault]: every key lives in the real Android Keystore. See
 * [KeyVault]'s class doc for exactly what this buys and doesn't.
 */
internal object AndroidKeyVault : KeyVault {

  private const val PROVIDER = "AndroidKeyStore"

  private const val AUTH_TYPES =
    KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL

  // Guards every "does this alias exist, and if not, generate it"
  // check-then-act below. Without this, the app's startup path and the
  // notification listener's onListenerConnected -- which fire close enough
  // to simultaneously on first run that this is not a theoretical race --
  // can both observe no alias, both generate, and have the second
  // generation silently replace the first. Anything wrapped under the
  // first key in that window, including the DEK's device wrap, becomes
  // permanently unreadable: exactly the failure this whole design exists
  // to prevent. One lock for both key types is deliberate -- key creation
  // happens at most once per alias ever, so there is no real contention to
  // avoid by splitting it.
  private val lock = Any()

  override fun getOrCreateAesKey(alias: String) = synchronized(lock) {
    val keyStore = keyStore()
    if (!keyStore.containsAlias(alias)) {
      withStrongBoxFallback { strongBox ->
        val builder = KeyGenParameterSpec.Builder(
          alias,
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
  }

  override fun getOrCreateRsaKeyPair(alias: String) = synchronized(lock) {
    val keyStore = keyStore()
    if (!keyStore.containsAlias(alias)) {
      withStrongBoxFallback { strongBox ->
        val builder = KeyGenParameterSpec.Builder(
          alias,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
          .setKeySize(2048)
          // Both digests authorized, not just SHA-256: many pre-API-30
          // Keymaster implementations hardcode OAEP's MGF1 digest to SHA-1
          // regardless of what's requested, so KeyStoreBridge's decrypt
          // (and whatever in Task 3 encrypts against the exported public
          // key) explicitly requests MGF1/SHA-1 via OAEPParameterSpec while
          // keeping SHA-256 as OAEP's main digest -- see KeyStoreBridge's
          // RSA_OAEP_PARAMS doc. The Keystore rejects a Cipher.init() whose
          // requested digest wasn't pre-authorized here, so both must be
          // listed even though only one is the "real" digest choice.
          .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
          // Gates the PRIVATE key only. The public half is read via the
          // certificate (see getPublicKey below), which the Keystore never
          // gates on authentication -- that asymmetry is the entire point
          // of this keypair (§6): the listener seals captures with no user
          // present and no way to authenticate.
          .setUserAuthenticationRequired(true)
          .setUserAuthenticationParameters(0, AUTH_TYPES)
          // Same rationale as the device KEK above: a capture already
          // sealed under the OLD public key becomes permanently
          // undecryptable if the private key is invalidated by biometric
          // re-enrollment, and that re-enrollment already required the
          // device credential -- the same attacker this app doesn't defend
          // against (§4/§5).
          .setInvalidatedByBiometricEnrollment(false)
        if (strongBox) builder.setIsStrongBoxBacked(true)

        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, PROVIDER).apply {
          initialize(builder.build())
          generateKeyPair()
        }
      }
    }
  }

  override fun getAesKey(alias: String): SecretKey =
    keyStore().getKey(alias, null) as? SecretKey ?: error("secret key has not been created")

  override fun getPublicKey(alias: String): PublicKey =
    keyStore().getCertificate(alias)?.publicKey ?: error("capture keypair has not been created")

  override fun getPrivateKey(alias: String): PrivateKey =
    keyStore().getKey(alias, null) as? PrivateKey ?: error("capture keypair has not been created")

  override fun hasAesKey(alias: String): Boolean = keyStore().containsAlias(alias)

  private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  /**
   * Runs [generate] with `strongBox = true` first when the API level even
   * has the concept (28+); falls back to `strongBox = false` when the
   * hardware doesn't have a StrongBox module ([StrongBoxUnavailableException])
   * or the API level is too old for StrongBox to exist at all. Requested for
   * BOTH the AES device KEK and the RSA capture keypair -- there is no
   * reason to hardware-back one and not the other, and this fallback means a
   * device without StrongBox is unaffected either way.
   *
   * Probing by attempting generation and catching the exception, rather
   * than checking `PackageManager.FEATURE_STRONGBOX_KEYSTORE` first, is
   * deliberate, not an oversight: a feature check would need a
   * `PackageManager`, and therefore a `Context`, which is exactly what
   * [KeyStoreBridge] (and this vault) are designed to never require.
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
