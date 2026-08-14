package expo.modules.notificationlistener

import android.content.Context
import android.content.SharedPreferences

/**
 * The listener's two user-facing switches -- the global capture pause and the
 * provider allowlist -- plus the two health facts the JS side reports back
 * (`serviceConnected`, `lastCaptureAt`, interface contract §4).
 *
 * All four live in [SharedPreferences] rather than in memory for one reason:
 * Android starts `PeraPlanoNotificationListenerService` on its own schedule,
 * in a process that may have been created purely to host it, long after the
 * process that set these values was killed. The service has to be able to
 * answer "should I capture this?" with no JS running and no user present, so
 * the answer has to already be on disk. A field on a singleton would be
 * silently reset to the default on every process restart -- and the visible
 * symptom would be the app quietly capturing from providers the user
 * de-selected, which is a privacy regression, not a glitch.
 *
 * TWO OF THE FOUR ARE SEALED AT REST, TWO ARE NOT, and the split is
 * deliberate (provider-selection plan Task 2 rule 1):
 *
 *  - **Sealed** under the prefs KEK ([KeyStoreBridge.sealPrefsValue]):
 *    `provider_filter`, because it names every bank and e-wallet the user
 *    holds, and `last_capture_at`, because it is a behavioural fact about
 *    when they last moved money. docs/12-encryption-and-app-lock.md §4 places
 *    "a malicious app reading app-private storage on a rooted device" IN
 *    scope and promises "the database file is ciphertext; the buffer is
 *    ciphertext" -- until this task these two sat beside them in plaintext,
 *    readable with `cat shared_prefs/peraplano_capture_prefs.xml`.
 *  - **Plaintext:** `capture_enabled` and `listener_connected`. Two booleans
 *    that reveal nothing about anyone's finances. Sealing them would buy
 *    nothing and would cost a decrypt on the hot path -- [shouldCapture]
 *    reads `capture_enabled` on every single notification.
 *
 * WHERE THE PREFS KEK COMES FROM. This class never creates it; it is created
 * by [KeyStoreBridge.ensurePrefsKek] from **both** entry points that can be
 * the first code to run on a device -- the app-launch path
 * (`ensurePrefsKeyOnLaunch`, called from the module's `OnCreate`) and
 * `PeraPlanoNotificationListenerService.onListenerConnected`. Both, not one:
 * a user can grant notification access from Android Settings before ever
 * opening PeraPlano, and the listener then runs with the app never launched.
 * That exact gap for the capture keypair silently dropped every capture on a
 * real device (`bca1bcd`).
 *
 * NEVER THROWS. Every getter falls back to its documented default rather than
 * propagating. This is not defensive habit: the only callers that matter run
 * inside the listener service, which is alive precisely when no UI exists to
 * report a failure. A `ClassCastException` out of [SharedPreferences.getStringSet]
 * -- the realistic shape of a preferences file left behind by an older build
 * that stored the filter under the same key with a different type -- would
 * kill `onNotificationPosted` and cost every capture from then on, with
 * nothing anywhere to say why. Falling back to "capture enabled, allow all"
 * degrades toward capturing too much, which the user can see and correct;
 * the alternative degrades toward capturing nothing, which they cannot.
 *
 * Sealing adds a second, identical-in-kind failure mode -- a value that
 * cannot be OPENED (the Keystore was reset, the app was restored onto a new
 * device, the file came from a foreign build) -- and it is handled the same
 * way: allow-all for the filter, "not yet" for the timestamp. Neither ever
 * escapes into `handlePosted`, whose catch would turn it into one silently
 * dropped capture per notification.
 *
 * Writes use `commit()`, not `apply()`. `apply()` only guarantees its
 * background flush completes when the process shuts down through the normal
 * Android lifecycle, and the process hosting a notification listener is a
 * prime low-memory-kill candidate that frequently does not. The values here
 * are small and written rarely (a settings toggle, or once per captured
 * notification), so the blocking write costs far less than losing the pause
 * switch the user just turned off.
 */
class CapturePrefs(context: Context) {

  // applicationContext, not the caller's: a Service or Activity Context would
  // otherwise be captured for the lifetime of this object, and -- more to the
  // point -- Android keys its SharedPreferences cache per name, so both the
  // service and the bridge module must reach the same instance for a write on
  // one side to be visible on the other without a disk round trip.
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  init {
    migrateLegacyPlaintextValues()
  }

  // ---------------------------------------------------------------------
  // Global pause switch -- defaults ON. Plaintext, deliberately.
  // ---------------------------------------------------------------------

  /**
   * Whether capture is switched on at all. Defaults to `true`: a fresh
   * install has to capture before the user has been anywhere near a settings
   * screen, otherwise the app looks broken rather than paused.
   */
  fun isCaptureEnabled(): Boolean =
    try {
      prefs.getBoolean(KEY_CAPTURE_ENABLED, DEFAULT_CAPTURE_ENABLED)
    } catch (error: Exception) {
      DEFAULT_CAPTURE_ENABLED
    }

  fun setCaptureEnabled(enabled: Boolean) {
    write { it.putBoolean(KEY_CAPTURE_ENABLED, enabled) }
  }

  // ---------------------------------------------------------------------
  // Provider allowlist -- SEALED. Empty means ALLOW ALL, not deny all.
  // ---------------------------------------------------------------------

  /**
   * The set of package names capture is restricted to. **An empty set means
   * "allow every package"**, which is also the fresh-install state: the user
   * has not picked providers yet and must not have to before anything works.
   * Reading empty as "allow nothing" is the inverted default that would make
   * a new install capture silently nothing at all.
   *
   * Stored sealed, so this decrypts on every call. No copy-out is needed any
   * more (the pre-Task-2 version handed back `getStringSet`'s live instance
   * and had to defend against a caller mutating persisted state) -- the set
   * below is built fresh from plaintext bytes each time and is nobody else's.
   */
  fun getProviderFilter(): Set<String> =
    openSealed(KEY_PROVIDER_FILTER_SEALED)?.let { decodeProviderFilter(it) } ?: emptySet()

  fun setProviderFilter(packageNames: Set<String>) {
    // Sealed BEFORE the editor is opened: if the seal fails there is no
    // half-written state to undo, and the previous value stands. Removing it
    // instead would drop the user to allow-all, which is a strictly larger
    // set of captured apps than the stale filter it replaced.
    val sealed = seal(encodeProviderFilter(packageNames)) ?: return
    write { it.putString(KEY_PROVIDER_FILTER_SEALED, sealed) }
  }

  /**
   * The one question the listener service actually asks, per plan rule 2:
   * `isCaptureEnabled() && (filter.isEmpty() || packageName in filter)`.
   *
   * The pause switch outranks the allowlist -- when capture is off, no
   * package passes, including ones the user explicitly allowlisted.
   *
   * THIS DECRYPTS ON EVERY NOTIFICATION AND IS DELIBERATELY NOT CACHED.
   * Plan Task 2 rule 2 says measure before caching, so it was measured
   * rather than assumed. 100,000 sequential calls against a 13-package
   * filter (245 bytes of plaintext, one AES-256-GCM open each), after a
   * 20,000-call warm-up, on this project's development machine:
   *
   * ```
   * shouldCapture()                       6.7 - 7.2 us per call
   * isCaptureEnabled() alone (no decrypt) 0.03 - 0.05 us per call
   * => the decrypt itself                 ~6.7 - 7.2 us per call
   * ```
   *
   * Roughly seven MICROseconds, against notifications that arrive at human
   * speed -- a few per minute at the very most. For scale, the same harness
   * put `CaptureEnvelope.seal` -- the RSA-2048/OAEP envelope
   * `CaptureBuffer.append` builds on the very next line of `handlePosted`,
   * before any file is even written -- at **199 us**, about 28x this. The
   * filter decrypt is not the cost on this path and never was.
   *
   * So a cache would buy nothing and cost correctness: the value it would
   * hold is the one the user changes from a screen in the OTHER process, so a
   * stale entry means continuing to capture from a provider they just
   * removed -- a privacy regression, arrived at while optimising something
   * that was never slow. Do not add one without a measurement that says
   * otherwise, and if you do, invalidate it on write.
   *
   * The caveat this measurement cannot cover, and it is the same one
   * `AndroidKeyVault` records for the drain: a real device runs each
   * `Cipher.init` against keystore2 over Binder, which the plain-JCE fake
   * does not model. The numbers above are a floor. What bounds the ceiling is
   * that the RSA-OAEP seal already on this path pays that same Binder cost,
   * on the same delivery, and dominates regardless.
   */
  fun shouldCapture(packageName: String): Boolean {
    if (!isCaptureEnabled()) return false
    val filter = getProviderFilter()
    return filter.isEmpty() || packageName in filter
  }

  // ---------------------------------------------------------------------
  // Health facts (contract §4 `getListenerHealth`).
  // ---------------------------------------------------------------------

  /**
   * Records whether Android currently has the listener service bound, written
   * from `onListenerConnected`/`onListenerDisconnected`. Defaults to `false`:
   * never claim a binding that has not been observed -- the health UI's job is
   * to catch exactly the case where the service is not running.
   *
   * Plaintext: "is a system service currently bound" says nothing about the
   * user's finances, and it is written on a path that must stay cheap.
   */
  fun recordListenerConnected(connected: Boolean) {
    write { it.putBoolean(KEY_LISTENER_CONNECTED, connected) }
  }

  fun isListenerConnected(): Boolean =
    try {
      prefs.getBoolean(KEY_LISTENER_CONNECTED, DEFAULT_LISTENER_CONNECTED)
    } catch (error: Exception) {
      DEFAULT_LISTENER_CONNECTED
    }

  /** [atMillis] is epoch milliseconds (interface contract §1). Sealed at rest. */
  fun recordCapture(atMillis: Long) {
    val sealed = seal(atMillis.toString().toByteArray(Charsets.UTF_8)) ?: return
    write { it.putString(KEY_LAST_CAPTURE_AT_SEALED, sealed) }
  }

  /**
   * Epoch milliseconds of the most recent capture, or `null` when nothing has
   * ever been captured.
   *
   * `null`, not `0L`, and the distinction is load-bearing: `0L` is a valid
   * epoch millisecond value, so a `0L`-as-absent sentinel would report "last
   * captured 1 January 1970" to the health screen instead of "not yet" --
   * and, worse, would erase a genuine `recordCapture(0L)`.
   *
   * Sealing must not flatten that back out, which is why the value stored is
   * the DECIMAL TEXT of the timestamp rather than a fixed-width number with a
   * zero default: absent is a missing key, `0L` is the two bytes `"0"`, and
   * the two cannot be confused. Anything unparseable reads as `null` --
   * "not yet" -- for the same reason an unopenable filter reads as allow-all.
   */
  fun lastCaptureAt(): Long? =
    openSealed(KEY_LAST_CAPTURE_AT_SEALED)?.let { String(it, Charsets.UTF_8).toLongOrNull() }

  // ---------------------------------------------------------------------
  // Migration off the plaintext format (plan Task 2 rule 3).
  // ---------------------------------------------------------------------

  /**
   * Moves any value left on disk by a pre-sealing build into its sealed key
   * **and deletes the plaintext one**.
   *
   * Deleting is the entire point. A migration that wrote a sealed copy and
   * left the original behind would be the failure that looks like success:
   * the accessors would read ciphertext, every seal-related test would pass,
   * and `shared_prefs/peraplano_capture_prefs.xml` pulled off a stolen phone
   * would still name every bank the user holds.
   *
   * IT RUNS ONCE, AND THE PRESENCE OF A LEGACY KEY IS THE ONLY FLAG IT
   * NEEDS. Nothing records "already migrated"; the sealed values live under
   * DIFFERENT key names ([KEY_PROVIDER_FILTER_SEALED],
   * [KEY_LAST_CAPTURE_AT_SEALED]) from the plaintext ones, so once the
   * plaintext keys are gone there is structurally nothing left for a second
   * run to find. That matters because this runs in the CONSTRUCTOR and
   * `CapturePrefs` is built fresh for every single notification: a migration
   * keyed on anything softer -- "the sealed key is absent", say -- would
   * re-seal an already-sealed value into a double-wrapped blob nothing can
   * open. A same-name scheme would have exactly that hazard.
   *
   * The cost per construction when there is nothing to do is two
   * [SharedPreferences.contains] lookups against an in-memory map, and no
   * write at all: a fresh install's preferences file is never created by
   * merely constructing this class.
   *
   * If sealing fails (no usable prefs KEK on this device), it writes and
   * deletes NOTHING and returns, leaving the plaintext for the next
   * construction to retry. Deleting a value it could not preserve would
   * silently discard the user's provider selection to no benefit -- the
   * plaintext would be gone but so would the setting.
   */
  private fun migrateLegacyPlaintextValues() {
    try {
      val hasLegacyFilter = prefs.contains(LEGACY_KEY_PROVIDER_FILTER)
      val hasLegacyCapture = prefs.contains(LEGACY_KEY_LAST_CAPTURE_AT)
      if (!hasLegacyFilter && !hasLegacyCapture) return

      val editor = prefs.edit()

      if (hasLegacyFilter) {
        // A value that will not read back as a Set is one an older or foreign
        // build wrote in some other shape. There is nothing to preserve, but
        // it is still plaintext on disk, so it still goes.
        val legacy = try {
          prefs.getStringSet(LEGACY_KEY_PROVIDER_FILTER, null)?.toSet()
        } catch (error: Exception) {
          null
        }
        if (legacy != null) {
          editor.putString(KEY_PROVIDER_FILTER_SEALED, seal(encodeProviderFilter(legacy)) ?: return)
        }
        editor.remove(LEGACY_KEY_PROVIDER_FILTER)
      }

      if (hasLegacyCapture) {
        val legacy = try {
          prefs.getLong(LEGACY_KEY_LAST_CAPTURE_AT, 0L)
        } catch (error: Exception) {
          null
        }
        if (legacy != null) {
          val plaintext = legacy.toString().toByteArray(Charsets.UTF_8)
          editor.putString(KEY_LAST_CAPTURE_AT_SEALED, seal(plaintext) ?: return)
        }
        editor.remove(LEGACY_KEY_LAST_CAPTURE_AT)
      }

      // One commit for the writes AND the removals together, so a process
      // death between them cannot leave the plaintext behind next to a sealed
      // copy -- which is the exact end state this whole function exists to
      // prevent. `commit()` for the same reason every other write here uses
      // it; see [write].
      editor.commit()
    } catch (error: Exception) {
      // Same contract as everything else in this class: the next read falls
      // back to its documented default, and the next construction retries.
    }
  }

  // ---------------------------------------------------------------------
  // Sealing helpers.
  // ---------------------------------------------------------------------

  /**
   * [KeyStoreBridge.sealPrefsValue], reduced to `null` on failure so callers
   * can decide what "could not store this" means for their own value.
   *
   * The exception is swallowed rather than logged, and that is not laziness:
   * [PrefsValueSealException] is payload-free by construction, but the only
   * caller of any of this is a headless service whose logcat is exactly the
   * exfiltration path `KeyStoreBridge`'s class doc forbids feeding. A line
   * saying "the prefs seal failed" also has no reader -- there is no UI alive
   * to show it to.
   */
  private fun seal(plaintext: ByteArray): String? =
    try {
      KeyStoreBridge.sealPrefsValue(plaintext)
    } catch (error: Exception) {
      null
    }

  /**
   * The stored plaintext of [key], or `null` if it is absent, unopenable, or
   * unreadable. Callers turn that single `null` into their own documented
   * default; nothing here decides on their behalf.
   */
  private fun openSealed(key: String): ByteArray? =
    try {
      val blob = prefs.getString(key, null)
      if (blob == null) null else KeyStoreBridge.openPrefsValue(blob)
    } catch (error: Exception) {
      null
    }

  /**
   * The filter's plaintext wire format: package names joined by newlines.
   *
   * A newline is the one separator that cannot collide with the data. An
   * Android package name is a dot-joined sequence of Java identifiers -- no
   * whitespace of any kind is legal in one -- so no name can smuggle a
   * separator into the encoded form and split itself into two bogus entries.
   * A comma or a space would each be a smaller, more plausible-looking bug
   * with the same effect.
   */
  private fun encodeProviderFilter(packageNames: Set<String>): ByteArray =
    packageNames.joinToString(FILTER_SEPARATOR).toByteArray(Charsets.UTF_8)

  /**
   * Inverse of [encodeProviderFilter]. Empty entries are dropped so the empty
   * SET round-trips through the empty STRING -- `"".split("\n")` yields one
   * empty element, and keeping it would turn "allow all" into an allowlist
   * containing a package named "", i.e. deny-all: the inverted default the
   * whole class is written to avoid.
   */
  private fun decodeProviderFilter(plaintext: ByteArray): Set<String> =
    String(plaintext, Charsets.UTF_8)
      .split(FILTER_SEPARATOR)
      .filter { it.isNotEmpty() }
      .toSet()

  /**
   * Every write goes through here so the `commit()`-not-`apply()` decision
   * (see the class doc) is made in exactly one place, and so a failing write
   * can never escape into the listener service either.
   */
  private fun write(edit: (SharedPreferences.Editor) -> SharedPreferences.Editor) {
    try {
      edit(prefs.edit()).commit()
    } catch (error: Exception) {
      // Nothing useful to do and nowhere to report it -- the caller is
      // usually the headless service. The next read falls back to its
      // documented default, which is the same outcome as the write never
      // having happened.
    }
  }

  companion object {
    /**
     * Pinned by the plan (Task 4 rule 1). Changing this string silently
     * abandons every user's existing pause switch and allowlist back to the
     * defaults, so it is effectively a data migration, not a rename.
     */
    const val PREFS_NAME = "peraplano_capture_prefs"

    private const val KEY_CAPTURE_ENABLED = "capture_enabled"
    private const val KEY_LISTENER_CONNECTED = "listener_connected"

    /**
     * The sealed keys. Deliberately DIFFERENT names from the plaintext ones
     * below rather than the same names holding a different type -- see
     * [migrateLegacyPlaintextValues] for why that difference is what makes
     * the migration safe to run in a constructor that fires once per
     * notification.
     */
    private const val KEY_PROVIDER_FILTER_SEALED = "provider_filter_sealed"
    private const val KEY_LAST_CAPTURE_AT_SEALED = "last_capture_at_sealed"

    /**
     * What a pre-sealing build wrote: a plaintext `StringSet` and a plaintext
     * `Long`. Nothing reads these except the migration, which deletes them.
     * They stay named here because a constant that is only ever passed to
     * `remove()` still has to be the exact string the old build used, and a
     * literal buried in the migration would be the easiest thing in this file
     * to "tidy up" into something subtly different.
     */
    private const val LEGACY_KEY_PROVIDER_FILTER = "provider_filter"
    private const val LEGACY_KEY_LAST_CAPTURE_AT = "last_capture_at"

    private const val FILTER_SEPARATOR = "\n"

    private const val DEFAULT_CAPTURE_ENABLED = true
    private const val DEFAULT_LISTENER_CONNECTED = false
  }
}
