package expo.modules.notificationlistener

import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import java.security.GeneralSecurityException
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
 *  - `PREFS_KEK_ALIAS`: an AES-256-GCM key that seals the listener's own
 *    sensitive `SharedPreferences` values -- above all the provider filter,
 *    which is a list of the banks and e-wallets the user holds. Unlike the
 *    two above it requires NO authentication at all, in either direction.
 *    That is a deliberate weakening with a written-out argument; see
 *    [ensurePrefsKek] and `AndroidKeyVault.getOrCreateUnauthenticatedAesKey`
 *    before changing it.
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
  internal const val PREFS_KEK_ALIAS = "peraplano.prefs_kek"

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

  /**
   * Deletes the device KEK and generates a fresh replacement,
   * UNCONDITIONALLY -- unlike [ensureDeviceKek], this always rotates. The
   * recovery primitive for docs/12-encryption-and-app-lock.md §5: removing
   * the device screen lock permanently invalidates the device KEK (the
   * alias survives invalidation -- see [isDeviceKekUsable] -- but Android
   * will never again produce a usable key under it), and Android requires
   * the dead alias be deleted before a live replacement can be generated
   * under the same name.
   *
   * Every wrap ever made under the OLD key becomes permanently unopenable
   * the instant this runs. That is expected, not a bug: the caller
   * (`key_manager.ts`'s `rewrapAfterInvalidation`, contract §9) only calls
   * this AFTER already recovering the DEK via the recovery phrase, and
   * immediately re-wraps that same DEK under the fresh key this produces.
   * Calling this without already holding the DEK from the recovery path
   * loses it forever -- this is exactly why it is a separate, obviously
   * destructive primitive rather than something [ensureDeviceKek] does
   * automatically when it finds an invalidated key.
   */
  fun recreateDeviceKek() {
    vault.recreateAesKey(DEVICE_KEK_ALIAS)
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

  // ---- Prefs KEK (AES-256-GCM, NO user authentication) -------------------

  /**
   * Idempotent: a second call on an existing key is a no-op, never a
   * rotation -- exactly like [ensureDeviceKek], and for the same reason
   * (this runs on every app launch, and rotating would orphan every value
   * already sealed under the old key).
   *
   * **This key requires no user authentication, deliberately.** The full
   * argument, including what that gives up and what it buys, is on
   * `AndroidKeyVault.getOrCreateUnauthenticatedAesKey` -- read it before
   * changing anything here. The one-paragraph version: the notification
   * listener has to decide whether to capture a notification while the app
   * is locked and no user is present (docs/12-encryption-and-app-lock.md
   * §6), so a filter sealed under an auth-bound key would be unreadable at
   * precisely the moment it is needed. The realistic alternative is not a
   * stronger key, it is the plaintext `SharedPreferences` this replaces --
   * and per §4 an offline filesystem read (stolen phone, unencrypted
   * backup, forensic extraction) is IN scope while code running as our UID
   * is not.
   *
   * NOTE for whoever wires this up: unlike [ensureCaptureKeyPair] this is
   * not yet called from anywhere in production. Task 2 of the
   * provider-selection plan is what makes `CapturePrefs` use it, and it must
   * call this from BOTH the app-launch path and the listener's
   * `onListenerConnected` -- a fresh install where notification access is
   * granted from Android Settings before the app is ever opened is a real
   * configuration, and it is exactly how the capture keypair's equivalent
   * gap (`bca1bcd`) silently dropped every capture on the 2026-08-10 device
   * session.
   */
  fun ensurePrefsKek() {
    vault.getOrCreateUnauthenticatedAesKey(PREFS_KEK_ALIAS)
  }

  /**
   * Seals [plaintext] into one base64 string of `iv || ciphertext || tag`,
   * suitable for storing as a `SharedPreferences` string value. The GCM tag
   * is the trailing bytes of what `doFinal` returns, so it needs no separate
   * framing.
   *
   * A zero-length [plaintext] seals and opens like any other value. That is
   * load-bearing, not an edge case: an empty provider filter means "allow
   * all" (contract §4), so an implementation that shortcut empty input to
   * `""` would make "the user deselected every app" indistinguishable from
   * "nothing was ever stored".
   *
   * Throws [PrefsValueSealException] on any failure -- see its doc for why
   * it carries no cause.
   */
  fun sealPrefsValue(plaintext: ByteArray): String = payloadFree("sealPrefsValue") {
    val cipher = Cipher.getInstance(AES_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, vault.getAesKey(PREFS_KEK_ALIAS))
    // Same guarantee as wrapWithDeviceKek: an AES/GCM cipher init'd for
    // ENCRYPT_MODE with no caller-supplied GCMParameterSpec mints a fresh
    // random IV itself and refuses a supplied one. Nothing here supplies one.
    val iv = cipher.iv
    Base64.encodeToString(iv + cipher.doFinal(plaintext), Base64.NO_WRAP)
  }

  /**
   * Opens a string produced by [sealPrefsValue].
   *
   * **A tampered blob fails to open; it never opens into something else.**
   * GCM's authentication tag is verified by `doFinal`, which throws
   * `AEADBadTagException` if either the ciphertext or the tag has been
   * altered by so much as one bit -- and this function does not catch that
   * and turn it into a value. A caller gets bytes it sealed, or an
   * exception. There is no third outcome, and specifically no
   * "plausible-looking garbage", which is what an unauthenticated cipher
   * mode (CBC, CTR) would hand back for the same input.
   *
   * Throws [PrefsValueSealException] on any failure: malformed base64, a
   * blob too short to hold an IV and a tag, a missing or replaced key, or a
   * failed tag check. Deliberately one type for all of them -- the caller
   * ([CapturePrefs], Task 2) falls back to the documented default in every
   * case, so distinguishing them would only invite a caller to treat one as
   * recoverable when none of them are.
   */
  fun openPrefsValue(blobB64: String): ByteArray = payloadFree("openPrefsValue") {
    val blob = Base64.decode(blobB64, Base64.NO_WRAP)
    require(blob.size >= GCM_IV_LENGTH_BYTES + GCM_TAG_LENGTH_BITS / 8) {
      "sealed prefs value is too short to hold an IV and a tag"
    }

    val cipher = Cipher.getInstance(AES_TRANSFORMATION)
    cipher.init(
      Cipher.DECRYPT_MODE,
      vault.getAesKey(PREFS_KEK_ALIAS),
      GCMParameterSpec(GCM_TAG_LENGTH_BITS, blob.copyOfRange(0, GCM_IV_LENGTH_BYTES)),
    )
    cipher.doFinal(blob.copyOfRange(GCM_IV_LENGTH_BYTES, blob.size))
  }

  /**
   * Runs [body] and converts ANY failure into a [PrefsValueSealException]
   * naming [operation] and the failed exception's TYPE -- never its message,
   * and never its cause.
   *
   * This is the structural version of the class-level "no payload in an
   * error" rule, and it exists because the softer version -- "the platform's
   * messages happen to be clean, we checked" -- is exactly the reasoning
   * that failed in `fa927b8`, where op-sqlite interpolated its own config
   * (including the database key) into an open failure that this app then
   * handed to `console.error` and therefore to logcat. The lesson recorded
   * there was to redact on OUR side of the boundary rather than trust
   * theirs, and the same applies to every JCE provider, Keystore
   * implementation and OEM base64 decoder this code will run against. The
   * cause chain is dropped rather than attached for the same reason: a
   * `Log.e(TAG, msg, throwable)` prints every nested message, so a chained
   * cause is not a private field, it is a published one.
   *
   * The type name is kept because it says WHICH layer failed --
   * `AEADBadTagException` (tampering or a replaced key) versus
   * `IllegalArgumentException` (a malformed value) is a genuinely different
   * bug to chase on a real device -- and a Java class name cannot contain a
   * secret.
   *
   * Catches `Exception`, not `Throwable`: an `Error` (OOM, linkage) is not
   * this layer's to relabel.
   */
  private fun <T> payloadFree(operation: String, body: () -> T): T =
    try {
      body()
    } catch (failure: Exception) {
      val type = failure.javaClass.simpleName.ifEmpty { failure.javaClass.name }
      throw PrefsValueSealException(operation, type)
    }
}

/**
 * The only exception [KeyStoreBridge.sealPrefsValue] and
 * [KeyStoreBridge.openPrefsValue] ever throw.
 *
 * Carries the operation name and the failed exception's class name, and
 * nothing else: no plaintext, no key material, no sealed blob, and no cause
 * whose own message could smuggle any of those in. See
 * `KeyStoreBridge.payloadFree` for why the cause is dropped rather than
 * chained.
 *
 * Not constructible outside this module -- its constructor is `internal`, so
 * nothing can fabricate one carrying a message of its own choosing.
 */
class PrefsValueSealException internal constructor(
  operation: String,
  failureType: String,
) : GeneralSecurityException("$operation failed ($failureType)")
