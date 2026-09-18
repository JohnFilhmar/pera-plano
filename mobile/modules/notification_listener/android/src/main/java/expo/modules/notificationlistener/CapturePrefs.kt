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
 * THREE OF THE SIX ARE SEALED AT REST, THREE ARE NOT, and the split is
 * deliberate (provider-selection plan Task 2 rule 1):
 *
 *  - **Sealed** under the prefs KEK ([KeyStoreBridge.sealPrefsValue]):
 *    `provider_filter`, because it names every bank and e-wallet the user
 *    holds; `last_capture_at`, because it is a behavioural fact about
 *    when they last moved money; and `observed_packages` (Task 3), because a
 *    list of the apps a person uses is the same disclosure the filter is,
 *    one step less curated. docs/12-encryption-and-app-lock.md §4 places
 *    "a malicious app reading app-private storage on a rooted device" IN
 *    scope and promises "the database file is ciphertext; the buffer is
 *    ciphertext" -- until this task these sat beside them in plaintext,
 *    readable with `cat shared_prefs/peraplano_capture_prefs.xml`.
 *  - **Plaintext:** `capture_enabled`, `listener_connected` and
 *    `provider_filter_deny_all`. Three booleans that reveal nothing about
 *    anyone's finances -- the third says only THAT the user blocked
 *    everything, never WHICH banks they hold, which is the disclosure the
 *    filter beside it is sealed to prevent. Sealing them would buy nothing
 *    and would cost a decrypt on the hot path -- [shouldCapture] reads
 *    `capture_enabled` on every single notification. `provider_filter_deny_all`
 *    has a third reason to stay plaintext, and it is the stronger one: see
 *    [isProviderFilterDenyAll].
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
 * ALLOW-ALL IS A FALLBACK, NOT A RESTING STATE, and nothing on this side can
 * tell the difference -- there is no getter across the bridge, so JS cannot
 * ask what filter is in force. The JS side compensates by PUSHING instead of
 * reading: `resyncProviderFilter()` in `mobile/lib/bootstrap.ts` re-sends the
 * user's allowlist on every launch, rebuilt from the `paused_provider_packages`
 * setting -- whenever that setting records a paused provider at all, since an
 * empty one cannot be told apart from a user who never narrowed anything. A
 * filter that fell back to allow-all here, on a device whose owner did pause
 * something, is therefore re-sealed at the next app start. The window is real,
 * though, and it is not always short: the listener runs in its own process and
 * can capture for days with the app never opened (see the `onListenerConnected`
 * note above), so nothing here may treat "the app will fix it" as immediate.
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
  // "Block every package" is a SEPARATE plaintext flag, never an empty list.
  // ---------------------------------------------------------------------

  /**
   * The set of package names capture is restricted to. **An empty set means
   * "allow every package"**, which is also the fresh-install state: the user
   * has not picked providers yet and must not have to before anything works.
   * Reading empty as "allow nothing" is the inverted default that would make
   * a new install capture silently nothing at all.
   *
   * DENY-ALL IS NOT SPELLED HERE, and cannot be. An allowlist has exactly one
   * empty value and it is already spoken for by the sentence above, so the
   * "block everything" state the Privacy centre reaches by pausing every
   * provider lives in [isProviderFilterDenyAll] instead. Anything that reads
   * this set to decide whether to capture must consult that flag too --
   * [shouldCapture] is the only such reader, deliberately.
   *
   * Stored sealed, so this decrypts on every call. No copy-out is needed any
   * more (the pre-Task-2 version handed back `getStringSet`'s live instance
   * and had to defend against a caller mutating persisted state) -- the set
   * below is built fresh from plaintext bytes each time and is nobody else's.
   */
  fun getProviderFilter(): Set<String> =
    openSealed(KEY_PROVIDER_FILTER_SEALED)?.let { decodeProviderFilter(it) } ?: emptySet()

  /**
   * Whether the user has blocked EVERY package: the state an allowlist cannot
   * express, because its empty value means the opposite.
   *
   * **Defaults to `false`,** which is what keeps the fresh-install and the
   * upgrade defaults where they were. A device that has never written this
   * key -- a new install, or one upgrading from a build that had no such key
   * -- reads `false` here and falls through to the allowlist exactly as
   * before, so nothing that a previous version sealed changes meaning.
   *
   * PLAINTEXT, unlike the filter it accompanies. Two of the reasons are the
   * ones the other plaintext booleans give: it names no bank and no e-wallet,
   * and it is read on the hot path. The third is particular to this one and
   * is the reason it MUST NOT be sealed -- a sealed value that cannot be
   * opened (Keystore reset, restore onto another device, a preferences file
   * from a foreign build) falls back to its default, and for this flag that
   * fallback would silently turn "block everything" back into "allow
   * everything". That is the precise failure this flag exists to end, so
   * storing it where that failure can reach it would be self-defeating.
   */
  fun isProviderFilterDenyAll(): Boolean =
    try {
      prefs.getBoolean(KEY_PROVIDER_FILTER_DENY_ALL, DEFAULT_PROVIDER_FILTER_DENY_ALL)
    } catch (error: Exception) {
      DEFAULT_PROVIDER_FILTER_DENY_ALL
    }

  /**
   * Writes the WHOLE capture scope -- the allowlist AND the deny-all flag, in
   * one `commit()`. They are never written apart: a deny-all that landed
   * without its filter, or a filter that landed while a stale deny-all still
   * stood, is a scope no caller asked for.
   *
   * [denyAll] defaults to `false` because every pre-existing caller is handing
   * over an ALLOWLIST, and must keep its exact previous meaning.
   *
   * THE ONE FUNCTION IN THIS CLASS THAT REPORTS FAILURE (GAP-114) -- as a
   * RETURN VALUE, so the class-wide never-throws rule stands untouched and the
   * listener service can go on calling this without a catch. Everything else
   * here is read by that headless service, which has nobody to tell; this is
   * written by a user standing in front of the Privacy centre having just
   * asked for a pause. Returning `Unit` on a write that did not happen is what
   * let that pause be reported as applied while capture continued, with
   * `paused_provider_packages` -- the only readable record, since there is no
   * getter across the bridge -- recording a state the listener never entered.
   *
   * WHAT THE RESULT MEANS: **whether the requested capture SCOPE is now in
   * force**, not whether both keys were written. The two differ in exactly one
   * case, the deny-all-without-a-seal branch below, and that comment carries
   * the argument for why `true` is honest there.
   */
  fun setProviderFilter(packageNames: Set<String>, denyAll: Boolean = false): Boolean {
    // Sealed BEFORE the editor is opened: if the seal fails there is no
    // half-written state to undo, and the previous value stands. Removing it
    // instead would drop the user to allow-all, which is a strictly larger
    // set of captured apps than the stale filter it replaced.
    val sealed = seal(encodeProviderFilter(packageNames))
    if (sealed == null) {
      // No usable prefs KEK, so the allowlist cannot be updated at all -- but
      // a deny-all still can, and still must. It is plaintext, it needs no
      // KEK, and it outranks whatever stale filter is left on disk. Leaving
      // the user at allow-all because an unrelated key was unavailable is the
      // fail-open this flag exists to close. The reverse case (denyAll false)
      // still writes nothing, so a filter update that could not be sealed
      // cannot lift a block the user is still asking for.
      //
      // A LANDED DENY-ALL IS A SUCCESS, even though the allowlist beside it is
      // stale, because the stale allowlist is unreachable for as long as the
      // flag stands: [shouldCapture] returns false before it ever opens the
      // filter, and this function is the only writer of the flag, whose only
      // path back to `false` is the full write below -- which replaces the
      // filter in the same `commit()`. So there is no sequence of calls in
      // which that stale value is ever consulted. Reporting failure here would
      // instead make the caller drop `paused_provider_packages` for a block the
      // device really is applying, which is the same divergence in the other
      // direction and undoes half of GAP-103.
      if (denyAll) return write { it.putBoolean(KEY_PROVIDER_FILTER_DENY_ALL, true) }
      return false
    }
    return write {
      it.putString(KEY_PROVIDER_FILTER_SEALED, sealed)
        .putBoolean(KEY_PROVIDER_FILTER_DENY_ALL, denyAll)
    }
  }

  /**
   * The one question the listener service actually asks, per plan rule 2:
   * `isCaptureEnabled() && !isProviderFilterDenyAll() &&
   * (filter.isEmpty() || packageName in filter)`.
   *
   * The pause switch outranks the allowlist -- when capture is off, no
   * package passes, including ones the user explicitly allowlisted. The
   * deny-all flag outranks it too, and for the same reason: it is the user
   * saying "block everything", which an empty allowlist reads as its exact
   * opposite. Both are checked before the filter is even opened, so neither
   * pays the decrypt below.
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
    if (isProviderFilterDenyAll()) return false
    val filter = getProviderFilter()
    return filter.isEmpty() || packageName in filter
  }

  // ---------------------------------------------------------------------
  // Observed packages -- SEALED. Package names only, bounded at 100.
  // ---------------------------------------------------------------------

  /**
   * Notes that [packageName] posted a notification at [atMillis] (epoch
   * milliseconds, interface contract §1), incrementing its count and moving
   * it to the front of [listObservedPackages].
   *
   * [isOngoing] is `sbn.isOngoing` for this delivery, and it is what keeps a
   * re-posting tile from turning bookkeeping into a treadmill -- see
   * ONGOING RE-POSTS COST NOTHING below.
   *
   * WHY THIS EXISTS. **NOT ONE of the fifteen package names in the parser
   * `seed.json` has been checked against a device or a Play listing** --
   * `lib/ingest/seed_rules.ts`'s own header says so outright. Seven are
   * transparently constructed from app names (`com.bpi.ng.app`,
   * `com.bdo.digitalbanking`, `com.metrobank.mobilebanking` and four more),
   * but the other eight are merely unflagged, not verified. Fifteen rather
   * than thirteen because `sms_relay` carries three. A wrong one is a SILENT
   * failure: that provider is never routed, captures nothing, logs nothing,
   * and looks to the user like their bank simply does not work. The listener
   * already receives `sbn.packageName` for every notification on the device,
   * so the real names can be learned with NO new permission -- deliberately
   * not `QUERY_ALL_PACKAGES`, a restricted Play permission this build does
   * not need and would have to justify in writing.
   *
   * CALLED FOR EVERY NOTIFICATION THE LISTENER SEES, INCLUDING THE ONES IT
   * DROPS -- filtered out, ongoing, paused, or carrying no text. A package
   * the user has not selected is precisely the one that must appear in the
   * picker; recording only captured notifications would surface exactly the
   * apps they already chose, which makes the picker useless for its own job.
   * See `PeraPlanoNotificationListenerService.handlePosted`, where this is
   * the first line inside the try for exactly that reason.
   *
   * ONGOING RE-POSTS COST NOTHING, and that is the difference between "every
   * notification" and "every notification worth a write". A media player, a
   * download and a navigation session each re-post the SAME ongoing tile
   * roughly once a second for as long as they run. Recording every one of
   * those the way a real post is recorded charged the measured 3.8 ms below
   * -- a whole-file re-seal plus an fsync, on the binder thread the listener
   * has to stay responsive on -- to learn a fact the list already held, once
   * a second, indefinitely. So an [isOngoing] delivery of a package that is
   * ALREADY at the front and was seen within [OBSERVED_REPOST_WINDOW_MILLIS]
   * returns without writing at all: neither the count, nor the order, nor
   * `lastSeenAt` to within a minute, would come out any different.
   *
   * FIRST SIGHT IS NOT A RE-POST. A package this device has never seen is
   * stored even when the notification is ongoing, because a bank app's
   * foreground-service tile can easily be the only thing it ever posts before
   * the user reaches the picker -- which is the one case the picker exists
   * for. The short-circuit needs a previous entry to short-circuit against.
   *
   * THE COUNT MEANS DISTINCT POSTS, so an [isOngoing] re-post never raises
   * it. It was meant to separate a bank the user actually banks with from a
   * one-off, and a signal dominated by whichever app re-posts its tile most
   * ranks the music player above the bank. A re-post that DOES write -- the
   * package was displaced from the front, or the window has run out -- still
   * refreshes `lastSeenAt` and still leaves the count alone.
   *
   * PACKAGE NAMES, A COUNT AND A TIMESTAMP. Never a title, never body text.
   * This list is already sensitive enough to be sealed; adding content would
   * make it a shadow copy of the notification history the sealed
   * [CaptureBuffer] exists to protect, sitting under a key that -- by
   * design -- requires no user authentication at all.
   *
   * NEVER THROWS, like everything else here, and the reason is sharper on
   * this path than anywhere else in the class: this runs BEFORE the capture
   * in `handlePosted`, inside the try whose catch turns any escape into one
   * silently dropped notification. The recording is bookkeeping for a screen
   * the user visits once; a real notification arrives once and never again.
   * A failure here stores nothing and costs nothing.
   *
   * An empty package name is ignored rather than stored: `sbn.packageName`
   * is never empty in practice, and a blank entry would occupy one of the
   * bounded slots below while naming nothing the picker could offer.
   *
   * MEASURED, because this runs on every notification and the number is not
   * small. Robolectric/JVM, 10,000 calls after a 2,000-call warm-up:
   *
   * | | per call |
   * |---|---|
   * | [KeyStoreBridge.sealPrefsValue] alone on a 4 KB list, no write | 13 us |
   * | `setCaptureEnabled` -- a bare boolean, NO crypto, one `commit()` | 1,175 us |
   * | `recordCapture` -- seals a Long, one `commit()` | 2,366 us |
   * | **this function** -- seals the list, one `commit()` | **3,848 us** |
   *
   * THE SEALING IS NOT THE COST. 13 us of it is crypto; the rest is
   * `SharedPreferences.commit()`, which rewrites the whole XML file and
   * fsyncs it -- a bare boolean with no crypto at all pays 1,175 us of the
   * same thing. That cost is PRE-EXISTING (see the class doc for why
   * `commit()` and not `apply()`), and this function is flat across a
   * 12-entry and a 100-entry list, which is what rules the list size out.
   *
   * What observing packages genuinely adds is therefore not encryption
   * overhead but (a) one commit on the DROPPED path, which previously wrote
   * nothing at all, and (b) ~5.5 KB of sealed base64 to a file that every
   * other write rewrites in full -- which is why `recordCapture` above
   * measures 2,366 us once this list is at its cap.
   *
   * Acceptable, deliberately, but ONLY at human rates: notifications arrive
   * on a background binder thread and 4 ms is nowhere near user-visible. It
   * is a flash-write and battery cost, not a latency one. Ongoing tiles are
   * the one thing that does not arrive at human rates, which is exactly why
   * they are short-circuited above -- 3.8 ms and an fsync once a second, for
   * hours, is a different cost entirely. TREAT THESE AS A
   * CEILING rather than a floor -- unlike the Keystore numbers in
   * [shouldCapture], a Robolectric `commit()` is real host file I/O on a
   * developer's NTFS volume, and a device writing app-private storage on
   * ext4/f2fs should be cheaper. docs/13-on-device-verification.md carries
   * the on-device confirmation.
   */
  fun recordObservedPackage(packageName: String, atMillis: Long, isOngoing: Boolean = false) {
    if (packageName.isEmpty()) return

    val existing = listObservedPackages()
    val previous = existing.firstOrNull { it.packageName == packageName }

    // NOTHING NEW TO LEARN, so nothing to pay for: an ongoing tile re-posting
    // once a second, already at the front, seen moments ago. `existing.first()`
    // is safe -- a non-null `previous` came out of that same list.
    //
    // The `isOngoing` conjunct is deliberate and is what keeps this from
    // eating real posts. Two GENUINE notifications from the same bank seconds
    // apart (a transfer confirmation, then the balance that follows it) are
    // two distinct posts and must count as two; only a re-post of a
    // persistent tile is the same fact arriving again.
    if (isOngoing && previous != null && existing.first().packageName == packageName) {
      val sinceLastSeen = atMillis - previous.lastSeenAt
      // A negative delta means the clock moved backwards between deliveries.
      // That is not "recent", it is unknown, so it falls through and writes.
      if (sinceLastSeen in 0L until OBSERVED_REPOST_WINDOW_MILLIS) return
    }

    val updated = ObservedPackage(
      packageName = packageName,
      // ACCUMULATES, ONE PER DISTINCT POST. Overwriting with 1 would make
      // "seen 12 times" -- the signal that separates a bank the user actually
      // uses from a one-off -- permanently useless to the picker; counting an
      // ongoing re-post would ruin it the other way, by handing the top of
      // the list to whichever app re-posts its tile most often.
      count = when {
        previous == null -> 1
        isOngoing -> previous.count
        else -> previous.count + 1
      },
      lastSeenAt = atMillis,
    )

    // The updated entry first, so a stable sort keeps it ahead of anything
    // sharing its timestamp -- it is by definition the most recent thing
    // this device has seen.
    val merged = (listOf(updated) + existing.filter { it.packageName != packageName })
      .sortedByDescending { it.lastSeenAt }
      .take(MAX_OBSERVED_PACKAGES)

    val sealed = seal(encodeObservedPackages(merged)) ?: return
    write { it.putString(KEY_OBSERVED_PACKAGES_SEALED, sealed) }
  }

  /**
   * Adds packages this device has never observed before, in ONE write
   * (GAP-125).
   *
   * WHY THIS EXISTS RATHER THAN A LOOP OVER [recordObservedPackage]. The
   * caller is the listener's connect callback, handing over everything already
   * sitting in the notification shade, and that differs from a live post on
   * both counts that matter here.
   *
   *  - **Cost.** [recordObservedPackage] re-reads the whole list, re-seals it
   *    and `commit()`s once per call, measured at 3,848 us. A shade holding
   *    forty notifications would be forty re-reads and forty fsyncs on the
   *    bind thread, and the list caps at [MAX_OBSERVED_PACKAGES] = 100. This
   *    is one read, one seal and one commit however many arrive.
   *  - **Correctness, which is the stronger reason.** [recordObservedPackage]
   *    INCREMENTS `count` on every call, and the shade is not new evidence
   *    about a package already counted when it posted. A loop would inflate
   *    the count of everything already known, every time the listener rebinds
   *    -- and `count` is exactly the signal the picker uses to tell a bank the
   *    user actually uses from a one-off.
   *
   * ADD-ONLY, FOR THE SAME REASON. A package already on the list is left
   * completely untouched: not re-counted, and not re-stamped with a later
   * `lastSeenAt`, because a notification posted three hours ago is not a
   * sighting that just happened and moving it to the top would reorder the
   * picker on a lie. That also makes a rebind free: nothing new means nothing
   * added, and the early return below means no write at all.
   *
   * `sightings` maps a package name to when it was actually seen, which the
   * caller takes from `sbn.postTime` rather than from the clock, so the cap
   * below keeps the most recent rather than whichever the array listed first.
   */
  fun recordObservedPackages(sightings: Map<String, Long>) {
    if (sightings.isEmpty()) return

    val existing = listObservedPackages()
    val known = existing.mapTo(mutableSetOf()) { it.packageName }

    val added = sightings
      // Empty names are ignored for the same reason the single-package path
      // ignores them: a blank entry would occupy one of the bounded slots
      // below while naming nothing the picker could offer.
      .filterKeys { it.isNotEmpty() && it !in known }
      .map { (packageName, seenAt) ->
        ObservedPackage(packageName = packageName, count = 1, lastSeenAt = seenAt)
      }

    // NO WRITE AT ALL when there is nothing new, which is the normal case on
    // every rebind after the first. Returning before `seal` also means a
    // reconnect costs nothing rather than 3,848 us to store what is already
    // there.
    if (added.isEmpty()) return

    val merged = (added + existing)
      .sortedByDescending { it.lastSeenAt }
      .take(MAX_OBSERVED_PACKAGES)

    val sealed = seal(encodeObservedPackages(merged)) ?: return
    write { it.putString(KEY_OBSERVED_PACKAGES_SEALED, sealed) }
  }

  /**
   * Every package this device has seen post a notification, **newest-first**
   * -- the list the onboarding provider picker offers alongside the seed
   * catalogue (plan Task 4).
   *
   * Newest-first because recency is the only ranking the app has any evidence
   * for: an app that notified five minutes ago is one the user actually uses,
   * and the picker's first screenful is what most people will ever read.
   * The order is established on write (see [recordObservedPackage], which has
   * to sort anyway to evict correctly), so this is a plain decode of a list
   * that is already in order.
   *
   * Empty when nothing has been seen yet, or when the stored value cannot be
   * opened -- the same never-throw fallback as everything else here. An empty
   * picker degrades to "the seed catalogue only", which is exactly the
   * pre-Task-3 behaviour and visibly harmless; an exception on this path
   * would take the onboarding screen down with it.
   */
  fun listObservedPackages(): List<ObservedPackage> =
    openSealed(KEY_OBSERVED_PACKAGES_SEALED)?.let { decodeObservedPackages(it) } ?: emptyList()

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
   * The observed list's plaintext wire format: one package per line, three
   * tab-separated fields -- `packageName`, `count`, `lastSeenAt`.
   *
   * Two separators that cannot collide with the data, for the same reason
   * [encodeProviderFilter] uses a newline: an Android package name is a
   * dot-joined sequence of Java identifiers, so no whitespace of any kind is
   * legal in one, and neither a tab nor a newline can be smuggled in to split
   * one entry into two bogus ones. The other two fields are decimal digits.
   *
   * A hand-rolled format rather than JSON because this is written on EVERY
   * notification the device receives -- see the class doc on `commit()` --
   * and because there are exactly three fields, all of them primitives, with
   * no nullability to model.
   */
  private fun encodeObservedPackages(packages: List<ObservedPackage>): ByteArray =
    packages
      .joinToString(OBSERVED_RECORD_SEPARATOR) {
        it.packageName + OBSERVED_FIELD_SEPARATOR + it.count + OBSERVED_FIELD_SEPARATOR + it.lastSeenAt
      }
      .toByteArray(Charsets.UTF_8)

  /**
   * Inverse of [encodeObservedPackages], and TOTAL: a line that is empty,
   * has the wrong number of fields, or carries an unparseable count or
   * timestamp is dropped rather than throwing.
   *
   * That matters more here than the equivalent leniency in
   * [decodeProviderFilter]. This runs inside [recordObservedPackage], which
   * runs inside `handlePosted`'s try -- so a `NumberFormatException` out of a
   * malformed line would not merely lose the observed list, it would cost the
   * NOTIFICATION being processed, once per delivery, silently. The empty
   * string decodes to an empty list for the same reason the filter's does.
   */
  private fun decodeObservedPackages(plaintext: ByteArray): List<ObservedPackage> =
    String(plaintext, Charsets.UTF_8)
      .split(OBSERVED_RECORD_SEPARATOR)
      .mapNotNull { line ->
        val fields = line.split(OBSERVED_FIELD_SEPARATOR)
        if (fields.size != OBSERVED_FIELD_COUNT) return@mapNotNull null
        val packageName = fields[0]
        val count = fields[1].toIntOrNull()
        val lastSeenAt = fields[2].toLongOrNull()
        if (packageName.isEmpty() || count == null || lastSeenAt == null) {
          null
        } else {
          ObservedPackage(packageName, count, lastSeenAt)
        }
      }

  /**
   * Every write goes through here so the `commit()`-not-`apply()` decision
   * (see the class doc) is made in exactly one place, and so a failing write
   * can never escape into the listener service either.
   *
   * RETURNS WHETHER THE VALUE REACHED DISK -- `commit()`'s own result, and
   * `false` for the exception this still swallows. Every caller but
   * [setProviderFilter] ignores it, deliberately and unchanged: they run in
   * the headless service, where there is nothing to report a failure to. It
   * exists so the ONE caller with a user waiting on the answer can stop
   * inventing one (GAP-114). `apply()` could never have supported this --
   * it returns before the flush -- which is a third reason the class doc's
   * `commit()` decision holds.
   */
  private fun write(edit: (SharedPreferences.Editor) -> SharedPreferences.Editor): Boolean =
    try {
      edit(prefs.edit()).commit()
    } catch (error: Exception) {
      // Nothing useful to do and nowhere to report it -- the caller is
      // usually the headless service. The next read falls back to its
      // documented default, which is the same outcome as the write never
      // having happened.
      false
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
     * The deny-all flag that sits beside the sealed filter and outranks it
     * (GAP-103). A NEW key rather than a new shape for the old one: a device
     * upgrading from a build that never wrote this reads its `false` default
     * and behaves exactly as that build did, and the sealed value written by
     * the previous version still decodes to the same allowlist it always
     * meant. Nothing on disk changes meaning.
     *
     * Plaintext, and it has to be -- see [isProviderFilterDenyAll].
     */
    private const val KEY_PROVIDER_FILTER_DENY_ALL = "provider_filter_deny_all"

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
     * The observed list, sealed like its two neighbours -- and with NO
     * legacy counterpart below and NO entry in [migrateLegacyPlaintextValues],
     * deliberately. This key was introduced already sealed (plan Task 3), so
     * there has never been a plaintext version of it on any device: nothing
     * to read, nothing to delete, and a migration entry would be code that
     * can only ever find an empty result.
     *
     * It keeps the `_sealed` suffix anyway, so the preferences file stays
     * self-describing -- every key in it either is sealed or is one of the
     * three booleans that deliberately are not.
     */
    private const val KEY_OBSERVED_PACKAGES_SEALED = "observed_packages_sealed"

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

    private const val OBSERVED_RECORD_SEPARATOR = "\n"
    private const val OBSERVED_FIELD_SEPARATOR = "\t"
    private const val OBSERVED_FIELD_COUNT = 3

    /**
     * The cap on [recordObservedPackage], evicting the least-recently-seen
     * (plan Task 3 rule 3).
     *
     * A BOUND, not a tuning knob. This value is re-encoded, re-sealed and
     * rewritten on every single notification the device receives, so an
     * unbounded list would turn a busy hour into a growing write on each
     * delivery. It is also a privacy bound: a record of every app that has
     * ever notified this phone is a behavioural profile nobody asked for,
     * and the picker only ever needs the apps the user currently uses.
     *
     * 100 is far more than the number of financial apps a person holds, and
     * eviction is by recency rather than by count so an app used weekly is
     * never displaced by one chatty game.
     */
    internal const val MAX_OBSERVED_PACKAGES = 100

    /**
     * How stale the front entry's `lastSeenAt` may get before an ONGOING
     * re-post is allowed to rewrite it (see [recordObservedPackage]).
     *
     * A WRITE BOUND, not a precision setting. Ongoing tiles re-post at about
     * 1 Hz, so this caps one of them at a single re-seal-and-fsync a minute
     * instead of sixty, and it does so per package -- three of them running
     * at once cost three writes a minute, not three a second.
     *
     * A minute of staleness cannot be seen anywhere it is used. The picker
     * ranks by recency across apps whose notifications are hours apart, and
     * a package pinned at the front of the list by its own re-posts is the
     * last thing the 100-entry cap would ever evict.
     */
    internal const val OBSERVED_REPOST_WINDOW_MILLIS = 60_000L

    private const val DEFAULT_CAPTURE_ENABLED = true
    private const val DEFAULT_LISTENER_CONNECTED = false

    /**
     * `false`, so "no flag on disk" keeps meaning "fall through to the
     * allowlist", which for an absent or empty filter is allow-all. Flipping
     * this to `true` would make every fresh install capture nothing.
     */
    private const val DEFAULT_PROVIDER_FILTER_DENY_ALL = false
  }
}

/**
 * One package this device has seen post a notification (interface contract
 * §4; provider-selection plan Task 3). The field names ARE the JS
 * `ObservedPackage` field names, so the picker never has to translate --
 * the same discipline [CaptureRecord] holds for `RawCapture`.
 *
 * THREE FIELDS, AND THAT IS THE POINT. There is deliberately nowhere here to
 * put a notification title or body: this type is the storage schema, so a
 * later edit that wanted to "just also keep the last message" would have to
 * widen it in the open rather than slip content in. See
 * [CapturePrefs.recordObservedPackage] for why that boundary is a privacy
 * rule and not a schema preference.
 *
 * [lastSeenAt] is epoch milliseconds (contract §1) and is the time the
 * LISTENER saw the notification, not the `postTime` the posting app claimed
 * -- recency here is about what this device observed.
 */
data class ObservedPackage(
  val packageName: String,
  val count: Int,
  val lastSeenAt: Long,
) {

  fun toMap(): Map<String, Any?> = mapOf(
    KEY_PACKAGE_NAME to packageName,
    KEY_COUNT to count,
    KEY_LAST_SEEN_AT to lastSeenAt,
  )

  companion object {
    const val KEY_PACKAGE_NAME = "packageName"
    const val KEY_COUNT = "count"
    const val KEY_LAST_SEEN_AT = "lastSeenAt"
  }
}
