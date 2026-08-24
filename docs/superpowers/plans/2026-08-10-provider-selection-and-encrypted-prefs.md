# Provider Selection and Encrypted Listener Prefs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Sequencing:** starts **after `2026-08-02-mobile-ingest-m1b-pipeline.md` completes.** M1b Task 3
> (`source_router`) consumes the provider filter and is written against the *existing*
> `getProviderFilter()` signature, which this plan does not change — only where the value is
> stored and how it is populated.

**Goal:** Stop guessing Android package names, and stop storing the user's financial-app list in
plaintext.

**Why this exists.** Two problems found during M1b Task 2 and the 2026-08-10 device session:

1. **Seven of the thirteen seed package names are inventions** — `com.bpi.ng.app`,
   `com.bdo.digitalbanking`, `com.metrobank.mobilebanking`, `com.seabank.ph`, `com.gotyme.bank`,
   `com.cimbbank.ph`, `com.lbp.mobilebanking`. A wrong package name is a **silent** failure: that
   provider is never routed, captures nothing, logs nothing, and looks to the user like the bank
   simply does not work.
2. **The provider filter is plaintext.** It lives in `SharedPreferences` under
   `peraplano_capture_prefs`, while `docs/12-encryption-and-app-lock.md` §4 explicitly places *"a
   malicious app reading app-private storage on a rooted device"* **in scope** and promises "the
   database file is ciphertext; the buffer is ciphertext". The filter is neither, and it reveals
   which banks and e-wallets the user holds.

**Architecture:** The listener already receives `sbn.packageName` for every notification on the
device, so the app can *learn* real package names with no new permission. Onboarding presents
those learned packages alongside the seed catalogue as suggestions, and the user confirms. The
resulting selection — plus everything else sensitive in `CapturePrefs` — is sealed under a
Keystore AES key that requires **no** user authentication, so the listener can still read it while
the app is locked.

**Tech Stack:** Kotlin (Expo Modules API) · TypeScript ~5.9 strict · expo-router ~6 · NativeWind ·
jest + jest-expo + Robolectric. No new runtime dependencies, **no new Android permissions.**

## Global Constraints

These apply to EVERY task. `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW.
Behaviour comes from `docs/12-encryption-and-app-lock.md` and `docs/04-features/01-onboarding.md`.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript
  symbols keep TS idioms.
- **Time:** epoch **milliseconds**.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green →
  commit.
- **Test commands:** JS `npx jest --ci`; typecheck `npx tsc --noEmit`; Kotlin via the prebuild
  cycle below.
- **Kotlin build cycle:** `mobile/android/` is generated and gitignored.
  ```
  cd mobile && npx expo prebuild --platform android --no-install
  cd android && ./gradlew.bat :notification_listener:testDebugUnitTest --console=plain
  ```
  Then `rm -rf mobile/android` and `git checkout -- mobile/package.json` (prebuild re-adds an
  `"ios"` script) before committing. Committing either fails the task.
- **Robolectric:** every suite in the module needs `@Config(sdk = [34])` — Robolectric 4.16.1's
  SDK-36 shadow jar needs Java 21 and this toolchain is Java 17.
- **NO new Android permissions.** In particular **never** `QUERY_ALL_PACKAGES`: it is a restricted
  Play permission requiring written justification, this build already carries three permissions
  that draw review scrutiny, and the notification listener makes it unnecessary.

### What earlier plans already delivered (consume, do not redo)

| From | You get |
|---|---|
| M1a | `CapturePrefs` (`peraplano_capture_prefs`, `commit()`-not-`apply()`, never-throws, copy-on-read/write for the filter), `PeraPlanoNotificationListenerService` (`handlePosted`, `ensureCaptureKeyReady`), `NotificationListenerModule` bridge, `index.ts` wrapper |
| Encryption plan | `KeyStoreBridge` (`ensureDeviceKek`, `wrapWithDeviceKek`, `AES_TRANSFORMATION`), `KeyVault`/`AndroidKeyVault`/`FakeKeyVault` seam, `@Config(sdk=[34])` convention |
| M1b Tasks 1–2 | `parser_rulesets_repo`, `ruleset_types.ts`, `seed.json` (13 providers, package names flagged unverified), `seedParserRules()` |

---

### Task 1: A no-auth prefs key

**Files:**
- Modify: `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/KeyVault.kt`
- Modify: `.../KeyStoreBridge.kt`
- Test: `.../src/test/java/.../KeyStoreBridgeTest.kt` (extend)
- Test: `.../src/androidTest/java/.../KeyStoreBridgeInstrumentedTest.kt` (extend)

**Interfaces:**
```kotlin
// KeyVault
fun getOrCreateUnauthenticatedAesKey(alias: String)
// KeyStoreBridge
internal const val PREFS_KEK_ALIAS = "peraplano.prefs_kek"
fun ensurePrefsKek()
fun sealPrefsValue(plaintext: ByteArray): String    // base64 iv||ciphertext||tag
fun openPrefsValue(blobB64: String): ByteArray
```

**Rules:**
1. AES-256-GCM, and **`setUserAuthenticationRequired(false)`** — this is the entire point. The
   listener runs while the app is locked and must still answer "should I capture this?". A key
   requiring auth would make the filter unreadable exactly when it is needed.
2. **This is a deliberate, documented weakening relative to the DEK.** Write it into the KDoc: an
   attacker who can execute code as our UID can read this key. That attacker is already out of
   scope per `docs/12` §4 (root-while-unlocked, known-PIN). What this key *does* buy is the case
   §4 puts **in** scope: an offline filesystem read — a stolen phone, an unencrypted backup,
   forensic extraction. Ciphertext there is worth having even if a live root is not defended.
3. StrongBox requested with the same fallback as the other keys.
4. `sealPrefsValue`/`openPrefsValue` never log the plaintext or the key. On any failure they throw
   a payload-free exception — never one carrying the value.

- [ ] **Step 1: Write the failing tests.** JVM (behind `FakeKeyVault`): seal→open round-trips
      arbitrary bytes · a tampered blob fails to open rather than returning garbage · an
      exception's message contains neither the plaintext nor any base64 of the key.
      Instrumented (real Keystore): the prefs key reports `isUserAuthenticationRequired == false`
      — **this is the assertion that matters and it cannot run on the JVM**, Robolectric has no
      Keystore.
- [ ] **Step 2:** Run — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the JVM suite — expected PASS. The instrumented assertion is recorded in
      `docs/13-on-device-verification.md` for the next device session; do not claim it passed
      without a device.
- [ ] **Step 5: Commit** `feat(security): add an unauthenticated Keystore key for listener prefs`

---

### Task 2: Seal the sensitive prefs

**Files:**
- Modify: `.../CapturePrefs.kt`
- Test: `.../src/test/java/.../CapturePrefsTest.kt` (extend)

**Rules:**
1. **Sealed:** `provider_filter`, `observed_packages` (Task 3), `last_capture_at`.
   **Left plaintext:** `capture_enabled`, `listener_connected` — two booleans that reveal nothing
   about the user's finances. Encrypting them would buy nothing and cost a decrypt on the hot
   path.
2. `shouldCapture()` runs on **every notification**, so it decrypts the filter each call. Measure
   it. AES-GCM over a few hundred bytes should be microseconds; if it is not, cache the decrypted
   filter in memory for the process lifetime and invalidate on write — but **do not** cache
   speculatively before measuring.
3. **One-time migration.** An install upgrading from the plaintext format must read the old
   values, write them sealed, and **delete the plaintext keys**. A migration that leaves the
   plaintext behind fixes nothing — the whole point is that the old value stops existing on disk.
4. Still never throws. A prefs value that cannot be opened falls back to its documented default
   (`capture enabled, allow all`), matching the existing class contract.

- [ ] **Step 1: Write the failing tests:** a provider filter round-trips through a new
      `CapturePrefs` instance · **the raw `SharedPreferences` string for `provider_filter` does not
      contain any selected package name** (the actual privacy assertion — assert on the raw stored
      value, not through the accessor, or the test passes against no encryption at all) · migration
      from a plaintext filter seals it **and removes the plaintext key** · an unopenable value
      falls back to allow-all rather than throwing · the two non-sensitive booleans are unchanged.
- [ ] **Step 2:** Run — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole module suite — expected PASS.
- [ ] **Step 5: Commit** `feat(security): seal the provider filter and capture timestamps at rest`

---

### Task 3: Learn real package names

**Files:**
- Modify: `.../CapturePrefs.kt`, `.../PeraPlanoNotificationListenerService.kt`
- Modify: `.../NotificationListenerModule.kt`, `mobile/modules/notification_listener/index.ts`
- Test: the matching test files

**Interfaces:**
```kotlin
data class ObservedPackage(val packageName: String, val count: Int, val lastSeenAt: Long)
fun recordObservedPackage(packageName: String, atMillis: Long)
fun listObservedPackages(): List<ObservedPackage>   // newest-first
```
```ts
// contract §4 addition
export function listObservedPackages(): Promise<ObservedPackage[]>;
```

**Rules:**
1. Record the package of **every** notification the listener sees — including ones it drops for
   being filtered out or ongoing. A package the user has not selected yet is exactly the one that
   needs to appear in the picker.
2. **Package names only.** Never a title, never body text, never a count of anything but
   occurrences. This list is already sensitive enough to be sealed (Task 2); adding content would
   make it a shadow copy of the notification history the buffer exists to protect.
3. **Bounded:** keep at most 100 packages, evicting least-recently-seen. Unbounded growth in a
   file rewritten on every notification is a performance bug and a privacy one.
4. Recording must not slow the capture path measurably and must never throw — same reasoning as
   the rest of the class.

- [ ] **Step 1: Write the failing tests:** a package is recorded on capture · **a package is
      recorded even when `shouldCapture` returns false** (the picker's whole purpose — a test that
      only checks the captured path would pass against an implementation that never surfaces
      unselected apps) · the count increments and `lastSeenAt` advances · the list is newest-first
      · the 101st distinct package evicts the least-recently-seen · **the stored blob contains no
      notification title or body**.
- [ ] **Step 2:** Run — expected FAIL.
- [ ] **Step 3:** Implement, and add `listObservedPackages` to the bridge and `index.ts`.
- [ ] **Step 4:** Run both suites — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(mobile): learn observed notification packages for provider selection`

---

### Task 4: The onboarding picker

**Files:**
- Create: `mobile/app/(onboarding)/providers.tsx`, `mobile/components/onboarding/provider_picker.tsx`
- Create: `mobile/lib/ingest/provider_catalogue.ts`
- Test: `mobile/components/onboarding/__tests__/provider_picker.test.tsx`

**Interfaces:**
```ts
type ProviderChoice = {
  packageName: string;
  displayName: string;          // seed providerKey when known, else the package name
  seen: boolean;                // observed on this device
  suggested: boolean;           // present in seed.json
};
buildProviderChoices(observed: ObservedPackage[], bundle: RulesetBundle): ProviderChoice[];
```

**Rules:**
1. Two groups, observed first: **"Apps we've seen"** then **"Common in the Philippines"**. Observed
   entries carry real package names from Android; suggestions carry the seed's *unverified* ones.
2. **Selecting nothing must mean capture-everything, not capture-nothing.** `getProviderFilter()`
   already treats an empty set as allow-all and the fresh-install default depends on it. A picker
   that writes an empty explicit selection would silently disable the whole product.
3. Skippable, like every onboarding step except the recovery phrase.
4. A seed provider whose package was **also observed** appears once, in the observed group, marked
   suggested — never twice.
5. The screen states plainly that PeraPlano reads notifications only from the selected apps. It is
   the moment the privacy promise becomes concrete.

- [ ] **Step 1: Write the failing tests:** observed and suggested are grouped and ordered ·
      **a package that is both observed and suggested appears exactly once** · selecting none
      writes an empty filter and capture stays enabled (assert `shouldCapture` is still true for
      an arbitrary package) · a selection writes through to `setProviderFilter` · the step is
      skippable · an observed package absent from the seed still renders, using its package name.
- [ ] **Step 2:** Run — expected FAIL.
- [ ] **Step 3:** Implement and register the step in the onboarding flow.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(onboarding): let users pick which apps PeraPlano listens to`

---

### Task 5: Documentation and contract

**Files:**
- Modify: `docs/superpowers/plans/2026-08-02-00-interface-contract.md` §4
- Modify: `docs/12-encryption-and-app-lock.md`
- Modify: `docs/13-on-device-verification.md`
- Modify: `docs/04-features/01-onboarding.md`

**Rules:**
1. Contract §4 gains `listObservedPackages()` and the `ObservedPackage` type.
2. `docs/12` gains a short section on the prefs key: what it protects (offline filesystem read),
   what it explicitly does not (code running as our UID), and why that asymmetry is acceptable
   under §4's existing threat model. **Record that the provider filter was plaintext before this
   plan** — a threat model that quietly acquires a fix reads as though it was never broken.
3. `docs/13` gains the instrumented assertion from Task 1 (prefs key is not auth-bound) and a
   device check: **confirm the selected package names match the real installed apps**, which is
   the check that finally retires the seven guessed names.
4. `docs/04-features/01-onboarding.md` gains the provider step.

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2:** Full JS suite and Kotlin suite green; `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** `docs: record provider selection and the encrypted prefs key`

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–5 committed; both suites green; `tsc --noEmit` clean.
- [ ] `mobile/android/` NOT committed and `package.json` reverted after every prebuild cycle.
- [ ] **No new Android permission was added** — verify against the generated manifest, not the
      source.
- [ ] The raw `SharedPreferences` file contains no selected package name (asserted on the stored
      value, not through the accessor).
- [ ] The plaintext-to-sealed migration deletes the old keys.
- [ ] An empty selection still means allow-all.
- [ ] Deferred to a device session: the prefs key is not auth-bound (instrumented), and the picker
      lists the user's real financial apps.
