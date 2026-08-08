package expo.modules.notificationlistener

import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * Per-record asymmetric envelope for the notification-capture buffer
 * (docs/12-encryption-and-app-lock.md §6).
 *
 * The notification listener runs at arbitrary hours with no user present and
 * no DEK in memory -- it can only ever SEAL a capture, never open one back
 * up. [seal] needs nothing but the capture keypair's PUBLIC half, which is
 * readable with NO authentication (see [KeyStoreBridge.capturePublicKeySpki]),
 * so it never requires anything an unattended background service couldn't
 * already have. [open] needs the PRIVATE half, which IS authentication-gated
 * -- it only ever succeeds after the user has unlocked the app.
 *
 * Wire format for one sealed line, before base64:
 *
 *   wrappedAesKeyLength (2 bytes, big-endian) || wrappedAesKey || iv (12 bytes) || ciphertext+tag
 *
 * A fresh AES-256 key is generated for every single call to [seal] and used
 * to encrypt the record's JSON under AES-256-GCM with a fresh 96-bit IV
 * (also new per call -- see [seal]'s doc for why that falls out of the
 * fresh key for free). That AES key is then wrapped under the capture
 * keypair's RSA-2048 public key via RSA-OAEP, using the exact transformation
 * and parameters [KeyStoreBridge] decrypts with -- see [KeyStoreBridge.RSA_OAEP_PARAMS]'s
 * doc for why a mismatch here would only ever surface on a real device. The
 * two-byte length prefix exists because a wrapped-key's length is a property
 * of the RSA key size, not something this wire format should have to fix --
 * a future key-size change needs a different number there, not a new format.
 *
 * The whole concatenation is base64-encoded with NO line wrapping
 * ([Base64.NO_WRAP]) so the result is always safe to use as one line of
 * [CaptureBuffer]'s newline-delimited file -- base64's alphabet contains no
 * newline character, so this holds regardless of what raw bytes a hostile
 * notification's text contains.
 *
 * SECURITY: exactly like [KeyStoreBridge], nothing here may put plaintext,
 * key material, or ciphertext into a log or exception message.
 */
object CaptureEnvelope {

  private const val AES_KEY_SIZE_BITS = 256
  private const val AES_TRANSFORMATION = "AES/GCM/NoPadding"
  private const val GCM_TAG_LENGTH_BITS = 128
  private const val GCM_IV_LENGTH_BYTES = 12
  private const val LENGTH_HEADER_BYTES = 2

  /**
   * Seals [record] under [publicKeySpki] -- an X.509-encoded RSA public key,
   * exactly what [KeyStoreBridge.capturePublicKeySpki] returns -- into one
   * base64 line.
   *
   * A brand-new [KeyGenerator]-issued AES key on every call, and a brand-new
   * IV on every call -- the second falls out of the first for free. A real
   * JCE AES/GCM `Cipher`, `init`'d for `ENCRYPT_MODE` with no caller-supplied
   * `GCMParameterSpec`, generates a fresh random IV internally and refuses a
   * caller-supplied one by default; the only way to defeat that would be to
   * explicitly construct and pass a `GCMParameterSpec` here, which nothing
   * below does. Reusing an IV across two GCM encryptions under the same key
   * is catastrophic (it leaks the XOR of the two plaintexts and breaks
   * authentication) -- generating a fresh AES key per record, on top of the
   * fresh IV the cipher already guarantees, means even a hypothetical IV
   * collision would still land under two DIFFERENT keys.
   */
  fun seal(record: CaptureRecord, publicKeySpki: ByteArray): String {
    val plaintext = record.toJson().toString().toByteArray(Charsets.UTF_8)

    val aesKey = KeyGenerator.getInstance("AES").apply {
      init(AES_KEY_SIZE_BITS, SecureRandom())
    }.generateKey()

    val aesCipher = Cipher.getInstance(AES_TRANSFORMATION)
    aesCipher.init(Cipher.ENCRYPT_MODE, aesKey)
    val iv = aesCipher.iv
    val ciphertext = aesCipher.doFinal(plaintext)

    val publicKey = KeyFactory.getInstance("RSA")
      .generatePublic(X509EncodedKeySpec(publicKeySpki))
    val rsaCipher = Cipher.getInstance(KeyStoreBridge.RSA_TRANSFORMATION)
    rsaCipher.init(Cipher.ENCRYPT_MODE, publicKey, KeyStoreBridge.RSA_OAEP_PARAMS)
    val wrappedAesKey = rsaCipher.doFinal(aesKey.encoded)

    val lengthHeader = byteArrayOf(
      ((wrappedAesKey.size ushr 8) and 0xFF).toByte(),
      (wrappedAesKey.size and 0xFF).toByte(),
    )
    val line = lengthHeader + wrappedAesKey + iv + ciphertext
    return Base64.encodeToString(line, Base64.NO_WRAP)
  }

  /**
   * Opens one sealed [line] back into a [CaptureRecord]. Requires the
   * capture keypair's authentication-gated private key
   * ([KeyStoreBridge.decryptWithCaptureKey]) -- this only ever succeeds
   * after the user has unlocked the app.
   *
   * Throws on ANY failure: malformed base64, a line too short for even the
   * length header, a declared wrapped-key length that overruns the line, an
   * RSA-OAEP unwrap that fails (wrong/rotated key, or corrupt bytes -- OAEP's
   * padding check cannot tell those apart, which is correct: both are
   * equally unrecoverable), or a GCM tag mismatch on the AES layer.
   * [CaptureBuffer] is the layer that decides what "throws" means for a
   * given line (skip-and-count for all of the above); this function never
   * swallows an error itself, so it never hides which layer failed from
   * whoever is debugging a real device issue.
   *
   * [UserNotAuthenticatedException] is deliberately NOT caught here -- it
   * is not a property of the line at all (the line may be perfectly fine
   * and fully recoverable), it means the caller invoked this before the
   * private key's authentication window was open. It propagates unchanged,
   * exactly like every other failure, and [CaptureBuffer.drain] is what
   * gives it special handling so an early call never costs a byte.
   */
  fun open(line: String): CaptureRecord {
    val bytes = Base64.decode(line, Base64.NO_WRAP)
    require(bytes.size > LENGTH_HEADER_BYTES) { "sealed line shorter than its own length header" }

    val wrappedKeyLength =
      ((bytes[0].toInt() and 0xFF) shl 8) or (bytes[1].toInt() and 0xFF)
    val wrappedKeyStart = LENGTH_HEADER_BYTES
    val wrappedKeyEnd = wrappedKeyStart + wrappedKeyLength
    val ivEnd = wrappedKeyEnd + GCM_IV_LENGTH_BYTES
    require(bytes.size > ivEnd) { "sealed line shorter than its declared key length plus IV" }

    val wrappedAesKey = bytes.copyOfRange(wrappedKeyStart, wrappedKeyEnd)
    val iv = bytes.copyOfRange(wrappedKeyEnd, ivEnd)
    val ciphertext = bytes.copyOfRange(ivEnd, bytes.size)

    val aesKeyBytes = KeyStoreBridge.decryptWithCaptureKey(wrappedAesKey)
    val aesKey = SecretKeySpec(aesKeyBytes, "AES")

    val aesCipher = Cipher.getInstance(AES_TRANSFORMATION)
    aesCipher.init(Cipher.DECRYPT_MODE, aesKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
    val plaintext = aesCipher.doFinal(ciphertext)

    return CaptureRecord.fromJson(JSONObject(String(plaintext, Charsets.UTF_8)))
  }
}
