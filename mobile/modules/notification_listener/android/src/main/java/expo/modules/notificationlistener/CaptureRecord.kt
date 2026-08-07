package expo.modules.notificationlistener

import org.json.JSONObject

/**
 * One captured status-bar notification.
 *
 * The field names ARE the JS `RawCapture` field names from interface contract
 * §4 — the same keys are used for the disk buffer (toJson) and the bridge
 * return value (toMap), so a capture has one shape everywhere and JS never
 * has to translate.
 *
 * The property every serialization below must hold: a null field (e.g. no
 * subText/bigText on a notification) must come back as null, not the string
 * "null" and not an empty string. org.json is the sharpest trap here --
 * `JSONObject.put(key, null)` silently drops the key, and `getString` on a
 * JSON null returns the literal 4-character string "null" -- so both toJson
 * and fromJson handle the JSONObject.NULL sentinel explicitly instead of
 * relying on Kotlin's `?:` doing the right thing by accident.
 */
data class CaptureRecord(
  val id: String,
  val packageName: String,
  val title: String?,
  val text: String?,
  val subText: String?,
  val bigText: String?,
  val postedAt: Long,
  val capturedAt: Long,
) {

  fun toJson(): JSONObject = JSONObject().apply {
    put(KEY_ID, id)
    put(KEY_PACKAGE_NAME, packageName)
    put(KEY_TITLE, title ?: JSONObject.NULL)
    put(KEY_TEXT, text ?: JSONObject.NULL)
    put(KEY_SUB_TEXT, subText ?: JSONObject.NULL)
    put(KEY_BIG_TEXT, bigText ?: JSONObject.NULL)
    put(KEY_POSTED_AT, postedAt)
    put(KEY_CAPTURED_AT, capturedAt)
  }

  fun toMap(): Map<String, Any?> = mapOf(
    KEY_ID to id,
    KEY_PACKAGE_NAME to packageName,
    KEY_TITLE to title,
    KEY_TEXT to text,
    KEY_SUB_TEXT to subText,
    KEY_BIG_TEXT to bigText,
    KEY_POSTED_AT to postedAt,
    KEY_CAPTURED_AT to capturedAt,
  )

  companion object {
    const val KEY_ID = "id"
    const val KEY_PACKAGE_NAME = "packageName"
    const val KEY_TITLE = "title"
    const val KEY_TEXT = "text"
    const val KEY_SUB_TEXT = "subText"
    const val KEY_BIG_TEXT = "bigText"
    const val KEY_POSTED_AT = "postedAt"
    const val KEY_CAPTURED_AT = "capturedAt"

    fun fromJson(json: JSONObject): CaptureRecord = CaptureRecord(
      id = json.getString(KEY_ID),
      packageName = json.getString(KEY_PACKAGE_NAME),
      title = json.nullableString(KEY_TITLE),
      text = json.nullableString(KEY_TEXT),
      subText = json.nullableString(KEY_SUB_TEXT),
      bigText = json.nullableString(KEY_BIG_TEXT),
      postedAt = json.getLong(KEY_POSTED_AT),
      capturedAt = json.getLong(KEY_CAPTURED_AT),
    )
  }
}

/** JSON null stays Kotlin null; an empty string stays an empty string. */
private fun JSONObject.nullableString(key: String): String? =
  if (isNull(key)) null else getString(key)
