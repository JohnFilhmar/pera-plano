package expo.modules.notificationlistener

import android.content.Context
import android.content.pm.PackageManager

/**
 * Resolves an Android package to the name the user actually sees on their
 * launcher -- `PackageManager.getApplicationLabel`, the only source of truth
 * for what an app is called today.
 *
 * WHY THIS EXISTS. Until now the provider picker had two possible names for a
 * package and both were guesses: the parser seed's `providerKey` ("seabank")
 * and, failing that, the raw package id itself. Neither tracks reality. The
 * seed's names were written once, by hand, from what the banks were called at
 * the time -- and banks rebrand: `ph.seabank.seabank` is Maribank now, and a
 * picker tile reading "seabank" is naming a company that no longer exists
 * under that name. The user cannot confirm "yes, that is my banking app" from
 * a stale brand, and the whole screen is one long request for exactly that
 * confirmation.
 *
 * The package id is the routing key and NEVER changes with a rebrand, so
 * resolving the label at display time fixes every past and future rename with
 * no app release and no ruleset update. The seed name stays as the fallback
 * for a package that is in the catalogue but not installed.
 *
 * PACKAGE VISIBILITY (Android 11 / API 30+). `getApplicationInfo` on another
 * app throws [PackageManager.NameNotFoundException] unless that app is
 * visible to this one, which is why `app.plugin.js` declares a `<queries>`
 * element matching MAIN/LAUNCHER. That is the sanctioned narrow mechanism --
 * NOT `QUERY_ALL_PACKAGES`, which is a Play-restricted permission requiring a
 * declaration form, and which this module has always refused (see
 * [observedPackages]). Nothing here needs it: a launchable app's own name is
 * all this file ever reads, and it reads it for one package at a time, from a
 * list the caller already had.
 *
 * NAMES ARE UNTRUSTED INPUT. An app label is arbitrary text chosen by whoever
 * built the app, and every installed app can supply one -- so it is treated
 * like any other foreign string and passed through [sanitizeAppLabel] before
 * it is allowed to cross the bridge.
 */

/**
 * The longest label allowed across the bridge.
 *
 * The picker renders a tile with `numberOfLines={1}`, so an over-long name is
 * already visually harmless -- this cap is about not shuttling a megabyte of
 * attacker-chosen text through the JSI for a 14dp tile. Sixty-four characters
 * comfortably clears every real banking app ("Maribank", "GCash",
 * "UnionBank Online") and anything past it was never going to be readable.
 */
private const val MAX_LABEL_LENGTH = 64

/**
 * A label fit to show, or `null` when this package has nothing better to
 * offer than what the caller already knows.
 *
 * RETURNS `null`, NOT THE PACKAGE NAME, in every degenerate case. The JS side
 * has its own fallback chain (real label -> seed's provider label -> raw
 * package), and each of those steps is a deliberate, tested choice. Returning
 * the package id from here would look like a resolved answer and silently
 * pre-empt the seed label, so an installed-but-unlabelled `com.seabank.ph`
 * would render as "com.seabank.ph" rather than as "SeaBank" -- strictly worse
 * than the behaviour that shipped before this file existed.
 *
 * THE `== packageName` CHECK IS LOAD-BEARING, not defensive padding.
 * `loadLabel` returns the package name itself when an app declares no
 * `android:label`, which is precisely the "nothing better to offer" case.
 *
 * Whitespace is collapsed rather than merely trimmed: a label carrying a
 * newline would otherwise silently eat the tile's single rendered line.
 */
internal fun sanitizeAppLabel(rawLabel: String?, packageName: String): String? {
  if (rawLabel == null) return null

  val collapsed = rawLabel
    // Control characters (including the newline case above) are replaced with
    // a space rather than deleted, so "Bank\nPH" stays two words.
    .map { if (it.isISOControl()) ' ' else it }
    .joinToString("")
    .trim()
    .replace(Regex("\\s+"), " ")

  if (collapsed.isEmpty()) return null
  if (collapsed == packageName.trim()) return null

  return if (collapsed.length > MAX_LABEL_LENGTH) collapsed.take(MAX_LABEL_LENGTH) else collapsed
}

/**
 * Package -> user-visible app name, for the packages the caller asked about
 * and no others.
 *
 * PARTIAL BY DESIGN. A package that is not installed, not visible, or has no
 * usable label is simply ABSENT from the returned map -- never present with a
 * blank or placeholder value. "Absent" is a state the JS wrapper can fall
 * through on; a placeholder is one it would have to recognise, and the whole
 * point of the fallback chain is that each step knows a better answer than
 * the step below it.
 *
 * NEVER THROWS. A [PackageManager] failure on one package must not cost the
 * caller the other twenty names: this runs inside onboarding, where the only
 * alternative to a label is a screen full of raw package ids.
 */
internal fun appLabels(context: Context, packageNames: List<String>): Map<String, String> {
  val packageManager = context.packageManager
  val labels = LinkedHashMap<String, String>()

  for (packageName in packageNames) {
    val trimmed = packageName.trim()
    // Blank asks nothing; an already-answered one asks it twice. Neither is
    // worth a PackageManager round trip.
    if (trimmed.isEmpty() || labels.containsKey(trimmed)) continue

    val label = try {
      val info = packageManager.getApplicationInfo(trimmed, 0)
      sanitizeAppLabel(packageManager.getApplicationLabel(info).toString(), trimmed)
    } catch (_: PackageManager.NameNotFoundException) {
      // Not installed, or filtered out by package visibility. Both are
      // ordinary answers on this screen -- the picker offers catalogue
      // packages the user may not have -- so neither is logged. Logging here
      // would write a list of which banking apps this user does and does not
      // have installed into logcat, which is exactly the sort of inventory
      // this app exists not to keep.
      null
    } catch (_: RuntimeException) {
      // Defensive: a dead PackageManager binder surfaces as a
      // RuntimeException and would otherwise take down the whole batch.
      null
    }

    if (label != null) labels[trimmed] = label
  }

  return labels
}
