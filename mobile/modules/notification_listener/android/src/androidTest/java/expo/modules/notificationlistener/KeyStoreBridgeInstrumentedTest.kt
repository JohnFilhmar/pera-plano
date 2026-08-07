package expo.modules.notificationlistener

import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.KeyFactory
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.X509EncodedKeySpec
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
 * (`compileDebugAndroidTestKotlin`). See task-2-report.md for why
 * [wrapThenUnwrapRoundTripsAgainstTheRealKeystore] specifically may need
 * more than a bare `connectedDebugAndroidTest` run to actually pass: the
 * device KEK is configured with a zero-second authentication validity
 * (`setUserAuthenticationParameters(0, ...)`), which the standard Keystore
 * pattern satisfies via a `Cipher` bound into a `BiometricPrompt.CryptoObject`
 * -- calling `Cipher.doFinal()` directly, as this test does, throws
 * `UserNotAuthenticatedException` unless the connected device/emulator's
 * current authentication state already satisfies the key. That is a
 * property of the device at test time, not a bug in KeyStoreBridge.
 *
 * The three checks that need a HUMAN changing phone settings mid-test
 * (screen-lock removal invalidates the key; biometric enrollment does not;
 * a device with no screen lock cannot create the key at all) are not here
 * -- they cannot be automated and are manual items for the plan's on-device
 * verification task instead.
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

  @Test
  fun wrapThenUnwrapRoundTripsAgainstTheRealKeystore() {
    KeyStoreBridge.ensureDeviceKek()
    val plaintext = "instrumented-probe".toByteArray()
    val wrapped = KeyStoreBridge.wrapWithDeviceKek(plaintext)
    val unwrapped = KeyStoreBridge.unwrapWithDeviceKek(wrapped)
    assertArrayEquals(plaintext, unwrapped)
  }

  private fun androidKeyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}
