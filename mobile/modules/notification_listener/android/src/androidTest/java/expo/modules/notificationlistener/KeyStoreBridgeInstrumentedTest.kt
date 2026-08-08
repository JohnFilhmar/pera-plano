package expo.modules.notificationlistener

import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.KeyFactory
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The half of KeyStoreBridge's contract that a JVM test running against
 * [FakeKeyVault] cannot see -- see [KeyVault]'s class doc. These run
 * against the REAL "AndroidKeyStore" (KeyStoreBridge's `vault` is left at
 * its default [AndroidKeyVault]; nothing here swaps it), on a real device
 * or emulator, via:
 *
 * ```
 * .\gradlew.bat :notification_listener:connectedDebugAndroidTest
 * ```
 *
 * NOT run as part of this task -- confirmed to compile only
 * (`compileDebugAndroidTestKotlin`).
 *
 * The three checks that need a HUMAN changing phone settings mid-test
 * (screen-lock removal invalidates the key; biometric enrollment does not;
 * a device with no screen lock cannot create the key at all) are not here --
 * they cannot be automated and are manual items for the
 * plan's on-device verification task instead (see task-2-report.md).
 */
@RunWith(AndroidJUnit4::class)
class KeyStoreBridgeInstrumentedTest {

  @Test
  fun deviceKekIsCreatedWithExpectedKeystoreProperties() {
    KeyStoreBridge.ensureDeviceKek()

    val key = androidKeyStore().getKey(KeyStoreBridge.DEVICE_KEK_ALIAS, null) as SecretKey
    val keyInfo = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
      .getKeySpec(key, KeyInfo::class.java) as KeyInfo

    assertTrue("device KEK must require authentication", keyInfo.isUserAuthenticationRequired)
    assertFalse(
      "biometric re-enrollment must NOT invalidate the device KEK -- see " +
        "docs/12-encryption-and-app-lock.md §5",
      keyInfo.isInvalidatedByBiometricEnrollment,
    )
    assertEquals(256, keyInfo.keySize)
    assertTrue((keyInfo.purposes and KeyProperties.PURPOSE_ENCRYPT) != 0)
    assertTrue((keyInfo.purposes and KeyProperties.PURPOSE_DECRYPT) != 0)
  }

  @Test
  fun captureKeyPairIsCreatedWithExpectedKeystoreProperties() {
    KeyStoreBridge.ensureCaptureKeyPair()

    val privateKey = androidKeyStore().getKey(KeyStoreBridge.CAPTURE_KEY_ALIAS, null) as PrivateKey
    val keyInfo = KeyFactory.getInstance(privateKey.algorithm, "AndroidKeyStore")
      .getKeySpec(privateKey, KeyInfo::class.java) as KeyInfo

    assertTrue("capture private key must require authentication", keyInfo.isUserAuthenticationRequired)
    assertFalse(
      "biometric re-enrollment must NOT invalidate the capture keypair -- " +
        "otherwise every capture already sealed under the old public key " +
        "becomes permanently unreadable",
      keyInfo.isInvalidatedByBiometricEnrollment,
    )
    assertEquals(2048, keyInfo.keySize)
  }

  @Test
  fun isDeviceKekUsableIsTrueAfterEnsureDeviceKek() {
    KeyStoreBridge.ensureDeviceKek()
    assertTrue(KeyStoreBridge.isDeviceKekUsable())
  }

  @Test
  fun capturePublicKeyIsReadableWithNoAuthentication() {
    KeyStoreBridge.ensureCaptureKeyPair()

    // No BiometricPrompt / device-credential flow happens anywhere above --
    // if this line ever required authentication, the notification listener
    // could never seal a capture with no user present (docs §6). That
    // asymmetry is the property this test exists to pin.
    val spki = KeyStoreBridge.capturePublicKeySpki()
    val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(spki))
    assertEquals("RSA", publicKey.algorithm)
  }

  /**
   * Inverted from an earlier draft that called `wrapWithDeviceKek` and
   * expected it to SUCCEED with no prior authentication. It doesn't: the
   * device KEK requires a qualifying authentication within the last 10
   * seconds (`setUserAuthenticationParameters(10, ...)`), and no
   * `BiometricPrompt` flow happens anywhere in this process, so no such
   * authentication exists. That earlier version was a test that was
   * EXPECTED to fail whenever it happened to run against an unauthenticated
   * session -- a red test people learn to ignore, which then hides a real
   * regression behind the same red.
   *
   * This is NOT proving that every operation needs its own fresh prompt --
   * with a 10-second window (chosen deliberately over per-operation
   * `CryptoObject` binding; see the comment on `setUserAuthenticationParameters`
   * in `KeyVault.kt` for why), a `wrapWithDeviceKek`/`unwrapWithDeviceKek`
   * call made shortly after a real unlock would succeed with no special
   * binding at all. What this test proves is narrower and still the whole
   * security claim of the device wrap (docs §5): with NO recent
   * authentication of ANY kind, the key is unusable. A device KEK usable
   * without ever authenticating would be no better than no KEK at all.
   *
   * The fully-authenticated round trip is exercised by the ordinary app
   * unlock flow itself (§7) rather than needing a bespoke on-device check --
   * see task-2-report.md.
   */
  @Test
  fun unauthenticatedWrapWithDeviceKekThrowsUserNotAuthenticated() {
    KeyStoreBridge.ensureDeviceKek()

    assertThrows(UserNotAuthenticatedException::class.java) {
      KeyStoreBridge.wrapWithDeviceKek("instrumented-probe".toByteArray())
    }
  }

  /**
   * The only thing that can prove RSA-OAEP actually round-trips against the
   * real Keystore rather than merely being accepted at key-creation time.
   * This exists because Android Keystore has a well-documented history of
   * OAEP MGF1-digest inconsistency on pre-API-30 Keymaster (see
   * KeyStoreBridge.RSA_OAEP_PARAMS's doc) -- a wrong combination here would
   * make every capture seal fail silently on exactly the budget phones this
   * product targets, and neither the JVM tests (plain JCE has no such
   * quirk) nor a KeyInfo-only inspection would ever catch it.
   *
   * Unlike the device KEK, this uses the REAL exported public key (via
   * capturePublicKeySpki, exactly as Task 3's capture-sealing code will) to
   * encrypt, so it also exercises the encrypt-side contract, not just
   * decrypt.
   *
   * NOTE: the capture private key is configured with the same
   * per-operation authentication as the device KEK
   * (`setUserAuthenticationParameters(0, ...)`), so this call is also a
   * candidate to throw `UserNotAuthenticatedException` depending on
   * exactly when Keystore validates OAEP digest authorization relative to
   * the auth gate on the connected device. If it throws that instead of
   * completing, that is a real, useful data point for Task 11's on-device
   * run -- it does not by itself mean the OAEP fix is wrong, only that this
   * assertion needs a preceding authenticated session (or a narrower
   * variant that stops at `Cipher.init()`, where Keystore is documented to
   * validate the requested digest/purpose regardless of auth state) to
   * isolate the two failure modes.
   */
  @Test
  fun capturePublicEncryptThenPrivateDecryptRoundTripsAgainstTheRealKeystore() {
    KeyStoreBridge.ensureCaptureKeyPair()

    val spki = KeyStoreBridge.capturePublicKeySpki()
    val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(spki))

    val plaintext = "instrumented-probe".toByteArray()
    val cipher = Cipher.getInstance(KeyStoreBridge.RSA_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, publicKey, KeyStoreBridge.RSA_OAEP_PARAMS)
    val wrapped = cipher.doFinal(plaintext)

    val unwrapped = KeyStoreBridge.decryptWithCaptureKey(wrapped)
    assertArrayEquals(plaintext, unwrapped)
  }

  /**
   * The on-device counterpart to a mutation the JVM suite structurally
   * cannot catch, which is why this test lives here rather than beside
   * `KeyStoreBridgeTest`'s other `recreateAesKey` cases.
   *
   * `KeyVault.recreateAesKey`'s contract is "delete the alias if present,
   * THEN generate a fresh key" -- the delete is what makes it actually
   * rotate rather than a no-op. [FakeKeyVault] has no separate delete step
   * to omit at all (see its doc), so a mutation that removes
   * [AndroidKeyVault.recreateAesKey]'s `keyStore.deleteEntry(alias)` call
   * is INVISIBLE to every JVM test, including the ones this fix round
   * added -- confirmed directly: removing that one line left all 50 JVM
   * tests green. Only the real Keystore can show the difference between
   * "deleted then regenerated" and "regenerated over the same live key,"
   * because only the real Keystore has a persistent entry for `deleteEntry`
   * to remove in the first place.
   *
   * Why this matters beyond a coverage gap: without the delete,
   * `recreateDeviceKek()` would silently keep serving the SAME dead key
   * under the alias. `rewrapAfterInvalidation` (contract §9) would recover
   * the DEK via the recovery phrase, call this, get the same invalidated
   * key back, and fail to wrap under it again -- the user re-enters their
   * twelve words, forever, with no way out. That is the exact failure the
   * mandatory recovery phrase (docs/12-encryption-and-app-lock.md §5)
   * exists to prevent.
   *
   * Like [unauthenticatedWrapWithDeviceKekThrowsUserNotAuthenticated] and
   * [capturePublicEncryptThenPrivateDecryptRoundTripsAgainstTheRealKeystore],
   * the wrap/unwrap calls here depend on running inside the device KEK's
   * ~10-second post-authentication window -- see this file's class doc:
   * NOT run as part of this task, confirmed to compile only. A run outside
   * that window would throw `UserNotAuthenticatedException` on the very
   * first `wrapWithDeviceKek` call, which is a session-timing fact about
   * whoever runs `connectedDebugAndroidTest`, not evidence against
   * `recreateAesKey`'s delete-then-generate behavior itself.
   */
  @Test
  fun recreateDeviceKekRotatesTheKeyAgainstTheRealKeystore() {
    KeyStoreBridge.ensureDeviceKek()
    val wrappedUnderOldKey = KeyStoreBridge.wrapWithDeviceKek("instrumented-probe".toByteArray())

    KeyStoreBridge.recreateDeviceKek()

    // The discriminating assertion: without deleteEntry, the real Keystore
    // keeps serving the OLD key under the alias and this would NOT throw.
    assertThrows(Exception::class.java) {
      KeyStoreBridge.unwrapWithDeviceKek(wrappedUnderOldKey)
    }

    // The replacement key is fully usable -- this is not merely destructive.
    val wrappedUnderNewKey = KeyStoreBridge.wrapWithDeviceKek("instrumented-probe".toByteArray())
    val unwrapped = KeyStoreBridge.unwrapWithDeviceKek(wrappedUnderNewKey)
    assertArrayEquals("instrumented-probe".toByteArray(), unwrapped)
  }

  private fun androidKeyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}
