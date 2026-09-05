# Encryption and App Lock

This document specifies how PeraPlano protects financial data at rest on the device and in cloud backup, and how the app is locked behind biometric or PIN authentication. It supersedes the earlier assumption that the local database and the notification-capture buffer are stored in plaintext.

**Status:** Draft v1 · 2026-08-07 · §3/§4/§6a/§8 updated 2026-08-14 (the listener's preferences key) · §5/§8/§9/§11 corrected 2026-09-05 (what is built, versus what is designed)

---

## 1. Why this exists

PeraPlano's local database holds a complete picture of a person's money: every transaction, who they paid, what they earn, what they owe, and 30 days of raw bank notification text including the names of people who sent them money. The product's stated promise is that this data is parsed on the device and never leaves it. Storing it in plaintext honors the "never leaves" half and not the "protected" half.

Two decisions follow, and they are separate:

- **Encryption at rest** protects the data from anything that can read the filesystem — a rooted device, a malicious app with storage access, an unencrypted device backup, forensic extraction from a stolen phone.
- **App lock** protects the data from someone holding the *unlocked* phone. A partner, a colleague, a thief who grabbed it mid-use.

Neither substitutes for the other.

## 2. What is NOT the design, and why

**Biometrics cannot be an encryption key.** A fingerprint sensor returns slightly different data on every read, and Android never exposes the fingerprint to an app at all. What the platform provides is an *authentication result* that authorizes use of a key already sealed in hardware. Biometrics gate a key; they do not derive one.

**A PIN alone cannot be the key.** A 4–6 digit PIN spans 10⁴–10⁶ possibilities. An attacker holding the encrypted database file can exhaust that offline in seconds regardless of how slow the key-derivation function is. A PIN is only safe as key material when the derivation is bound to hardware that enforces rate limiting and refuses to export the key — which is exactly what the Android Keystore does.

So the design below uses a random data key, sealed in hardware, unsealed by the user's biometric or device credential.

## 3. Key hierarchy

Four keys, each with one job. The first three protect the ledger and are unlocked by the user; the fourth protects the listener's own settings and is unlocked by nothing at all, deliberately — §6a is where that is argued.

| Key | What it is | Where it lives | What unlocks it |
|---|---|---|---|
| **DEK** (Data Encryption Key) | Random 256-bit AES key. Encrypts the SQLCipher database. | Never stored bare. Only ever stored wrapped. | Either wrap below |
| **KEK-device** | AES-256 key in the Android Keystore, hardware-backed (StrongBox when the device has it) | Android Keystore. Non-exportable by construction. | Biometric or device credential |
| **KEK-recovery** | Derived from the user's recovery phrase with Argon2id | Never stored. Re-derived from the phrase when needed. | The user typing or pasting their phrase |
| **KEK-prefs** | AES-256 key in the Android Keystore with `setUserAuthenticationRequired(false)`. Seals the sensitive values in the notification listener's `SharedPreferences`. Alias `peraplano.prefs_kek`. | Android Keystore. Non-exportable, but usable by anything running as our UID. | **Nothing** — see §6a |

The DEK is written to disk twice, wrapped once by KEK-device and once by KEK-recovery. Either path yields the same DEK. This is what makes the system survive the failure described in §5 while still allowing cloud restore on a new device. **KEK-prefs never touches the DEK** and is not a third unwrap path: it seals a handful of small settings values and nothing else.

**Why a random DEK rather than deriving the database key straight from the Keystore key:** re-wrapping is cheap, re-encrypting a database is not. When the user changes their recovery phrase, or the Keystore key is invalidated and re-created, only the two small wrap blobs change. The database is untouched.

## 4. Threat model

What this design defends against, honestly scoped:

| Threat | Defended | How |
|---|---|---|
| Stolen or lost device, screen locked | Yes | Data is SQLCipher-encrypted; the DEK requires hardware-backed auth |
| Malicious app reading app-private storage on a rooted device | Yes | The database file is ciphertext; the buffer is ciphertext; the listener's sensitive preferences are ciphertext (§6a) |
| Unencrypted cloud device-backup (adb backup, OEM sync) | Yes | Same — everything at rest is ciphertext |
| Someone handed the unlocked phone | Yes | App lock, §7 |
| Server operator or a server breach reading user finances | Yes | The vault blob is encrypted client-side; the server holds opaque bytes |
| Attacker who knows the device screen-lock PIN | **No** | They can enroll a biometric, unlock the Keystore, and open the app. This is out of scope — that attacker already owns the device |
| Targeted forensic extraction with hardware attacks on the secure element | **No** | Out of scope for a consumer finance app |
| Malware with root running *while the app is unlocked* | **No** | The DEK is in process memory by necessity |

Naming the last three matters. A design that claims to stop them would be lying.

### The second row was not true of every file until 2026-08-14

**The notification listener's provider filter was stored in plaintext**, from the listener's first commit until the provider-selection plan sealed it on **2026-08-14**. So was `last_capture_at`. Both sat in `shared_prefs/peraplano_capture_prefs.xml`, app-private but entirely unencrypted, beside a database and a capture buffer this table has always correctly described as ciphertext. Anything that could read app-private storage could read them with a single `cat`, and what it got back was a list of every bank and e-wallet the user had selected — the same disclosure the ledger encryption exists to prevent, in a smaller and much easier file.

Both are now sealed under KEK-prefs (§6a), and a one-time migration deletes the plaintext keys. `observed_packages` was introduced already sealed and has never existed in plaintext on any device.

This is recorded rather than quietly corrected. A threat model that acquires a fix without ever admitting the gap reads as though it was never broken — and the next person deciding whether some *other* value is safe where it sits needs to know that a value in this exact table's scope once was not.

## 5. The recovery problem

Android invalidates a Keystore key configured with `setUserAuthenticationRequired(true)` when the user **removes their screen lock entirely**. Depending on configuration it may also invalidate on biometric re-enrollment. Invalidation is destruction, not lockout — the key is gone and the OS will not return it.

If the DEK were wrapped only by KEK-device, a user who adds a fingerprint or switches from PIN to pattern would lose their entire financial history with no recourse. That is unacceptable for this product, and it is a routine thing for people to do.

Two mitigations, both applied:

1. **`setInvalidatedByBiometricEnrollment(false)`.** This keeps the key alive when a new fingerprint is enrolled. It is defensible here rather than merely convenient: enrolling a biometric already requires the device screen-lock credential, so an attacker able to do it is one this design explicitly does not defend against (§4). Removing the screen lock still invalidates, unavoidably.

2. **A mandatory recovery phrase, captured during onboarding.** Twelve words from the **BIP-39 English wordlist**, generated by the app, shown once, confirmed by re-entering three of them at random positions. This is the second unwrap path. It is the only key material that *could* ever travel to a new device, because KEK-device by construction cannot; it does not travel yet.

**What the phrase recovers today: this device, and only this device.** `unlockWithRecoveryPhrase` re-derives KEK-recovery from the words and opens a wrap blob it reads out of *this* device's SecureStore (`mobile/lib/crypto/key_manager.ts:171`, `unwrapWithRecoveryPhrase`). Nothing copies that blob or its salt off the phone: cloud backup is not implemented, and the data export (`mobile/lib/privacy/data_export.ts`) deliberately carries no key material at all. So the case the phrase actually covers is the one §5a describes, a screen lock removed and KEK-device destroyed with the phone still in the user's hand. A lost, stolen or wiped phone leaves the words with nothing to open. The phrase becomes new-device recovery only once backup ships.

**The onboarding copy is ahead of the build.** `mobile/components/onboarding/phrase_display.tsx:104` tells the user "If you ever get a new phone, or turn off and reset your fingerprint or PIN, these 12 recovery words are the only way back to your data". The second half is true today; the first half describes the design rather than the build. Either that sentence narrows or backup ships, before anyone relies on it.

**Why BIP-39:** 2048 unambiguous words, no two of which share their first four letters, plus a built-in checksum. The checksum matters more than it sounds — it lets the app reject a phrase that is internally inconsistent *before* attempting a slow Argon2id derivation, so a user who mistyped one word gets "word 7 looks wrong" in milliseconds instead of a generic failure after a second of grinding. Hand-rolling a wordlist would mean hand-rolling those properties, and homophone or spelling ambiguity in a recovery phrase is a data-loss bug.

The list is a cryptocurrency-adjacent artifact, and a user who googles a word may land on wallet pages. Mitigate in copy, not in engineering: the UI says "recovery words", never "seed phrase" or "wallet". No jargon, no explanation of where the list came from.

**The recovery phrase is mandatory, not optional.** Onboarding does not complete without it. This is deliberate friction in a flow that is already asking for an alarming permission, and it is worth it: the alternative is a support burden of users who lost years of financial history to a routine phone settings change, correctly blaming the app.

## 5a. A device screen lock is a hard requirement

Android will not create a Keystore key with `setUserAuthenticationRequired(true)` on a device that has no screen lock configured. There is no workaround: without a PIN, pattern, password or enrolled biometric, there is nothing for the secure element to authenticate against, and `KeyGenParameterSpec` throws at generation time.

**PeraPlano requires a device screen lock.** Onboarding checks `KeyguardManager.isDeviceSecure()` and, if false, explains why and sends the user to `Settings.ACTION_SECURITY_SETTINGS` to set one. Onboarding does not continue until they have.

This costs users. A meaningful share of budget Android devices in the Philippines ship without a screen lock and their owners never set one, and this is a wall on an early screen, before the product has demonstrated any value. The alternative — falling back to an app-specific PIN derived with Argon2id and no secure element — was rejected: without hardware rate limiting, a stolen phone's database is offline-brute-forceable against a six-digit PIN in seconds, and the app would then be making a hardware-protection claim that is false for exactly the users least likely to notice. One honest story for every install is worth more than the marginal installs.

**Mid-life removal.** A user can remove their screen lock after onboarding. Android destroys the Keystore key when they do. The app detects this on next unlock (`isDeviceKeyUsable()` returns false), explains what happened in plain language, requires the recovery phrase, and requires a screen lock to be set again before re-wrapping. The database is never re-encrypted — only the device wrap blob is rewritten.

## 6. Capturing notifications while the app is locked

This is the constraint that shapes everything, and it is easy to miss.

The `NotificationListenerService` runs whether or not the app is open. Captures arrive at 3am with no user present, no biometric prompt possible, and no DEK in memory. The listener must be able to write, and must not be able to read.

**Solution: asymmetric envelope encryption.**

An RSA-2048 keypair lives in the Android Keystore. The **private key** is configured `setUserAuthenticationRequired(true)` — it can only be used after the user authenticates. The **public key** is readable at any time by anyone, which is the whole point of a public key.

For each capture the listener:
1. Generates a random 256-bit AES key and a 96-bit IV.
2. Encrypts the capture JSON with AES-256-GCM.
3. Encrypts that AES key with the Keystore public key using RSA-OAEP (SHA-256).
4. Appends one line: the wrapped AES key, the IV, and the ciphertext, base64-encoded.

The listener can write captures forever and read back none of them. When the user next unlocks the app, the private key becomes usable, each line's AES key is unwrapped, and the captures decrypt and flow into the ingest pipeline.

RSA-OAEP is used rather than ECDH because Keystore's `PURPOSE_AGREE_KEY` requires API 31, while this app targets minSdk 24. RSA encrypt/decrypt in Keystore is available across the whole supported range.

**Consequence for the buffer's design:** the line-delimited format (one self-contained encrypted record per line) becomes more important, not less. A single encrypted blob spanning the whole file could not be appended to without decrypting it first — which the listener cannot do.

## 6a. The listener's preferences key — no authentication, on purpose

§6 solves the capture. This solves the question that comes *before* the capture: **should I capture this at all?**

`PeraPlanoNotificationListenerService` answers that for every notification the device receives, from a process Android may have created purely to host it, at 3am, with the phone locked and no user present. The answer comes out of `CapturePrefs` — the provider allowlist and the global pause switch. Those values therefore have to be readable in precisely the state where the DEK and the capture keypair's private key are not.

**KEK-prefs is an AES-256 Keystore key created with `setUserAuthenticationRequired(false)`** (§3), and every sensitive value in `CapturePrefs` is sealed under it with AES-256-GCM — `KeyStoreBridge.sealPrefsValue` / `openPrefsValue`, storing base64 `iv || ciphertext || tag`. StrongBox is requested with the same fallback as the other keys, and a failure to seal or open throws a payload-free exception that never carries the value or the key.

**What it buys.** Exactly the threat §4 puts in scope and nothing beyond it: an **offline filesystem read** — a stolen phone, an unencrypted device backup, a forensic extraction, a malicious app reading app-private storage on a rooted device. All of those now see base64 ciphertext where they used to see a list of the user's banks.

**What it explicitly does not buy.** Code executing as our UID can ask the Keystore to open these values, because opening them is exactly what the listener does all day. That attacker is already out of scope in §4 — malware with root while the app is unlocked reads the DEK straight out of process memory without touching the Keystore at all — and this key neither improves nor worsens that case.

**Why the asymmetry is acceptable.** Because the alternative here was never a stronger key. An auth-bound key would be unreadable at exactly the moment the value is needed: the listener would fail to read the filter with the phone locked, and `CapturePrefs`'s never-throw contract would fall back to its documented default of *allow all* — capturing from every app on the phone, which is the opposite of what the user asked for, arrived at by making the key stronger. The real alternative was the plaintext this replaced (§4).

### What is sealed, and what is deliberately not

| Value | State | Why |
|---|---|---|
| `provider_filter` | **Sealed** | It names every bank and e-wallet the user holds |
| `last_capture_at` | **Sealed** | A behavioural fact about when they last moved money |
| `observed_packages` | **Sealed** | The apps that notify this phone — the same disclosure as the filter, one step less curated |
| `capture_enabled` | Plaintext | A boolean: is tracking paused. Reveals nothing about anyone's finances |
| `listener_connected` | Plaintext | A boolean: does Android currently have the service bound. Same |

The two booleans are plaintext for a reason past "they are harmless". `shouldCapture()` reads `capture_enabled` on **every** notification, so sealing it would add a decrypt to the hottest path in the module and buy nothing at all.

The filter's own decrypt on that path was **measured rather than assumed**, because "encrypt it and cache the plaintext" is the obvious next move and it is the wrong one. On the JVM an AES-GCM open of a 13-package filter costs ~7 µs per call, against 199 µs for the RSA-OAEP capture envelope built on the very next line of `handlePosted` — about 28× more, on the same delivery. So no cache: it would buy nothing measurable and would risk a stale filter still capturing from a provider the user had just removed. The JVM figure is a **floor** (a real device pays a keystore2 Binder round-trip per `Cipher.init` that the plain-JCE test fake does not model); `docs/13-on-device-verification.md` carries the on-device confirmation.

### The migration, and the one value that has none

An install carrying the pre-2026-08-14 format reads the plaintext `provider_filter` and `last_capture_at`, writes them sealed under **new key names**, and **deletes the plaintext keys in the same `commit()`**. Both halves matter. A migration that wrote a sealed copy and left the original behind would be the failure that looks like success — every accessor would read ciphertext, every seal test would pass, and the preferences file pulled off a stolen phone would still name every bank the user holds. Doing it in one commit means a process death cannot leave plaintext sitting beside its sealed copy; and if the seal fails, nothing is written *or* deleted, because discarding a value it could not preserve would lose the user's provider selection for no gain.

The migration needs no "already migrated" flag: the sealed values live under different key names, so once the plaintext keys are gone there is structurally nothing left for a second run to find. That matters because it runs in a constructor that fires once per notification.

**`observed_packages` has no migration path, and that is not an oversight.** It was introduced already sealed, so no device has ever held a plaintext copy. A migration entry for it would be code that can only ever find an empty result.

## 7. App lock

**Trigger:** the app requires authentication on cold start, and again when it returns to the foreground after **five minutes** in the background. Not on every foreground — PeraPlano's core interaction is a two-second glance at one number, and re-prompting on every glance would train users to disable the feature.

**Mechanism:** `BiometricPrompt` with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`. Accepting device credential means the app works for users with no biometric hardware or no enrolled fingerprint, and gives everyone a fallback when a sensor fails.

**The KEK's authentication validity window is 10 seconds, not per-operation.** This is load-bearing and was nearly wrong.

`setUserAuthenticationParameters(0, …)` — the stricter setting — requires every single use of the key to be authorized by a `BiometricPrompt.CryptoObject` bound to that exact cipher. A generic prompt does not satisfy it. Had the key shipped that way, this section's design would have been unimplementable: the app unlocks with a generic prompt, then unwraps the DEK, and that unwrap would have thrown `UserNotAuthenticatedException` every time.

A short validity window instead lets any successful device authentication make the key usable for ten seconds — ample for the single unwrap that happens immediately after unlock, and short enough to be useless as an attack window.

What the stricter setting would have bought is narrow: protection against code *inside our own process* using the key during that window. Such code runs as our UID and can read the DEK out of process memory without touching the Keystore at all, and §4 already places it out of scope. `CryptoObject` binding remains the upgrade path if the threat model ever tightens — it would mean moving the unwrap inside the native biometric callback.

**What happens while locked:**
- The DEK is cleared from memory and the database handle is closed.
- The listener keeps capturing to the encrypted buffer (§6). Tracking never stops because the app is locked.
- The app's own notifications still fire, with **amount-free copy while the keyguard is on**. See §7a.

**Failure handling:** repeated biometric failure falls through to device credential. There is no app-specific lockout counter — the platform already rate-limits, and adding a second one only creates a way to lock a legitimate user out of their own data.

## 7a. Alert copy on the lock screen

Limit alerts, bill reminders and loan reminders fire whether or not the phone is unlocked, and Android renders them on the lock screen where anyone nearby can read them. A notification reading *"You've spent ₱8,400 of your ₱10,000 limit"* on a phone face-up on a desk or in a jeepney undoes the encryption work in the most visible way possible.

**Every app-generated alert has two copy variants:**

| Context | Copy |
|---|---|
| Keyguard on (locked) | "You've reached 80% of your monthly limit" · "Meralco is due in 3 days" |
| Unlocked | "You've spent ₱8,400 of your ₱10,000 monthly limit" · "Meralco, around ₱2,100, is due in 3 days" |

The locked variant stays genuinely actionable — the user learns there is something to look at — while carrying no amount, no balance, no merchant beyond a name the user themselves configured, and no counterparty.

Implementation: the alerts service checks `KeyguardManager.isKeyguardLocked()` at post time and selects the variant. It is checked at post time, not at schedule time, because a reminder scheduled hours earlier has no idea what state the phone will be in when it fires.

**This binds every task that posts a notification** — the limit alerts in M2, bill and loan reminders in M2b/M2c, and the payday and tracking-interrupted notices in M3. Each must supply both variants. A task that supplies one string is incomplete.

## 8. What is encrypted

The **Status** column is the difference between a design and a shipped guarantee. Read it before quoting a row.

| Data | Mechanism | Status |
|---|---|---|
| The entire SQLite database — all 19 tables, indexes, and the write-ahead log | SQLCipher, AES-256, keyed by the DEK | **Implemented** in `mobile/lib/db/database.ts` (`OpSqlite.open({ encryptionKey })`). Not yet confirmed on a device: docs/13 Part 4 |
| The notification capture buffer | Per-line RSA-OAEP + AES-256-GCM envelope (§6) | **Implemented** in `CaptureEnvelope.kt` |
| The listener's provider filter, last-capture timestamp and observed-package list | AES-256-GCM under KEK-prefs — a Keystore key requiring **no** authentication (§6a). Plaintext until 2026-08-14 | **Implemented** in `KeyStoreBridge.kt` (`sealPrefsValue` / `openPrefsValue`) |
| The persisted React Query cache in AsyncStorage | AES-256-GCM with a key wrapped the same way as the DEK | **Implemented** in `mobile/lib/crypto/cache_cipher.ts` |
| The cloud backup blob | AES-256-GCM under a key derived from the recovery phrase — **not** the device Keystore key, which cannot travel | **Planned.** No backup code exists anywhere in the app; nothing writes, uploads or reads such a blob |
| Server-side storage | The vault column holds client-encrypted bytes; Postgres disk encryption is defense in depth, not the protection | **Planned.** See §9: there is no such server |

Whole-database encryption is chosen over field-level for one reason: it cannot be forgotten. Field-level encryption requires every future column holding sensitive data to be individually remembered, indexes over encrypted columns stop working, and the metadata leaks anyway.

**SQLCipher requires replacing `expo-sqlite` with `op-sqlite`**, which supports it. The blast radius is contained because repositories are the only SQL surface in the codebase — the swap touches `lib/db/` and nothing above it.

## 9. Server side

**None of this section is built.** There is no PeraPlano backup server. `server/` holds a Next.js marketing site (`apps/web`) and a shared `libs/common`; its only route that accepts data is `api/beta-signup`, which forwards to an external webhook. There is no database of any kind in that tree, no vault column, no Postgres, and no upload or restore endpoint. Everything below is the shape the client is already encrypting *for*, not a description of running infrastructure, and no claim in §4 about a server operator or a server breach has been exercised against anything.

When it is built: the interface contract specifies the backup vault as an opaque client-encrypted blob, so the server is zero-knowledge by construction. Nothing about this design changes that; it only makes the client actually do the encrypting.

Two additions, both still to come:
- The vault blob's key derives from the **recovery phrase**, so a user restoring onto a new phone can decrypt it. A device-bound key would make backup useless by definition.
- Postgres at-rest encryption is enabled as operational hardening. It protects against a stolen disk, not against the application, and is not what makes user data private.

## 10. Migration

**There are no users.** Nothing has shipped. This design applies to fresh installs only and requires no data migration, no dual-read path, and no re-encryption pass.

This is the single strongest argument for doing this work now rather than after MVP. The same change against a live user base would need a migration that decrypts nothing, re-keys everything, and cannot be rolled back.

## 11. Testing

Two suites, in two languages, and they do not cover the same things. The split below is the point of this section: **the recovery phrase never reaches Kotlin.** BIP-39 and Argon2id live entirely in JS, so no Kotlin test says anything about a wrong phrase.

- **Device-KEK wrapping and unwrapping** have Kotlin unit tests in `KeyStoreBridgeTest.kt`: wrap then unwrap round-trips exactly, a wrapped blob does not contain its plaintext, two wraps of the same plaintext differ, and altering one byte makes unwrap throw.
- **That a wrong recovery phrase fails cleanly** is a JS test, in `mobile/lib/crypto/__tests__/key_manager.test.ts`: a wrong phrase and a deliberately corrupted blob raise the *same* `RecoveryUnlockFailedError` with the same message, which is the oracle-free behaviour the interface contract's §9 rule 5 requires.
- **Buffer envelope crypto** has Kotlin unit tests in `CaptureEnvelopeTest.kt`: a sealed line does not contain the plaintext merchant name, seal then open round-trips exactly including null fields and hostile text, and opening a line sealed under a different keypair throws instead of returning garbage.
- **The recovery path is covered in JS only**, in `mobile/lib/crypto/__tests__/key_manager.test.ts` (`rewrapAfterInvalidation`): wrap the DEK both ways, simulate the Keystore key being invalidated, unwrap from the phrase, recreate the device key, and confirm the *same* DEK comes back. It stops there. The native bridge is a stateful fake, `deriveRecoveryKey` is stubbed with SHA-256 rather than real Argon2id, and **no database is ever opened**. So a real SQLCipher open after recovery, and real Keystore invalidation, are proven by nothing in either suite: they rest on `docs/13-on-device-verification.md` **Part 4** (encryption end to end) and **Part 5** (remove the screen lock), and both of those are **NOT RUN**.
- **How the Kotlin tests are run, honestly.** They are source in `mobile/modules/notification_listener/android/src/test/`, but the Gradle project that runs them is a prebuild artifact: `mobile/android/` is gitignored, the repo carries no Gradle wrapper, and no CI workflow invokes Gradle. Running them requires `expo prebuild` first. Treat "there is a Kotlin test for that" as a statement about coverage that exists, not about a green run someone has seen recently.
- **SQLCipher cannot run under Jest** — it is native. Repository tests continue against the plaintext `sql.js` mock, which is correct: they test repository logic, not encryption. That the database file on disk is genuinely unreadable is therefore claimed by no automated test at any level, and is settled only by the on-device check in docs/13 Part 4.
- **The on-device checklist gains one item:** pull the database file off the device with `adb` and confirm a plain `sqlite3` client rejects it.

## 11a. The unrecoverable state

A user can reach a state where the data is mathematically gone: they removed their screen lock (destroying the Keystore key) **and** lost their recovery phrase. No amount of engineering recovers a DEK with both wraps unopenable, and no support process can help — that is what zero-knowledge means.

**The app says so plainly and offers a way forward.** The unlock screen detects the state, explains in one sentence that the data cannot be recovered and why, and offers a heavily-confirmed **wipe and start over**: clear the database, both wrap blobs, the capture buffer, and every setting, then re-run onboarding from the beginning.

The alternative — a permanent lock screen pointing at support — was rejected. Support genuinely cannot help, so it generates tickets that can only be answered with "it's gone", and it leaves a bricked app on the phone whose only remaining escape is uninstalling, which loses the same data *plus* the notification-access grant and every setting, while looking like a crash rather than a protection working as designed.

The wipe needs no authentication gate. Someone who cannot decrypt the data also cannot read it, so a wipe destroys but never leaks.

## 12. Open questions

1. **Backup key rotation.** If a user changes their recovery phrase, every previously uploaded vault blob becomes undecryptable. Either re-upload on rotation, or version the blobs and keep the old key wrapped. Decide when cloud backup is implemented, not before.
2. **Lock timeout configurability.** Five minutes is the default. Whether users can change it — and whether "never" is an allowed value — is a settings-screen decision for M3b.
