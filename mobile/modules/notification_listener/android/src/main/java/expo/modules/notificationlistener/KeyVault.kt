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

  /**
   * Ensures an AES key for [alias] exists that requires **no** user
   * authentication to use. Idempotent, never rotates -- same contract as
   * [getOrCreateAesKey] in every respect except that one.
   *
   * This is a **deliberate, documented weakening** relative to every other
   * key in this file, and it is not an oversight to be tidied up. The full
   * argument lives on [AndroidKeyVault.getOrCreateUnauthenticatedAesKey];
   * the short version is that the notification listener must answer "should
   * I capture this?" while the app is locked, so the alternative to a
   * no-auth key is not a stronger key -- it is storing the provider filter
   * in plaintext, which is what this replaces.
   *
   * Separate from [getOrCreateAesKey] rather than a boolean parameter on it,
   * for the same reason [recreateAesKey] is separate: a caller has to name
   * the weaker thing to get the weaker thing. A flag would let a future
   * caller pass `false` by accident and quietly downgrade the device KEK.
   */
  fun getOrCreateUnauthenticatedAesKey(alias: String)

  /**
   * Deletes any existing AES key for [alias] (a no-op if absent) and
   * generates a fresh one, UNCONDITIONALLY -- unlike [getOrCreateAesKey],
   * this ALWAYS rotates. This is the recovery primitive for a key that
   * Android has permanently invalidated (docs/12-encryption-and-app-lock.md
   * §5): the dead alias survives invalidation, and Android requires it be
   * deleted before a live replacement can be generated under the same
   * name. Deliberately a separate, obviously-destructive function rather
   * than folded into [getOrCreateAesKey] -- a function that silently
   * rotated on every call would orphan every wrap ever made under the
   * previous key, including ones still perfectly valid.
   */
  fun recreateAesKey(alias: String)

  /** Ensures an RSA keypair for [alias] exists, generating one if absent. Idempotent, never rotates. */
  fun getOrCreateRsaKeyPair(alias: String)

  /**
   * Deletes [alias] if present and generates a fresh RSA keypair in its place.
   *
   * The counterpart of [recreateAesKey], and destructive in the same way: every
   * capture ever sealed under the old public half becomes permanently
   * unopenable. That is acceptable only where the old PRIVATE half is already
   * gone, which is the one situation this exists for (GAP-059) -- a key
   * invalidated by the user removing the device screen lock.
   */
  fun recreateRsaKeyPair(alias: String)

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
    if (!keyStore().containsAlias(alias)) {
      generateAesKey(alias)
    }
  }

  /**
   * The one key in this file that is usable with **no user authentication
   * at all**, and the security argument for it -- written down here rather
   * than left to be inferred, because the next reader's instinct will be to
   * "fix" it to match [getOrCreateAesKey].
   *
   * **What it is weaker against, honestly:** anyone who can execute code as
   * our UID can read this key and open anything sealed under it. That is a
   * real reduction relative to the DEK's KEK, and it is not being papered
   * over. But it costs nothing that was being defended: that attacker --
   * "malware with root running while the app is unlocked", and its cousin
   * "an attacker who knows the device screen-lock PIN" -- is already
   * **explicitly out of scope** in docs/12-encryption-and-app-lock.md §4.
   * §4 also names the reason the stricter setting buys so little here: code
   * running as our UID can read the plaintext straight out of process memory
   * and never touch the Keystore at all.
   *
   * **What it buys, and this is the part that matters:** the cases §4 puts
   * firmly *in* scope -- an offline filesystem read from a lost or stolen
   * phone, an unencrypted device backup (`adb backup`, OEM sync), forensic
   * extraction. In all three the attacker has bytes and no running process,
   * and a key sealed in the secure element is a key they do not have. §4
   * promises "the database file is ciphertext; the buffer is ciphertext" --
   * this is what lets the listener's own prefs join that list instead of
   * sitting beside them in plaintext, revealing exactly which banks and
   * e-wallets the user holds.
   *
   * **Why the alternative is not "a stronger key":** [PeraPlanoNotificationListenerService]
   * runs whether or not the app is open, at arbitrary hours, with no user
   * present and no `BiometricPrompt` possible (docs §6). It has to answer
   * "should I capture this notification?" from the provider filter on every
   * single delivery. A key gated on authentication would be unreadable at
   * exactly the moment the filter is needed, on every capture that happens
   * while the phone is locked -- which is most of them. So the realistic
   * choice is not "no-auth key vs. auth-bound key", it is **"no-auth key vs.
   * no encryption at all"**, and ciphertext an offline attacker cannot open
   * beats plaintext they can read with `cat`.
   *
   * This is the same asymmetry that already makes §6 work: the capture
   * keypair's PUBLIC half is deliberately usable with no authentication for
   * exactly the same reason. The difference is that a public key gives up
   * nothing by being readable, and this one does -- hence this comment
   * rather than a one-liner.
   *
   * **What is deliberately NOT set here, and why:**
   *  - `setUserAuthenticationParameters` -- meaningless without
   *    `setUserAuthenticationRequired(true)`, and listing it would imply an
   *    auth window exists.
   *  - `setInvalidatedByBiometricEnrollment` -- Keymaster only consults it
   *    for auth-bound keys, so setting it either way here is inert. It is
   *    also unnecessary: this key survives screen-lock removal and biometric
   *    re-enrollment precisely *because* it is not auth-bound, which
   *    incidentally means the prefs it seals need no recovery path at all.
   *
   * `setUserAuthenticationRequired(false)` below is the platform default and
   * is written out explicitly anyway: an omitted call reads as forgotten, and
   * this one has to read as chosen.
   *
   * Kept as its own generator rather than a parameter on [generateAesKey]
   * so that function's invariant stays absolute -- every key it produces is
   * auth-bound, for every caller, always. The handful of duplicated builder
   * lines are the price of that, and a cheap one.
   */
  override fun getOrCreateUnauthenticatedAesKey(alias: String) = synchronized(lock) {
    if (!keyStore().containsAlias(alias)) {
      withStrongBoxFallback { strongBox ->
        val builder = KeyGenParameterSpec.Builder(
          alias,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          // THE ENTIRE POINT OF THIS KEY. Do not "fix" this to true -- see
          // this function's doc. Making it true would not harden the app; it
          // would make the provider filter unreadable while the phone is
          // locked, which is when nearly every capture happens.
          .setUserAuthenticationRequired(false)
        if (strongBox) builder.setIsStrongBoxBacked(true)

        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).apply {
          init(builder.build())
          generateKey()
        }
      }
    }
  }

  override fun recreateAesKey(alias: String) = synchronized(lock) {
    val keyStore = keyStore()
    // deleteEntry on an absent alias would throw on some KeyStore
    // providers -- guarded exactly like every other check-then-act here,
    // under the same lock, so a concurrent getOrCreateAesKey can never
    // observe the alias missing mid-recreate and generate a competing key.
    if (keyStore.containsAlias(alias)) {
      keyStore.deleteEntry(alias)
    }
    generateAesKey(alias)
  }

  /**
   * The actual AES-256-GCM key-generation call, shared by
   * [getOrCreateAesKey] (only when [alias] is absent) and [recreateAesKey]
   * (unconditionally, after deleting any existing entry). Every hardware/
   * authentication flag below is identical regardless of caller -- a
   * recreated key must be exactly as strong as one created on first run,
   * never a weaker "recovery-mode" variant.
   */
  private fun generateAesKey(alias: String) {
    withStrongBoxFallback { strongBox ->
      val builder = KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(true)
        // 10-second validity window, not 0 (per-operation, CryptoObject-
        // bound). CryptoObject binding is textbook-stronger -- the
        // authentication is cryptographically tied to that exact cipher
        // call -- but what it actually defends against is code inside
        // OUR OWN process using this key during the window right after
        // the user authenticates. That code already runs as our UID: it
        // can read the DEK straight out of process memory and never
        // needs the Keystore at all. docs/12-encryption-and-app-lock.md
        // §4 already places "malware with root running while the app is
        // unlocked" out of scope, so CryptoObject binding's marginal
        // protection here is close to zero.
        //
        // Against that: a 0-second/CryptoObject-bound key would force
        // the DEK unwrap to happen inside the native biometric callback,
        // restructuring the JS/native boundary Tasks 6 and 9 are built
        // around -- for a generic (non-CryptoObject) BiometricPrompt
        // app-unlock, which is what §7 specifies, a 0-second window
        // would make EVERY unwrapWithDeviceKek call throw
        // UserNotAuthenticatedException, since Keystore has no way to
        // know a plain authenticate() call was "for" this key. Ten
        // seconds is ample for the single unwrap that follows unlock,
        // and short enough to be useless as an attack window. If the
        // threat model ever tightens to include in-process compromise,
        // the upgrade path is CryptoObject binding (timeout 0) plus
        // restructuring the unwrap to run inside the auth callback.
        .setUserAuthenticationParameters(10, AUTH_TYPES)
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
          // Same 10-second window as the device KEK, and the same
          // reasoning: CryptoObject binding (timeout 0) is
          // textbook-stronger, but it only defends against our own process
          // using this key during the post-auth window -- code that
          // already runs as our UID and can read decrypted captures
          // straight out of process memory without touching the Keystore
          // at all. docs/12-encryption-and-app-lock.md §4 places
          // "malware with root while unlocked" out of scope, so
          // CryptoObject binding's marginal protection here is close to
          // zero, same as for the device KEK.
          //
          // This one matters more in shape, not degree: drainPendingCaptures()
          // runs after an ordinary app unlock and calls decryptWithCaptureKey
          // once per buffered capture -- up to CaptureBuffer.MAX_CAPTURES
          // (500) doFinal calls in one drain. A timeout of 0 would throw
          // UserNotAuthenticatedException on the very first record, the
          // same failure this fixed for the device KEK. Measured: 500
          // sequential RSA-2048/OAEP decrypts of the software (non-Keystore)
          // crypto path average well under 1ms each (~440ms total) on a
          // development machine, so raw computation is not the risk: a full
          // 500-record drain is nowhere near the 10-second window on pure
          // compute time. What that measurement can't cover is the
          // Keystore/Binder IPC round-trip per operation on a real device --
          // the same fundamental gap as everywhere else in this file (see
          // KeyVault's class doc) -- so treat the 10-second margin as
          // generous rather than exact until an on-device timing check
          // confirms a full-buffer drain in practice. If the threat model
          // ever tightens to include in-process compromise, the upgrade
          // path is CryptoObject binding (timeout 0) plus restructuring the
          // drain to decrypt each record inside the auth callback.
          .setUserAuthenticationParameters(10, AUTH_TYPES)
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

  override fun recreateRsaKeyPair(alias: String) = synchronized(lock) {
    val keyStore = keyStore()
    // Guarded exactly like recreateAesKey: deleteEntry on an absent alias
    // throws on some providers.
    if (keyStore.containsAlias(alias)) {
      keyStore.deleteEntry(alias)
    }
    // DELEGATES RATHER THAN COPYING THE SPEC, which is the whole reason this
    // is three lines and recreateAesKey needed a shared generateAesKey helper.
    // The KeyGenParameterSpec above runs to some sixty lines of deliberate
    // choices (both OAEP digests authorized, StrongBox fallback, a 10-second
    // auth window sized for a 500-record drain); a second copy is how a
    // recreated key silently becomes weaker than one created on first run.
    // `synchronized` is reentrant, so re-taking the same lock keeps the delete
    // and the regenerate atomic against a concurrent getOrCreateRsaKeyPair.
    getOrCreateRsaKeyPair(alias)
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
