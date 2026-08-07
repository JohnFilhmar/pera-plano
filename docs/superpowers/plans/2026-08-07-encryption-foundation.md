# Encryption Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt PeraPlano's local database, its notification-capture buffer, and its persisted query cache; put the app behind a biometric or device-credential lock; and give the user a recovery phrase that survives Keystore invalidation and enables cloud restore on a new device.

**Architecture:** A random 256-bit DEK encrypts the SQLite database through SQLCipher. That DEK is stored twice, wrapped once by a hardware-backed Android Keystore key (unsealed by biometric or device credential) and once by an Argon2id-derived key from a user-held recovery phrase. The notification listener, which runs with no user present, writes captures under an RSA-OAEP + AES-GCM envelope using a Keystore public key it can read without authenticating, while the matching private key stays auth-gated. Behavior is specified in `docs/12-encryption-and-app-lock.md`; where this plan and that spec disagree, the spec wins and the plan is the bug.

**Tech Stack:** `@op-engineering/op-sqlite` (SQLCipher-enabled, replaces `expo-sqlite`) · Android Keystore via a Kotlin Expo module · `expo-local-authentication` (BiometricPrompt) · Argon2id · TypeScript ~5.9 strict · Kotlin · jest + jest-expo · JUnit 4 + Robolectric.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW for existing names; this plan **amends** it (Task 1) rather than diverging from it silently.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms; Kotlin keeps JVM idioms (PascalCase files, lowercase package).
- **Currency:** integer **centavos**. **Time:** epoch **milliseconds**; calendar dates `'YYYY-MM-DD'`. **IDs:** UUIDv4.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → green → commit.
- **Test commands:** JS `npx jest --ci`, typecheck `npx tsc --noEmit`. Kotlin: `npx expo prebuild --platform android`, then `.\gradlew.bat :notification_listener:testDebugUnitTest` from the generated `mobile/android/`, then **delete `mobile/android/`**, revert the `"ios"` script prebuild injects into `package.json`, and confirm `git status` is clean.
- **CNG:** never commit `mobile/android/`, `mobile/ios/`, `build/`, `.gradle/`, `.cxx/`.
- **Privacy — absolute:** the native layer never logs notification content. Logs carry package names, counts, and timestamps only. **No key material, no plaintext, and no recovery phrase may ever reach a log, a crash report, or an error message.**
- **No user data exists.** Nothing has shipped. There is no migration path to write and none is wanted — if you find yourself writing one, stop and ask.

### What earlier plans delivered (consume, do not redo)

| From | You get |
|---|---|
| Foundation Tasks 1–18 | `lib/db/database.ts` (`getDatabase`, `closeDatabase`), migration runner, `001_core.sql` (19 tables), all repositories, `types/domain.ts`, `lib/entitlements.ts`, gates, `queryClient` + `persistOptions`, five-tab app shell with a three-condition render gate |
| M1a Tasks 1–3 | `mobile/modules/notification_listener/` — autolinked local Expo module, `CaptureRecord` (json + map encodings), `CaptureBuffer` (bounded, disk-backed, atomic write via `Files.move`) |

### Position

This plan runs **between M1a Task 3 and M1a Task 4**. It is sequenced here deliberately: the capture buffer exists and is the thing that must become encrypted, while the listener service, the module bridge, and every UI screen that displays decrypted data do not exist yet. Doing this later means reworking all of them.

---

### Task 1: Amend the interface contract

**Files:**
- Modify: `docs/superpowers/plans/2026-08-02-00-interface-contract.md`

No code. This task exists because four other plans consume these seams by name, and they must not each invent their own.

**Add to the contract:**
- **§3** — `lib/db/database.ts` gains `unlockDatabase(dek: Uint8Array): Promise<void>` and `isDatabaseUnlocked(): boolean`. `getDatabase()` now **throws** `DatabaseLockedError` when called before unlock, rather than silently opening an empty database. Every repository call therefore has a new failure mode; note it.
- **§4** — the native module gains `getCapturePublicKey(): Promise<string>` (SPKI, base64) and `decryptCaptures(lines: string[]): Promise<RawCapture[]>`. `drainPendingCaptures()` keeps its signature but now returns **decrypted** records and requires the app to be unlocked; say so.
- **New §9, "Key management"** — the DEK/KEK-device/KEK-recovery hierarchy from `docs/12-encryption-and-app-lock.md` §3, the two wrap blobs' storage location, and the rule that the DEK is never written unwrapped.
- **New §10, "App lock"** — cold start plus five-minute background timeout; the DEK is cleared and the database handle closed on lock; the listener keeps capturing while locked.

- [ ] **Step 1:** Make the edits. Cross-check each against `docs/12-encryption-and-app-lock.md` so the contract and the spec agree exactly.
- [ ] **Step 2: Commit**
  ```
  git add docs/superpowers/plans/2026-08-02-00-interface-contract.md
  git commit -m "docs: add key management and app lock seams to the interface contract"
  ```

---

### Task 2: `KeyStoreBridge` — the Keystore wrapper (Kotlin)

**Files:**
- Create: `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/KeyStoreBridge.kt`
- Test: `mobile/modules/notification_listener/android/src/test/java/expo/modules/notificationlistener/KeyStoreBridgeTest.kt`
- Modify: `mobile/modules/notification_listener/android/build.gradle` (add Robolectric — this is the first task needing it)

**Interfaces:**
```kotlin
object KeyStoreBridge {
  fun ensureDeviceKek(): Unit                       // idempotent; creates the AES KEK if absent
  fun wrapWithDeviceKek(plaintext: ByteArray): ByteArray    // returns iv || ciphertext
  fun unwrapWithDeviceKek(blob: ByteArray): ByteArray       // throws KeyPermanentlyInvalidatedException
  fun ensureCaptureKeyPair(): Unit                  // idempotent; RSA-2048
  fun capturePublicKeySpki(): ByteArray             // readable with NO authentication
  fun decryptWithCaptureKey(wrapped: ByteArray): ByteArray  // requires authentication
  fun isDeviceKekUsable(): Boolean                  // false once invalidated
}
```

**Rules:**
1. The AES KEK is `AES/GCM/NoPadding`, 256-bit, `setUserAuthenticationRequired(true)`, `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL)`, StrongBox requested when `PackageManager.FEATURE_STRONGBOX_KEYSTORE` is present and silently falling back when it is not.
2. **`setInvalidatedByBiometricEnrollment(false)`.** Reasoned in `docs/12-encryption-and-app-lock.md` §5: enrolling a biometric already requires the device credential, so the attacker it would defend against is one already outside the threat model, and leaving it `true` destroys user data on a routine settings change.
3. The RSA capture keypair is 2048-bit, `RSA/ECB/OAEPWithSHA-256AndMGF1Padding`, private key `setUserAuthenticationRequired(true)`, public key readable with no auth. RSA rather than ECDH because `PURPOSE_AGREE_KEY` needs API 31 and this app targets 24.
4. Both `ensure*` functions are idempotent and safe on every launch.
5. **No key material in any log, exception message, or stack trace.** An exception may say which operation failed; never what it was operating on.

- [ ] **Step 1: Write the failing tests** (Robolectric, so a Keystore is available): `ensureDeviceKek` is idempotent — calling twice yields the same key alias and does not throw · wrap-then-unwrap round-trips a 32-byte payload exactly · unwrapping a blob whose ciphertext has been altered by one byte throws rather than returning garbage (GCM tag check) · two wraps of the same plaintext produce **different** blobs (IV is not reused — a reused GCM IV is catastrophic) · `capturePublicKeySpki` returns a parseable SPKI key · encrypting with the public key and decrypting with the private key round-trips · `isDeviceKekUsable` is true after `ensureDeviceKek`.
- [ ] **Step 2:** Add Robolectric to `build.gradle` with `testOptions { unitTests.isIncludeAndroidResources = true }`. Do not pin SDK/AGP versions — they come from the root project. Run the tests — expected FAIL.
- [ ] **Step 3:** Implement `KeyStoreBridge.kt`.
- [ ] **Step 4:** Run through the full prebuild cycle — expected PASS. Delete `mobile/android/`, revert the `"ios"` script, confirm clean.
- [ ] **Step 5: Commit**
  ```
  git add mobile/modules/notification_listener/android
  git commit -m "feat(mobile): add keystore bridge for device kek and capture keypair"
  ```

---

### Task 3: Encrypt the capture buffer

**Files:**
- Modify: `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureBuffer.kt`
- Create: `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/CaptureEnvelope.kt`
- Test: `CaptureEnvelopeTest.kt`, and extend `CaptureBufferTest.kt`

**This task subsumes M1a Task 3's outstanding fix round.** That fix asked for a migration from a single JSON array to line-delimited NDJSON plus logging on the degraded paths. Both are still required and both matter more now: an encrypted envelope is per-record by nature, so the format **must** be line-delimited, and a whole-file discard now throws away encrypted records that cannot be inspected to understand why.

**Interfaces:**
```kotlin
object CaptureEnvelope {
  fun seal(record: CaptureRecord, publicKeySpki: ByteArray): String   // one base64 line
  fun open(line: String): CaptureRecord                                // needs the auth-gated private key
}
```
Line format: base64 of `wrappedAesKeyLength(2 bytes) || wrappedAesKey || iv(12) || ciphertext||tag`.

**Rules:**
1. A fresh random AES-256 key and a fresh 96-bit IV **per record**. Never reuse either.
2. `CaptureBuffer` writes sealed lines and never holds plaintext beyond the moment of sealing.
3. **Format is line-delimited.** One sealed record per line. A truncated final line costs exactly that record; every earlier line still opens.
4. A line that fails to open — truncated, corrupt, or sealed under a key that no longer exists — is skipped, counted, and logged as a count only. The rest of the buffer survives.
5. Log every degraded path with metadata only: the `Files.move` fallback firing, a skipped line, a whole-file read failure.
6. The eviction cap, oldest-first eviction, atomic write, and drain semantics from M1a Task 3 are unchanged. Every existing `CaptureBufferTest` must still pass.

- [ ] **Step 1: Write the failing tests:** a sealed line is not readable without the private key (assert the plaintext merchant string does **not** appear in the sealed bytes — the single most important assertion in this task) · seal-then-open round-trips a record exactly, including null fields and a `₱`/newline/quote-bearing text · sealing the same record twice produces different lines (fresh key and IV) · a truncated final line is skipped and all earlier records survive · a corrupt middle line is skipped with neighbours intact · eviction still drops the oldest · a capture whose text contains newlines does not break the line-delimited format.
- [ ] **Step 2:** Run — expected FAIL.
- [ ] **Step 3:** Implement `CaptureEnvelope.kt`; migrate `CaptureBuffer` to line-delimited sealed records.
- [ ] **Step 4:** Full prebuild cycle — expected PASS, including every pre-existing buffer test. Clean up.
- [ ] **Step 5: Commit**
  ```
  git add mobile/modules/notification_listener/android
  git commit -m "feat(mobile): encrypt capture buffer with per-record envelope"
  ```

---

### Task 4: Expose key operations across the bridge

**Files:**
- Modify: `mobile/modules/notification_listener/android/src/main/java/expo/modules/notificationlistener/NotificationListenerModule.kt`
- Modify: `mobile/modules/notification_listener/index.ts`
- Test: `mobile/modules/notification_listener/__tests__/index.test.ts`

**Interfaces** (added to the contract §4 surface in Task 1):
```ts
getCapturePublicKey(): Promise<string>;                 // base64 SPKI, no auth
wrapWithDeviceKek(plaintextB64: string): Promise<string>;
unwrapWithDeviceKek(blobB64: string): Promise<string>;  // rejects with DeviceKeyInvalidated
isDeviceKeyUsable(): Promise<boolean>;
drainPendingCaptures(): Promise<RawCapture[]>;          // now decrypts; requires unlock
```

**Rules:**
1. `drainPendingCaptures` keeps its existing name and return shape. Callers do not learn that captures were ever encrypted — the decryption happens below the bridge.
2. A `KeyPermanentlyInvalidatedException` crossing the bridge becomes a distinguishable rejection (`DeviceKeyInvalidated`), because the JS side must react by prompting for the recovery phrase rather than by showing a generic failure.
3. Binary crosses the bridge as base64 strings, never as arrays of numbers.

- [ ] **Step 1: Write the failing tests** with the native module mocked: each function delegates with the right arguments · `drainPendingCaptures` returns typed `RawCapture` objects · a `DeviceKeyInvalidated` native rejection surfaces as a distinguishable error type, not a generic `Error`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement both sides. **Step 4:** Run — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add mobile/modules/notification_listener
  git commit -m "feat(mobile): expose key operations and decrypting drain across the bridge"
  ```

---

### Task 5: `lib/crypto/recovery_phrase.ts`

**Files:**
- Create: `mobile/lib/crypto/recovery_phrase.ts`, `mobile/lib/crypto/wordlist.ts`
- Test: `mobile/lib/crypto/__tests__/recovery_phrase.test.ts`

**Interfaces:**
```ts
generatePhrase(): string[];                                   // 12 words
deriveRecoveryKey(phrase: string[], salt: Uint8Array): Promise<Uint8Array>;  // Argon2id → 32 bytes
normalizePhrase(input: string): string[];                     // trim, lowercase, collapse whitespace
validatePhrase(words: string[]): { ok: boolean; badIndexes: number[] };
```

**Rules:**
1. Words come from cryptographically secure randomness (`expo-crypto`), never `Math.random`.
2. Argon2id parameters are tuned so derivation takes roughly 500 ms–1 s on a mid-range Android device — slow enough to matter, fast enough that recovery is not abandoned. Record the chosen parameters in a comment; they become part of the on-disk format and cannot change without breaking existing phrases.
3. `normalizePhrase` accepts what a human actually types: extra spaces, mixed case, a trailing newline from a paste.
4. `validatePhrase` reports **which** words are bad so the UI can highlight them. A bare "invalid phrase" for one mistyped word out of twelve is hostile.
5. **The phrase never touches a log, an analytics event, or an error message.**

- [ ] **Step 1: Write the failing tests:** a generated phrase is 12 words, all from the wordlist · two generations differ (assert across many draws, not two) · the same phrase and salt derive the same key · a different salt derives a different key · one changed word derives a completely different key · `normalizePhrase` handles mixed case, doubled spaces, and a trailing newline · `validatePhrase` returns the exact indexes of bad words · derivation takes longer than a floor that would indicate the KDF was accidentally configured with trivial parameters.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit**
  ```
  git add mobile/lib/crypto
  git commit -m "feat(crypto): add recovery phrase generation and argon2id derivation"
  ```

---

### Task 6: `lib/crypto/key_manager.ts` — the DEK lifecycle

**Files:**
- Create: `mobile/lib/crypto/key_manager.ts`
- Test: `mobile/lib/crypto/__tests__/key_manager.test.ts`

**Interfaces:**
```ts
type KeyState = "uninitialized" | "locked" | "unlocked";
initializeKeys(phrase: string[]): Promise<void>;    // first run: make a DEK, write both wraps
unlockWithDeviceKey(): Promise<Uint8Array>;         // returns the DEK; throws DeviceKeyInvalidated
unlockWithRecoveryPhrase(phrase: string[]): Promise<Uint8Array>;
rewrapAfterInvalidation(phrase: string[]): Promise<void>;   // recreate KEK-device, rewrite that wrap
getKeyState(): Promise<KeyState>;
lock(): void;                                       // zero the in-memory DEK
```

**Rules:**
1. The DEK is 256 bits from a CSPRNG, generated exactly once, on first run.
2. **It is never written unwrapped.** Two wrap blobs and a salt go to `expo-secure-store`; the DEK itself exists only in memory while unlocked.
3. `unlockWithDeviceKey` failing with an invalidated key is a **recoverable** state, not an error state — the caller prompts for the phrase and calls `rewrapAfterInvalidation`, which restores normal biometric unlock without re-encrypting the database.
4. `lock()` overwrites the DEK buffer before dropping the reference. Best-effort in JS, but do it — the alternative is leaving key material for the GC to scatter.
5. A wrong recovery phrase fails cleanly on the GCM tag check. It must be impossible to distinguish "wrong phrase" from "corrupt blob" in the error surfaced to the caller — anything finer is an oracle.

- [ ] **Step 1: Write the failing tests** with the native bridge mocked: `initializeKeys` writes both wraps and no bare DEK (assert the raw stored values do not contain the DEK bytes) · both unlock paths return the **same** DEK · a wrong phrase throws and does not reveal which part failed · `rewrapAfterInvalidation` produces a device wrap that then unlocks to the same DEK · `getKeyState` reports each of the three states correctly · `lock()` makes a subsequent DEK read unavailable · initializing twice does not overwrite an existing DEK (that would orphan the whole database).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit**
  ```
  git add mobile/lib/crypto
  git commit -m "feat(crypto): add dek lifecycle with device and recovery unwrap paths"
  ```

---

### Task 7: Swap `expo-sqlite` for SQLCipher-backed `op-sqlite`

**Files:**
- Modify: `mobile/package.json`, `mobile/app.json`, `mobile/lib/db/database.ts`, `mobile/test_support/expo_sqlite_mock.ts` (rename to `sqlite_mock.ts`), jest `moduleNameMapper`
- Test: extend `mobile/lib/db/__tests__/database.test.ts`

**Interfaces:**
```ts
unlockDatabase(dek: Uint8Array): Promise<void>;   // opens the SQLCipher DB with this key
isDatabaseUnlocked(): boolean;
getDatabase(): Promise<DB>;                        // now THROWS DatabaseLockedError before unlock
closeDatabase(): Promise<void>;                    // also clears the key
```

**Rules:**
1. `getDatabase()` throwing when locked is the point. Returning a fresh empty database instead would let repositories silently write into a second, unencrypted store — data loss that looks like a working app.
2. The migration runner runs **after** unlock, on the decrypted handle. Migrations are unchanged; `001_core.sql` is untouched.
3. **The Jest mock stays plaintext `sql.js`.** Repository tests exercise repository logic, not encryption. Encryption is proven by the Kotlin tests and the on-device check in Task 10. Do not attempt to make SQLCipher run under Jest.
4. Keep the `sql.js/dist/sql-asm.js` subpath import in the mock — the WASM build throws under Jest, and the comment explaining that must survive the rename.

- [ ] **Step 1: Write the failing tests:** `getDatabase()` before unlock throws `DatabaseLockedError` · after `unlockDatabase(dek)` it resolves · `closeDatabase()` returns it to the locked state · `isDatabaseUnlocked()` tracks all three transitions · migrations run after unlock and create all 19 tables.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Install `@op-engineering/op-sqlite`, remove `expo-sqlite`, implement. **Step 4:** Run the **full** suite — every repository test must still pass unchanged. `npx tsc --noEmit` clean.
- [ ] **Step 5:** Verify the app still builds: `npx expo export --platform android`.
- [ ] **Step 6: Commit**
  ```
  git add mobile
  git commit -m "feat(db): move to sqlcipher via op-sqlite behind an unlock gate"
  ```

---

### Task 8: Encrypt the persisted React Query cache

**Files:**
- Modify: `mobile/lib/query_client.ts`
- Create: `mobile/lib/crypto/cache_cipher.ts`
- Test: `mobile/lib/crypto/__tests__/cache_cipher.test.ts`

**Rules:**
1. The persisted cache currently lands in AsyncStorage in the clear and holds amounts, merchant names and balances. Encrypt it with AES-256-GCM under a key wrapped exactly like the DEK.
2. The cipher key must be available **before** `PersistQueryClientProvider` mounts, which means after unlock. The root layout's render gate gains a fourth condition in Task 9.
3. A cache blob that fails to decrypt is **discarded, not fatal** — it is a cache. Log a count, start empty, move on.
4. Bump the persister's `buster` string. Any cache written before this change is plaintext and must never be read back.

- [ ] **Step 1: Write the failing tests:** encrypt-then-decrypt round-trips a nested object · the ciphertext does not contain a plaintext merchant string from the input · a tampered blob fails to decrypt rather than returning partial data · a failed decrypt yields an empty cache rather than throwing.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit**
  ```
  git add mobile/lib
  git commit -m "feat(crypto): encrypt the persisted query cache at rest"
  ```

---

### Task 9: App lock — gate, timeout, and the locked screen

**Files:**
- Create: `mobile/app/lock.tsx`, `mobile/contexts/lock_context.tsx`, `mobile/components/lock/unlock_prompt.tsx`, `mobile/components/lock/recovery_unlock_form.tsx`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/contexts/__tests__/lock_context.test.tsx`, `mobile/app/__tests__/lock_gate.test.tsx`

**Rules:**
1. Locked on cold start. Locked again after **five minutes** in the background, measured from when the app backgrounded, not from last interaction.
2. `expo-local-authentication` with biometric-or-device-credential. Never biometric-only — users without enrolled biometrics must still be able to open their own app.
3. On `DeviceKeyInvalidated`, the prompt switches to the recovery-phrase form and calls `rewrapAfterInvalidation` on success, so the user is back to biometric unlock next launch. Explain in plain language why they are being asked — a bare "enter your recovery phrase" after a routine settings change reads like the app is broken or compromised.
4. `lock()` clears the DEK **and** closes the database handle. Leaving it open would keep the plaintext page cache alive.
5. The root layout's render gate gains a fourth condition: fonts, theme, bootstrap, **and unlocked**.
6. The listener keeps capturing while locked. Nothing in this task touches it.

- [ ] **Step 1: Write the failing tests:** cold start renders the lock screen, not the tabs · a successful unlock renders the tabs · backgrounding for four minutes does not re-lock; six minutes does · `DeviceKeyInvalidated` shows the recovery form rather than a generic error · a successful recovery unlock calls `rewrapAfterInvalidation` · locking closes the database handle · **each of the four render-gate conditions is pinned by its own test** (the foundation's Task 17 review found two of three gates unprotected — do not repeat that).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add mobile/app mobile/contexts mobile/components/lock
  git commit -m "feat(security): add app lock with biometric and recovery unlock"
  ```

---

### Task 10: Onboarding capture of the recovery phrase

**Files:**
- Create: `mobile/app/(onboarding)/recovery_phrase.tsx`, `mobile/components/onboarding/phrase_display.tsx`, `mobile/components/onboarding/phrase_confirm.tsx`
- Test: `mobile/components/onboarding/__tests__/recovery_phrase.test.tsx`

**Note:** this creates the `(onboarding)` route group. The foundation deliberately deleted `app/index.tsx`'s branch to it so that the branch and the route would arrive together — **restore the branch in this task**, reading `onboarding_complete` from `app_settings_repo`.

**Rules:**
1. **Mandatory.** There is no skip. Onboarding does not complete and tracking does not start until the phrase is confirmed.
2. Show all twelve words at once, numbered, in a copyable block, with an explicit warning that this is the only way to recover the data.
3. Confirm by asking for **three words at random positions**. Full re-entry is punishing; zero confirmation means the user did not write it down.
4. Explain the stakes in one plain sentence before showing the words. Not "cryptographic recovery material" — something closer to "if you get a new phone or reset your fingerprint, this is the only way back to your data."
5. Offer a share/copy action, and warn that a screenshot lands in the photo library.
6. `initializeKeys(phrase)` is called on confirmation, before any wallet or transaction can exist.

- [ ] **Step 1: Write the failing tests:** twelve numbered words render · confirmation asks for three positions and rejects a wrong word at the right index · confirmation accepts correct words regardless of case and surrounding whitespace · there is no skip affordance anywhere on the screen · successful confirmation calls `initializeKeys` exactly once · onboarding cannot advance past this step without it · the entry route sends a user with `onboarding_complete` false here, and one with it true to the tabs.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit**
  ```
  git add mobile/app mobile/components/onboarding
  git commit -m "feat(onboarding): capture and confirm the recovery phrase"
  ```

---

### Task 11: Green-gate and on-device verification

**Files:** none created — this proves the encryption is real rather than nominal.

- [ ] **Step 1:** Full suite `npx jest --ci` and `npx tsc --noEmit` — both clean.
- [ ] **Step 2:** Full Kotlin suite through the prebuild cycle — clean. Delete `mobile/android/`, confirm `git status` clean.
- [ ] **Step 3:** Grep audits, each must come back empty: any log, `console.*`, or exception message containing a key, a DEK, a phrase, or notification text; `expo-sqlite` still imported anywhere; a bare DEK written to `expo-secure-store`.
- [ ] **Step 4: On-device proof — the whole point of this plan.** On a real device: complete onboarding including the recovery phrase · trigger a provider notification while the app is **closed** and confirm it is captured · pull the buffer file with `adb` and confirm the notification text is **not** readable in it · pull the database file and confirm a plain `sqlite3` client **rejects** it as encrypted or not-a-database · unlock the app and confirm the capture appears in the ledger · background for six minutes and confirm the app re-locks · force-remove and re-add the screen lock, confirm the app detects the invalidated key, prompts for the recovery phrase, and restores access to the **same** ledger with no data loss.
- [ ] **Step 5: Commit**
  ```
  git commit --allow-empty -m "test(security): record on-device encryption verification results"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–11 committed; JS and Kotlin suites green; `tsc --noEmit` clean.
- [ ] The database file is unreadable by a plain SQLite client (proven on device, not asserted).
- [ ] The capture buffer contains no readable notification text (proven on device).
- [ ] Both unlock paths yield the same DEK; removing the screen lock is survivable via the recovery phrase with zero data loss.
- [ ] The listener still captures while the app is locked.
- [ ] No key material, plaintext, or recovery phrase appears in any log or error message.
- [ ] The recovery phrase is mandatory in onboarding and cannot be skipped.
- [ ] Next plan unblocked: `2026-08-02-mobile-ingest-m1a-native-module.md` resumes at **Task 4** (`CapturePrefs`). Its Task 3 fix round is subsumed by Task 3 of this plan.
