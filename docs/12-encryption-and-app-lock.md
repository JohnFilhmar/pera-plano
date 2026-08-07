# Encryption and App Lock

This document specifies how PeraPlano protects financial data at rest on the device and in cloud backup, and how the app is locked behind biometric or PIN authentication. It supersedes the earlier assumption that the local database and the notification-capture buffer are stored in plaintext.

**Status:** Draft v1 · 2026-08-07

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

Three keys, each with one job.

| Key | What it is | Where it lives | What unlocks it |
|---|---|---|---|
| **DEK** (Data Encryption Key) | Random 256-bit AES key. Encrypts the SQLCipher database. | Never stored bare. Only ever stored wrapped. | Either wrap below |
| **KEK-device** | AES-256 key in the Android Keystore, hardware-backed (StrongBox when the device has it) | Android Keystore. Non-exportable by construction. | Biometric or device credential |
| **KEK-recovery** | Derived from the user's recovery phrase with Argon2id | Never stored. Re-derived from the phrase when needed. | The user typing or pasting their phrase |

The DEK is written to disk twice, wrapped once by each KEK. Either path yields the same DEK. This is what makes the system survive the failure described in §5 while still allowing cloud restore on a new device.

**Why a random DEK rather than deriving the database key straight from the Keystore key:** re-wrapping is cheap, re-encrypting a database is not. When the user changes their recovery phrase, or the Keystore key is invalidated and re-created, only the two small wrap blobs change. The database is untouched.

## 4. Threat model

What this design defends against, honestly scoped:

| Threat | Defended | How |
|---|---|---|
| Stolen or lost device, screen locked | Yes | Data is SQLCipher-encrypted; the DEK requires hardware-backed auth |
| Malicious app reading app-private storage on a rooted device | Yes | The database file is ciphertext; the buffer is ciphertext |
| Unencrypted cloud device-backup (adb backup, OEM sync) | Yes | Same — everything at rest is ciphertext |
| Someone handed the unlocked phone | Yes | App lock, §7 |
| Server operator or a server breach reading user finances | Yes | The vault blob is encrypted client-side; the server holds opaque bytes |
| Attacker who knows the device screen-lock PIN | **No** | They can enroll a biometric, unlock the Keystore, and open the app. This is out of scope — that attacker already owns the device |
| Targeted forensic extraction with hardware attacks on the secure element | **No** | Out of scope for a consumer finance app |
| Malware with root running *while the app is unlocked* | **No** | The DEK is in process memory by necessity |

Naming the last three matters. A design that claims to stop them would be lying.

## 5. The recovery problem

Android invalidates a Keystore key configured with `setUserAuthenticationRequired(true)` when the user **removes their screen lock entirely**. Depending on configuration it may also invalidate on biometric re-enrollment. Invalidation is destruction, not lockout — the key is gone and the OS will not return it.

If the DEK were wrapped only by KEK-device, a user who adds a fingerprint or switches from PIN to pattern would lose their entire financial history with no recourse. That is unacceptable for this product, and it is a routine thing for people to do.

Two mitigations, both applied:

1. **`setInvalidatedByBiometricEnrollment(false)`.** This keeps the key alive when a new fingerprint is enrolled. It is defensible here rather than merely convenient: enrolling a biometric already requires the device screen-lock credential, so an attacker able to do it is one this design explicitly does not defend against (§4). Removing the screen lock still invalidates, unavoidably.

2. **A mandatory recovery phrase, captured during onboarding.** Twelve words from the **BIP-39 English wordlist**, generated by the app, shown once, confirmed by re-entering three of them at random positions. This is the second unwrap path, and it is also the only key material that can travel to a new device.

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

## 7. App lock

**Trigger:** the app requires authentication on cold start, and again when it returns to the foreground after **five minutes** in the background. Not on every foreground — PeraPlano's core interaction is a two-second glance at one number, and re-prompting on every glance would train users to disable the feature.

**Mechanism:** `BiometricPrompt` with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`. Accepting device credential means the app works for users with no biometric hardware or no enrolled fingerprint, and gives everyone a fallback when a sensor fails.

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

| Data | Mechanism |
|---|---|
| The entire SQLite database — all 19 tables, indexes, and the write-ahead log | SQLCipher, AES-256, keyed by the DEK |
| The notification capture buffer | Per-line RSA-OAEP + AES-256-GCM envelope (§6) |
| The persisted React Query cache in AsyncStorage | AES-256-GCM with a key wrapped the same way as the DEK |
| The cloud backup blob | AES-256-GCM under a key derived from the recovery phrase — **not** the device Keystore key, which cannot travel |
| Server-side storage | The vault column holds client-encrypted bytes; Postgres disk encryption is defense in depth, not the protection |

Whole-database encryption is chosen over field-level for one reason: it cannot be forgotten. Field-level encryption requires every future column holding sensitive data to be individually remembered, indexes over encrypted columns stop working, and the metadata leaks anyway.

**SQLCipher requires replacing `expo-sqlite` with `op-sqlite`**, which supports it. The blast radius is contained because repositories are the only SQL surface in the codebase — the swap touches `lib/db/` and nothing above it.

## 9. Server side

The interface contract already specifies the backup vault as an opaque client-encrypted blob, so the server is zero-knowledge by construction. Nothing about this design changes that; it only makes the client actually do the encrypting.

Two additions:
- The vault blob's key derives from the **recovery phrase**, so a user restoring onto a new phone can decrypt it. A device-bound key would make backup useless by definition.
- Postgres at-rest encryption is enabled as operational hardening. It protects against a stolen disk, not against the application, and is not what makes user data private.

## 10. Migration

**There are no users.** Nothing has shipped. This design applies to fresh installs only and requires no data migration, no dual-read path, and no re-encryption pass.

This is the single strongest argument for doing this work now rather than after MVP. The same change against a live user base would need a migration that decrypts nothing, re-keys everything, and cannot be rolled back.

## 11. Testing

- **Key wrapping and unwrapping** are unit-tested in Kotlin, including that a wrong recovery phrase fails cleanly rather than producing garbage.
- **Buffer envelope crypto** is unit-tested in Kotlin: a capture encrypted with the public key is unreadable without the private key and round-trips exactly with it.
- **The recovery path** is tested end to end: wrap the DEK both ways, destroy the Keystore key, unwrap from the phrase, open the database.
- **SQLCipher cannot run under Jest** — it is native. Repository tests continue against the plaintext `sql.js` mock, which is correct: they test repository logic, not encryption. Encryption is verified by the Kotlin tests above and by an on-device check that the database file is not readable with a plain SQLite client.
- **The on-device checklist gains one item:** pull the database file off the device with `adb` and confirm a plain `sqlite3` client rejects it.

## 11a. The unrecoverable state

A user can reach a state where the data is mathematically gone: they removed their screen lock (destroying the Keystore key) **and** lost their recovery phrase. No amount of engineering recovers a DEK with both wraps unopenable, and no support process can help — that is what zero-knowledge means.

**The app says so plainly and offers a way forward.** The unlock screen detects the state, explains in one sentence that the data cannot be recovered and why, and offers a heavily-confirmed **wipe and start over**: clear the database, both wrap blobs, the capture buffer, and every setting, then re-run onboarding from the beginning.

The alternative — a permanent lock screen pointing at support — was rejected. Support genuinely cannot help, so it generates tickets that can only be answered with "it's gone", and it leaves a bricked app on the phone whose only remaining escape is uninstalling, which loses the same data *plus* the notification-access grant and every setting, while looking like a crash rather than a protection working as designed.

The wipe needs no authentication gate. Someone who cannot decrypt the data also cannot read it, so a wipe destroys but never leaks.

## 12. Open questions

1. **Backup key rotation.** If a user changes their recovery phrase, every previously uploaded vault blob becomes undecryptable. Either re-upload on rotation, or version the blobs and keep the old key wrapped. Decide when cloud backup is implemented, not before.
2. **Lock timeout configurability.** Five minutes is the default. Whether users can change it — and whether "never" is an allowed value — is a settings-screen decision for M3b.
