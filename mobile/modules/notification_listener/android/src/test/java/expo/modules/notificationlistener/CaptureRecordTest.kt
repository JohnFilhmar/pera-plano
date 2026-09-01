package expo.modules.notificationlistener

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * CaptureRecord is the one shape a captured notification takes across three
 * hops: the disk buffer's JSON, the JS-bridge map, and (per contract) an
 * android.os.Bundle event payload. These tests focus on the property that
 * decides the task: null must survive every hop distinctly from empty
 * string, and the eight JS `RawCapture` key names (interface contract §4)
 * must be exact.
 *
 * toBundle() is implemented per the contract but is NOT unit-tested here.
 * android.os.Bundle has no real in-memory backing on the plain JVM test
 * classpath used by this module (no Robolectric, per Task 1/M1a decision) --
 * calling its instance methods throws "not mocked" at runtime. See the
 * companion report for the empirical probe that confirmed this.
 */
class CaptureRecordTest {

  private val contractKeys = setOf(
    "id", "packageName", "title", "text", "subText", "bigText", "postedAt", "capturedAt",
    // Migration 018. The notification SLOT this arrived in, which is what tells
    // an edit of an already-captured notification apart from a second, genuine
    // transaction -- the delivery id cannot, because it is fresh every time.
    "notificationKey",
  )

  private fun sample(
    title: String? = "GCash",
    text: String? = "You have sent PHP 500.00",
    subText: String? = "Wallet",
    bigText: String? = "You have sent PHP 500.00 to JUAN D. Ref. 1234567",
    postedAt: Long = 1_754_524_800_000L,
    capturedAt: Long = 1_754_524_800_321L,
    notificationKey: String? = "com.globe.gcash.android|0|null|0",
  ) = CaptureRecord(
    id = "3f1c6a2e-9b47-4c1d-8f52-77a0d1b6e904",
    packageName = "com.globe.gcash.android",
    title = title,
    text = text,
    subText = subText,
    bigText = bigText,
    postedAt = postedAt,
    capturedAt = capturedAt,
    notificationKey = notificationKey,
  )

  // ---------------------------------------------------------------------
  // toJson / fromJson round trip
  // ---------------------------------------------------------------------

  @Test
  fun `json round trip preserves every field`() {
    val original = sample()
    val restored = CaptureRecord.fromJson(JSONObject(original.toJson().toString()))
    assertEquals(original, restored)
  }

  @Test
  fun `json round trip preserves nulls as real null, not the string literal null`() {
    val original = sample(title = null, subText = null, bigText = null)
    val json = JSONObject(original.toJson().toString())

    // getString() on a JSON null returns the four-character string "null" in
    // org.json -- isNull() plus checking the raw stored sentinel is the only
    // way to prove this is a genuine JSON null and not that trap.
    assertTrue(json.isNull("title"))
    assertTrue(json.isNull("subText"))
    assertTrue(json.isNull("bigText"))
    assertEquals(JSONObject.NULL, json.get("title"))

    val restored = CaptureRecord.fromJson(json)
    assertNull(restored.title)
    assertNull(restored.subText)
    assertNull(restored.bigText)
    assertEquals("You have sent PHP 500.00", restored.text)
  }

  @Test
  fun `json round trip keeps empty strings distinct from null for every nullable field`() {
    val original = sample(title = "", text = "", subText = "", bigText = "")
    val json = JSONObject(original.toJson().toString())

    for (key in listOf("title", "text", "subText", "bigText")) {
      assertFalse("$key should not be JSON null", json.isNull(key))
      assertEquals("", json.getString(key))
    }

    val restored = CaptureRecord.fromJson(json)
    assertEquals("", restored.title)
    assertEquals("", restored.text)
    assertEquals("", restored.subText)
    assertEquals("", restored.bigText)
  }

  @Test
  fun `toJson emits exactly the eight contract keys, no more, no less`() {
    val json = sample().toJson()
    val keys = mutableSetOf<String>()
    json.keys().forEachRemaining { keys.add(it) }
    assertEquals(contractKeys, keys)
  }

  @Test
  fun `json round trip keeps postedAt and capturedAt at full epoch-millisecond magnitude`() {
    // Int.MAX_VALUE is ~2.1e9; these fixtures are ~1.75e12 -- large enough
    // that a silent truncation to Int corrupts the value outright rather
    // than merely losing low bits.
    assertTrue(1_754_524_800_000L > Int.MAX_VALUE.toLong())

    val original = sample(postedAt = 1_754_524_800_000L, capturedAt = 1_754_524_800_321L)
    val json = original.toJson()
    assertEquals(1_754_524_800_000L, json.getLong("postedAt"))
    assertEquals(1_754_524_800_321L, json.getLong("capturedAt"))

    val restored = CaptureRecord.fromJson(JSONObject(json.toString()))
    assertEquals(1_754_524_800_000L, restored.postedAt)
    assertEquals(1_754_524_800_321L, restored.capturedAt)
  }

  @Test
  fun `json round trip survives quotes, newlines, backslashes, and peso signs`() {
    val hostile = "Sent \"₱1,000.00\" to JUAN D.\nRef\\No: 12/34\\56 -- ₱ balance left"
    val original = sample(bigText = hostile, text = hostile)
    val restored = CaptureRecord.fromJson(JSONObject(original.toJson().toString()))
    assertEquals(hostile, restored.bigText)
    assertEquals(hostile, restored.text)
  }

  // ---------------------------------------------------------------------
  // toMap (JS bridge return value for drainPendingCaptures)
  // ---------------------------------------------------------------------

  @Test
  fun `toMap uses the exact RawCapture key names from interface contract section 4`() {
    val map = sample().toMap()
    assertEquals(contractKeys, map.keys)
    assertEquals("3f1c6a2e-9b47-4c1d-8f52-77a0d1b6e904", map["id"])
    assertEquals("com.globe.gcash.android", map["packageName"])
    assertEquals(1_754_524_800_000L, map["postedAt"])
    assertEquals(1_754_524_800_321L, map["capturedAt"])
  }

  @Test
  fun `toMap carries real null through, distinct from empty string, for every nullable field`() {
    val nulls = sample(title = null, text = null, subText = null, bigText = null).toMap()
    for (key in listOf("title", "text", "subText", "bigText")) {
      assertTrue("missing key $key", nulls.containsKey(key))
      assertNull(nulls[key])
    }

    val empties = sample(title = "", text = "", subText = "", bigText = "").toMap()
    for (key in listOf("title", "text", "subText", "bigText")) {
      assertEquals("", empties[key])
    }
  }

  @Test
  fun `toMap preserves hostile characters without escaping or corruption`() {
    val hostile = "\"quoted\"\nline two\\slash ₱99.50"
    val map = sample(subText = hostile).toMap()
    assertEquals(hostile, map["subText"])
  }

  // ---------------------------------------------------------------------
  // notificationKey -- migration 018
  // ---------------------------------------------------------------------

  @Test
  fun `notificationKey survives the json round trip`() {
    val slot = "com.bpi.ng.app|17|tag|0"
    val restored = CaptureRecord.fromJson(sample(notificationKey = slot).toJson())
    assertEquals(slot, restored.notificationKey)
  }

  @Test
  fun `a null notificationKey round trips as null, never the string null`() {
    val restored = CaptureRecord.fromJson(sample(notificationKey = null).toJson())
    assertNull(restored.notificationKey)
  }

  @Test
  fun `a record buffered before this field existed still deserializes`() {
    // Records written by an older build carry no `notificationKey` key at all.
    // Throwing on them would strand every capture the buffer is holding from
    // before the upgrade -- the one thing the buffer exists to prevent.
    val legacy = sample().toJson()
    legacy.remove("notificationKey")

    val restored = CaptureRecord.fromJson(legacy)

    assertNull(restored.notificationKey)
    assertEquals("com.globe.gcash.android", restored.packageName)
  }
}
