# On-Device Verification — one session, two plans

> ## Session 2 results — 2026-08-15 · same SM-A546E, Android 16 / SDK 36
>
> | Check | Result |
> |---|---|
> | **Instrumented Keystore suite** | **10/10 PASS** (was 7/7; the 3 new are the two prefs-KEK assertions + Gate B's own case) |
> | `prefsKekIsNotUserAuthenticationBound` | **PASS — first execution ever** |
> | `prefsValueSealsAndOpensWithNoAuthenticationAtAll` | **PASS — first execution ever**, unattended |
> | **Gate B** re-run after provider-selection | **4,920 ms** / 500 records = **9.84 ms/record**, 5,080 ms headroom |
> | **Gate A** — Argon2id timing | **3,351 ms median** — RUN this session. **Supersedes session 1's "NOT RUN" row below**, which is still the most-read line in this document and has misled at least one later reader into rebuilding a gate that already had a number |
> | Part 3a package-name pre-check (adb) | **6 of 15 CONFIRMED**, 1 disproven, 8 unknown — see Part 3a |
> | Route-table "release blocker" | **DISPROVEN** — production export carries no test code at all |
>
> **Gate B did not regress, it improved.** Session 1 measured 5,265 ms / 10.53 ms per record;
> this run is 4,920 ms / 9.84 ms, on a build carrying everything M1b, M1c and the whole
> provider-selection plan added to the capture path. The drain is dominated by 500 Keystore RSA
> operations, and nothing this quarter touched that.
>
> **How the auth-gated tests were actually driven**, since "run them inside the 10-second window"
> is easier said than done and cost two failed attempts:
>
> - Screen state is readable with `adb shell dumpsys nfc | grep mScreenState` → `ON_UNLOCKED` /
>   `ON_LOCKED` / `OFF_LOCKED`. Poll it, and fire `am instrument` the instant it flips.
> - **The window runs from the last AUTHENTICATION, not from screen-on.** A phone sitting
>   unlocked on the desk does not satisfy it. Lock it first (`adb shell input keyevent 26`) so
>   the next unlock is a fresh one.
> - Budget the wait in **wall-clock**, not loop iterations — 2,400 adb round-trips sound like a
>   long wait and elapse in about three minutes.
> - For Gate B, whose harness itself waits up to 120 s for a lock→unlock cycle, start the test
>   first and let the script lock the screen ~4 s later. The human then has exactly one thing to
>   do, and 120 s in which to do it. Asking a person to lock *and* unlock inside that window
>   fails on message latency alone; it did, twice.


> ## Session 1 results — 2026-08-10 · Samsung Galaxy A54 5G (SM-A546E), Android 16 / SDK 36
>
> | Check | Result |
> |---|---|
> | **Part 2** — instrumented Keystore suite | **7/7 PASS** (3 need a fresh unlock — see note) |
> | **Gate B** — 500-record drain vs 10 s window | **5,265 ms** (10.53 ms/record) — PASS, 53% of budget |
> | Config plugin on real hardware | **PASS** — service registered, bound, correct permission |
> | Live capture, app never launched | **BUG FOUND, FIXED** (`bca1bcd`), re-verified PASS |
> | Buffer contains no readable notification text | **PASS** — pure ciphertext, 6/6 plaintext probes absent |
> | Durability across process death | **PASS** — captured while force-stopped |
> | Reboot survival | **PASS** — re-bound and captured, app never opened |
> | **Gate A** — Argon2id timing | **NOT RUN IN THIS SESSION** — needs JS in Hermes; blocked. **SUPERSEDED five days later**: session 2 measured 3,351 ms median. Read the Gate A section, not this row |
> | Part 3 switches / drain-empties | **NOT RUN** — need the JS bridge; blocked |
> | Part 4 database unreadable / ledger / re-lock | **NOT RUN** — need onboarding; blocked |
> | Battery-manager 2 h idle | **NOT RUN** — and this device is Samsung, not one of the four target OEMs |
> | Part 5 (screen lock, fingerprint, no-lock device, Recents thumbnail, background re-lock) | **DEFERRED — no free device available.** The last two boxes were added later, for GAP-068 and GAP-030, and need only the A54 rather than a second device |
>
> ### Deferred, and what that does and does not block
>
> Everything still open is **verification, not implementation**. No later plan (M1b, M1c, M2, M3,
> the server) depends on any of it, so development proceeds unblocked.
>
> It does block **release**, and one item disproportionately:
>
> - **Enrolling an additional fingerprint must not invalidate the key.** This is the only proof
>   that `setInvalidatedByBiometricEnrollment(false)` actually took effect. The instrumented
>   suite confirms the *flag is set* (`captureKeyPairIsCreatedWithExpectedKeystoreProperties`
>   and its device-KEK twin both assert `isInvalidatedByBiometricEnrollment == false`, and both
>   passed on hardware) — but only a real enrollment proves Android honours it. If it does not,
>   every user loses their entire history on a routine settings change.
> - **Argon2id timing (Gate A)** stays a ship gate: the parameters are part of the on-disk format
>   and cannot change once any real user holds a recovery phrase.
> - **Battery-manager survival** needs a **Xiaomi/Oppo/Vivo/Huawei** handset. The Samsung tested
>   here cannot answer the question that matters for the Philippine market.
>
> **The bug this session existed to find.** On a fresh install where notification access is
> granted from Android Settings *before* the app is first opened, every capture was silently
> dropped — `CaptureBuffer.append` looks up the capture public key on every append, but the
> keypair was created only by the app. `handlePosted`'s never-throw guard turned that into one
> logcat line per lost notification. The JVM suite could not have caught it: the service test's
> own `setUp` called `ensureCaptureKeyPair()`, so the harness was doing what production had
> forgotten. Fixed in `onListenerConnected()`; regression test uses a virgin vault.
>
> **Why 3 Keystore tests fail unattended.** They exercise auth-gated keys, and an unattended run
> has no authentication inside the 10-second window. Not a defect. The whole suite runs in
> ~1.2 s, so one fresh unlock covers it — drive it with `adb shell am instrument` (≈0.2 s
> startup) rather than Gradle, which is too slow to fit the window.
>
> **What blocked the rest.** The Windows build fails on `MAX_PATH` (the relative object path is
> 292 chars before any root, so no amount of relocation helps) — EAS cloud builds are now the
> route. The EAS dev client then could not resolve the Metro manifest through a deep link, so
> no JS ever ran. Everything still open needs JS.
>
> **Gate B caveat worth carrying.** It passes, but the JVM estimate was 442 ms and reality is
> 5,265 ms — **12× off**. This mid-range handset uses 53% of the window. A budget device at
> 1.5–2× slower lands at 8–10 s, and for those users a full-buffer drain would fail *every*
> time, not intermittently.


Everything in this document needs a **real Android phone**. None of it can be emulated, mocked,
or inferred from the test suites, which is exactly why it exists as its own gate.

It merges the device work owed by two plans, because both need the same phone in the same
session and interleaving two checklists by hand is how steps get skipped:

- `2026-08-07-encryption-foundation.md` — Task 11, steps 4 / 4a / 4b / 5 / 6
- `2026-08-02-mobile-ingest-m1a-native-module.md` — Task 9

**Record the actual observed result in every box.** A number, or a sentence describing what
happened. Never "OK" — the point of the exercise is the value, not the tick.

---

## What is already proven, so you don't re-test it

| Layer | Status |
|---|---|
| JS suite | ~~679 tests, 43 suites~~ → **1,859 tests, 89 suites**, green (2026-08-14) |
| Kotlin suite | ~~87 tests, 10 suites~~ → **127 tests, 10 suites**, green (2026-08-14) |
| `tsc --noEmit` | clean |
| Prebuild → generated manifest | `<service>`, its intent-filter, and `RECEIVE_BOOT_COMPLETED` verified present; no `READ_SMS`. Re-verified 2026-08-14 after the provider-selection plan: eight permissions, unchanged, and **no `QUERY_ALL_PACKAGES`** — the observed-package list is learned from `sbn.packageName`, not from a package query |
| Log hygiene | no key, DEK, phrase, or notification text reachable from any log or exception message |
| A54 5G RAM variant | `MemTotal` ≈ 7.3 GiB (`free -h` under Termux, 2026-08-21) → **8 GB retail variant**. Resolves AI spec §6 risk 2 and closes spike Task 1. **The 6 GB variant remains UNKNOWN and is never assumed fine** — every peak-RSS result carries the caveat "on 8 GB; 6 GB unmeasured" |
| A54 idle memory pressure | 4.2 G used, **2.9 G available**, and **1.6 G of 8 G zram already in use at idle** — measured with Termux running and PeraPlano *not* (2026-08-21). Available, not total, is what weights compete for, and the app's own RN + Hermes + SQLCipher footprint still has to come out of that 2.9 G before a tier is sized |
| Qwen3-0.6B Q4_K_M throughput | **138 t/s prompt (warm), 7.5–10.8 t/s generation** — llama.cpp CLI under Termux, `QuantFactory/Qwen3-0.6B-GGUF:Q4_K_M`, build b10553 (2026-08-21). The first-turn 8.4 t/s prompt reading is cold model load, not the steady rate. `/no_think` moved generation 7.5 → 10.8 |

**The throughput row is a Termux CLI measurement, not an in-app one, and it does not close spike Task 4
or Task 7.** `llama-cli` had the whole device; inside PeraPlano the model shares RAM with React Native,
Hermes, op-sqlite and SQLCipher, and llama.cpp `mmap`s the GGUF as clean file-backed pages that Android
evicts under pressure and re-reads from UFS. Nothing here says what happens when the user switches to
Messenger and back — that is still unmeasured, and it is a low-memory-killer question rather than a
speed one.

What remains is everything that depends on **Android actually behaving like Android**: delivering
notifications to a bound service, honouring Keystore auth windows, surviving process death and
reboot, and whatever the OEM's battery manager decides to do.

---

## Preparation

```bash
cd mobile
npx expo prebuild --platform android
npx expo run:android          # or: npx eas build --profile development --platform android
```

- [ ] App launches, five-tab shell renders → `________________`
- [ ] **Delete `mobile/android/` when the session is over.** It is generated and gitignored, and
      `expo prebuild` re-adds an `"ios": "expo run:ios"` script to `package.json` every run —
      revert that too.

---

# The session runbook

Follow this top to bottom with the phone in hand. The tooling lives in
`mobile/scripts/device/` (Windows PowerShell 5.1, which is the primary shell on this machine —
same as `docs/build-variants-adb-install.md`). Every script writes a paste-ready record into
`mobile/device_results/`, which is gitignored scratch: the numbers belong in **this** file.

**Nothing in `scripts/device/` has ever been run against hardware.** It was written and
syntax-checked with no phone attached; `verify_harness_absent.ps1` is the only one whose whole job
runs off-device, and it is the only one whose behaviour has actually been observed. Treat the first
run of each of the others as debugging the harness as much as testing the app.

## Rule 0 — the recovery-phrase screen

One screen displays twelve words that are the master key to a user's entire financial history.

**Never screenshot it, screencap it, or dump its text.** Not to a file, not to a terminal, not to
a chat, not "just to check the extraction worked". This has already gone wrong twice here: once by
a screenshot that put the phrase into a file and a session transcript, and once by an attempt to
avoid that which pulled the view tree and filtered the words out with a grep that was one pattern
too narrow — 3 of 12 words came through anyway.

The lesson is that **filtering output is the wrong control**. The tooling here does not filter, it
refuses: `adb_common.ps1`'s `Assert-NoPhraseOnScreen` asks the *device* whether any `phrase-word-*`
node is on screen and gets back an integer, and `Get-ViewTree` and `Save-Screenshot` both throw on
a non-zero count before any bytes cross to the laptop. There is no override flag. Do not add one.

When the words genuinely have to go back into the app — the confirm step, or the Part 5 recovery
unlock — use `enter_recovery_phrase.ps1`, which extracts them device-side into
`/data/local/tmp`, selects them **by index**, and types them with `adb shell input text` whose
substitution evaluates on the phone. The only thing that ever reaches this laptop is a count.

**If a phrase is exposed anyway, that install is compromised.** Uninstall it — not "clear data" —
reinstall, and onboard from a fresh phrase. A phrase that has been in a transcript opens the vault
it was issued for, forever.

## Before the phone is plugged in

```powershell
cd "D:\My Folder\pera-plano\mobile"
npx tsc --noEmit
npx jest --ci
.\scripts\device\verify_harness_absent.ps1
```

The last one needs no device and no Android SDK. It exports the production JS bundle twice — once
with the Gate A harness opted in and once without — and proves the harness is absent from the
production build *and* that the check would have found it if it were present. Run it before any
Play submission and after any change to `metro.config.js`, `app/dev_harness.tsx` or
`lib/dev_harness/`.

Then build and install (`docs/build-variants-adb-install.md`). For **Gate A on a release engine**,
set the opt-in before the JS is bundled, or the harness is not in the APK at all:

```powershell
$env:APP_VARIANT = "preview"
$env:EXPO_PUBLIC_DEV_HARNESS = "1"
npx expo prebuild --clean -p android
cd android; .\gradlew.bat assembleRelease
```

`eas.json` deliberately does **not** set `EXPO_PUBLIC_DEV_HARNESS` in any profile. A preview build
can be handed to a beta tester, and a build profile that always carried the harness would put a
verification surface in their hands. It is a per-invocation opt-in, on purpose.

## The order, and why it is this order

1. **Part 1, the two ship gates.** First, because a wrong answer here is *new work* — re-tuning KDF
   parameters or the key window and re-verifying everything downstream — not a checkbox. Measuring
   them at the end of a session means discovering at the end of a session that the session has to
   happen again.
   - **Gate A** → `.\scripts\device\run_gate_a.ps1`
   - **Gate B** has passed twice (5,265 ms, then 4,920 ms). Re-run it only if the capture path
     changed; it is not a per-session ritual.
2. **Part 2, the instrumented Keystore suite.** `adb shell am instrument`, not Gradle — Gradle's
   startup does not fit inside the 10-second auth window. Lock the phone first (see below).
3. **Part 3 / 3a, the notification listener and the package names.**
4. **Part 4, encryption end to end.**
5. **Part 6, the MVP walkthrough** → `.\scripts\device\run_e2e_qa.ps1` for the scriptable half.
6. **Part 8, the eyes-only checklist.** Everything no script can settle.
7. **Part 7, the merged-manifest permission check.** Last because it needs a `--clean` prebuild,
   which regenerates `android/` and invalidates the build everything above ran on.
8. **Closing the session**, below.

## Four things that will otherwise cost you an hour each

These are encoded in `adb_common.ps1`, but know them anyway, because you will hit them by hand too.

- **Screen state is readable.** `adb shell dumpsys nfc | grep mScreenState` gives `ON_UNLOCKED` /
  `ON_LOCKED` / `OFF_LOCKED`, with no root and no special permission. Poll it.
- **The Keystore auth window runs from the last AUTHENTICATION, not from screen-on.** A phone
  sitting unlocked on the desk does not satisfy it. `adb shell input keyevent 26` to lock it first,
  so the next unlock is a fresh one. Start the thing being measured *first*, let the script lock the
  screen a few seconds later, and leave the human exactly one action to perform.
- **Budget every wait in wall clock, never in loop iterations.** 2,400 adb round-trips sound like a
  long wait and elapse in about three minutes.
- **The dev client serves a stale bundle aggressively.** A fresh Metro port (8082) is the reliable
  cache-buster. And the *only* trustworthy proof the phone took the new bundle is an
  `Android Bundled` line in Metro's own log triggered **by the device** — a curl from the laptop
  produces one too. `run_gate_a.ps1` records the log length before launching and only accepts a
  line written after that point. Believing an on-device negative without this check once cost an
  hour on an app that was already correct.

## When a step fails

- **Gate A lands somewhere unexpected.** Record the number and stop. Do not tune the parameters in
  the same sitting: they are part of the on-disk format, and the owner has already made a
  considered decision to keep them at ~3.35 s (see the Gate A section, and the parameter block in
  `lib/crypto/recovery_phrase.ts`). A new number is an input to that decision, not an override of
  it.
- **No `PERAPLANO_HARNESS` line reaches logcat.** The script prints a four-point checklist. In
  order of how often it is actually the cause: the app was locked (the router never mounts), Metro
  was started without `EXPO_PUBLIC_DEV_HARNESS=1` (the route does not exist in the bundle at all,
  so the deep link lands on not-found), or the bundle was stale.
- **An auth-gated test fails with `UserNotAuthenticatedException`.** Almost always the window, not
  the app. Lock, then unlock, then fire immediately.
- **Anything in Part 6 fails.** Record it and keep going. Later steps depend on data earlier ones
  create, so a mid-pass rebuild invalidates everything after it, and a failure list from one
  complete pass is worth more than a fix applied halfway through.

## Ending the session cleanly

Two extra steps on top of the "Closing the session" block further down, both of which exist because
this tooling writes to the phone:

```powershell
cd "D:\My Folder\pera-plano\mobile"
.\scripts\device\enter_recovery_phrase.ps1 -Shred   # removes the device-side phrase file
adb shell rm -rf /data/local/tmp/peraplano_verify   # belt and braces
Remove-Item -Recurse -Force android
git checkout -- package.json                        # prebuild re-adds an "ios" script every run
git status                                          # must be clean
```

Then paste the recorded values into this document and into the commit messages at the bottom.

---

## Part 1 — Two ship gates. Do these FIRST.

Both fix parameters that **cannot change once a real user holds a recovery phrase**. Measuring
them after release is measuring something you can no longer act on.

### Gate A — Argon2id derivation timing

The parameters (`m=2048 KiB, t=2, p=1`) were tuned against Jest, which is materially slower than
a Hermes release build. The real figure is unknown, and **too fast is as bad as too slow** — it
means the recovery phrase is cheaper to brute-force than intended.

Time `deriveRecoveryKey` on a mid-range device. **Target ≈ 500 ms – 1 s.**

- Measured: **3,351 ms median** — 5 runs after one warm-up: `[3351, 3506, 3526, 3263, 3207]`,
  min 3,207 / max 3,526. Hermes, dev-client bundle, `m=2048 KiB, t=2, p=1`.
- Device / chipset: **Samsung SM-A546E (Galaxy A54 5G), Exynos 1380, Android 16** — 2026-08-15
- **RUN. The prediction in `recovery_phrase.ts` was backwards.**

> **The device is 2–3× SLOWER than Jest, not faster.** The constants were tuned inside Jest to
> land at 1.2–1.6 s on the stated expectation that "a real mid-range Android device running the
> compiled Hermes bundle, with no Babel/ts-jest instrumentation, [will] come in under that."
> It came in at 3.35 s. Do not carry that assumption into any future tuning: for this workload
> Hermes is the slower environment, and a Jest timing is not a ceiling.
>
> **This is not a UX problem.** `deriveRecoveryKey` has exactly two call sites
> (`key_manager.ts:153`, `:186`) — wrapping the DEK during onboarding, and unwrapping it during a
> recovery unlock. Neither is the normal unlock path, which uses the Keystore device KEK. A user
> meets this once at setup and again only if they lose their screen lock, while typing twelve
> words by hand.
>
> **The work factor does not buy what the constants were chosen to buy, at any reachable value.**
> The header's rationale keeps a work factor for the *narrowed* search — eleven of twelve words
> recovered, leaving 2,048 candidates. But an attacker runs native Argon2id, not Hermes: at
> `m=2 MiB, t=2` that is single-digit milliseconds per guess, so 2,048 candidates fall in well
> under a minute. Raising memory to the OWASP floor (`m=19 MiB`) would cost roughly 30 s per
> derivation **here** and still leave that search trivial for the attacker. The asymmetry runs
> the wrong way and cannot be closed in pure JS.
>
> What actually protects the phrase is its **128 bits of entropy**, exactly as the header says.
> The Argon2id layer is defense in depth, and its parameters are close to a free variable.

#### The harness — how to re-measure this, added 2026-08-30. **BUILT, NEVER RUN.**

The 3,351 ms above was measured once and left no reproducible instrument behind, so re-measuring it
meant rebuilding the whole apparatus. There is now a harness:

| Piece | What it is |
|---|---|
| `mobile/lib/dev_harness/gate_a.ts` | The measurement. Imports the **real** `deriveRecoveryKey` and the **real** parameter record; it holds no Argon2id constants of its own |
| `mobile/app/dev_harness.tsx` | An Expo Router route, reachable only by deep link, blocked out of production bundles |
| `mobile/scripts/device/run_gate_a.ps1` | Drives it over adb and scrapes the result out of logcat |
| `mobile/lib/dev_harness/__tests__/gate_a.test.ts` | Pins the things a device session would not notice — 11 tests, green |

```powershell
cd "D:\My Folder\pera-plano\mobile"
.\scripts\device\run_gate_a.ps1                       # dev client, 5 runs after 1 warm-up
.\scripts\device\run_gate_a.ps1 -Variant preview -NoMetro   # release engine, if built with the opt-in
```

**Why a route inside the app, and not something less invasive.** There is no way to poke JS from
outside; the only things that execute in the app's Hermes instance are the app's own modules. A
route is the smallest surface that runs real app code in the real engine, is addressable from adb
with nobody tapping anything, and can be switched off at build time. A Node or JVM benchmark
measures a different engine — this workload is already known to be ~190 ms in Node, 1.2–1.6 s under
Jest, and 3,351 ms in Hermes — and an instrumented Android test cannot reach JS at all.

**It measures the shipping code, not a copy of it.** `ARGON2ID_PARAMS` is now exported from
`lib/crypto/recovery_phrase.ts` and read by `deriveRecoveryKey` itself, so the parameters the
harness reports cannot drift from the parameters derivation uses without breaking derivation. The
input is the public all-zero-entropy BIP-39 test vector, so no real phrase is ever timed and no
field of the result carries a word, a salt or a key.

**It does not decide.** It reports a median, the spread across runs, the parameters, whether the
engine was Hermes, whether `__DEV__` was true, and the delta against the 3,351 ms on record. The
band it prints is measured against the 500 ms – 1 s *design target*, which the owner has already
consciously overridden. A number is an input to that decision, not a replacement for it.

**Two things the recorded 3,351 ms does not settle, and the harness now makes visible:**

- **It was a dev-client bundle.** The result object carries `__DEV__`, and a dev bundle carries
  development-only checks a release bundle does not — so 3,351 ms is an upper bound on the figure a
  shipping user would meet, not that figure. Nobody has measured the release engine.
- **It was one device.** The A54 is a mid-range 2023 handset. The Gate B note in this document
  already warns that a budget device at 1.5–2× slower changes the conclusion; the same warning
  applies here, where 3.35 s becomes 5–7 s on the phones a large part of the Philippine market
  actually holds.

**Kept out of production, and checked rather than asserted.** A `process.env.EXPO_PUBLIC_DEV_HARNESS`
guard inside the component was **not enough**: with only that guard, the minifier dropped the
screen's JSX but Metro still pulled `lib/dev_harness/` into the graph and the sentinel string was
sitting in the shipped Hermes bytecode. `metro.config.js` now blocks both files out of the module
graph at the resolver unless the variable is set, which removes the route entirely. Both of those
are observed facts about an actual `expo export`, and `scripts/device/verify_harness_absent.ps1`
re-checks them with a positive control every time.

### Gate B — Full-buffer drain against the 10-second key window

Fill the capture buffer to its 500-record cap, then time `drainPendingCaptures()` end to end.
Both Keystore keys use a **10-second** auth validity window and every record costs one `doFinal`
against the secure element. A plain-JVM benchmark put 500 RSA-2048/OAEP decrypts at 442 ms — but
that is a *floor*. It cannot capture Keystore/Binder IPC or StrongBox latency, which is what
dominates on real hardware.

- Measured: `________ s`
- **Approaching ~8 s means the window is too tight.** Widen it before it becomes an intermittent,
  load-dependent failure that only bites users with a full buffer.

---

## Part 2 — Instrumented Keystore suite

Robolectric has no Android Keystore (verified three ways during encryption Task 4), so these
assertions exist only here. This is the sole place the real Keystore configuration is checked by
code rather than by eye.

```bash
cd mobile/android
./gradlew.bat :notification_listener:connectedDebugAndroidTest
```

- [ ] Result → `________________`

### Added 2026-08-14 — the prefs KEK. **RUN 2026-08-15 — BOTH PASS.**

Provider-selection Task 1 added two assertions to `KeyStoreBridgeInstrumentedTest`. They were
compile-verified only until Session 2; the 7/7 in Session 1's table predates them and never
covered them.

Neither can be moved to the JVM. Robolectric has no Android Keystore, and `FakeKeyVault` is plain
JCE — it never constructs a `KeyGenParameterSpec`, so `isUserAuthenticationRequired` is not merely
untested there, it does not exist. A JVM assertion on it would be asserting nothing.

- [x] `prefsKekIsNotUserAuthenticationBound` — the prefs KEK reports
      **`isUserAuthenticationRequired == false`**, 256-bit, encrypt+decrypt →
      **PASS, 2026-08-15, SM-A546E / Android 16**
- [x] `prefsValueSealsAndOpensWithNoAuthenticationAtAll` — a prefs value seals and opens in an
      unauthenticated instrumentation session, with no fresh unlock and no 10-second window →
      **PASS, 2026-08-15, SM-A546E / Android 16**

> **The second one passed in a fully unattended run**, with no unlock anywhere near it and the
> other three auth-gated tests in the same suite failing `UserNotAuthenticatedException` around
> it. That contrast is the result, not an inconvenience: the same session that proves the
> auth-bound keys really are auth-bound proves this one really is not. A provider filter the
> listener can read at 3am with the phone locked is what the whole key exists for.

> **Read the polarity before recording a result.** Every other Keystore assertion in that file
> wants `isUserAuthenticationRequired == true`. This one wants **false**, deliberately — the
> notification listener has to answer "should I capture this?" at 3am with the app locked, so a
> provider filter sealed under an auth-bound key would be unreadable at exactly the moment it is
> needed. Per `docs/12` §4, the attacker this gives up on (code executing as our UID) is already
> out of scope, while the one it defends against (offline filesystem read — stolen phone,
> unencrypted backup, forensic extraction) is firmly in scope. The alternative here was never a
> stronger key; it was the plaintext `SharedPreferences` this replaced.
>
> If `prefsValueSealsAndOpensWithNoAuthenticationAtAll` ever needs a fresh unlock to pass, the key
> has silently become auth-bound and the filter is unreadable while the phone is locked. That is a
> product-breaking regression, not a flaky test.

### Added 2026-08-14 — what the capture path actually costs. **NOT RUN.**

Two JVM measurements need a device to confirm, and they fail in **opposite directions**, so neither
can stand in for the other.

- [ ] **`shouldCapture()` — the JVM number is a FLOOR** (Task 2: 6.7–7.9 µs). Robolectric's
      `FakeKeyVault` is plain JCE, so it never pays the keystore2 Binder round-trip a real
      `Cipher.init` does on every AES-GCM open. The device number can only be **higher**.
      → `________________`
- [ ] **`recordObservedPackage()` — the JVM number is a CEILING** (Task 3: 3.8–5.0 ms). Almost all
      of it is `SharedPreferences.commit()` doing real host file I/O on an NTFS dev volume; a phone
      writing app-private storage on ext4/f2fs should be **cheaper**. → `________________`

> **What to watch, and it is not the crypto.** Sealing a 4 KB list costs 13 µs. A bare boolean
> `setCaptureEnabled` — no crypto whatsoever — costs 1,175 µs on the same harness. The cost is the
> synchronous full-file rewrite, and it is pre-existing.
>
> What Task 3 changed is that a **dropped** notification now pays one, where before it wrote
> nothing at all. On a chatty phone that is a commit per notification, on the listener's binder
> thread, all day. Not a latency problem — notifications arrive at human rates — but a flash-write
> and battery one, and this listener never stops.
>
> **Ongoing tiles are the exception, and they are already short-circuited.** A media player, a
> download and a navigation session re-post the same ongoing notification at roughly 1 Hz, which is
> not a human rate. `recordObservedPackage` now takes the delivery's `isOngoing` flag: a first
> sighting is stored either way, but a re-post of a package already at the front of the list writes
> nothing until `OBSERVED_REPOST_WINDOW_MILLIS` (60 s) has passed, and never raises the count. So
> the number to watch on a device is commits per *distinct* notification, not per delivery: a
> playing track should add no writes at all after the first.
>
> If the device number lands near the JVM's rather than well below it, the lever is `apply()`
> instead of `commit()` **for this one value**: losing the last observed-package write is harmless
> bookkeeping that the next notification rewrites, which is emphatically not true of the provider
> filter sitting beside it. That would mean splitting `CapturePrefs.write`, which today routes
> every write through one place precisely so the `commit()`-vs-`apply()` decision is made once —
> so it is a deliberate change, not a tweak. **Measure first.**

---

## Part 3 — The notification listener (M1a Task 9)

### Access grant
- [ ] Call `openAccessSettings()`. The system Notification Access screen opens **and PeraPlano is
      listed on it.** Grant access. → `________________`
- [ ] `isAccessGranted()` now returns `true` → `________________`

> If PeraPlano is absent from that screen, the config plugin did not inject the `<service>` into
> the build you installed. Nothing downstream can pass until that is fixed.

### Live capture
```bash
adb shell cmd notification post -S bigtext -t "TEST" tag1 "Sent PHP 100.00 to JUAN D. Ref 123."
```
- [ ] An `onCapture` event fires with matching text → `________________`

### Durability across process death — the core promise
```bash
adb shell am force-stop com.filldev.peraplano
```
- [ ] Post another notification **while the app is dead**, relaunch, `drainPendingCaptures()`,
      and confirm the notification posted while dead is returned → `________________`
- [ ] A second `drainPendingCaptures()` returns `[]` → `________________`

### The two switches
- [ ] `setCaptureEnabled(false)` → post → drain returns nothing. Re-enable → capture resumes.
      → `________________`
- [ ] `setProviderFilter(["com.globe.gcash.android"])` → post from a **different** package →
      drain rejects it → `________________`

### Reboot survival
```bash
adb reboot
```
- [ ] After boot, **without opening the app**, post a notification. Then open the app and drain —
      confirm it was captured. → `________________`
- If not captured, the listener did not re-bind. Check whether access is still granted (some OEMs
  silently revoke it) and record device + OS version → `________________`

### Battery-manager survival — the one that decides whether the product works in PH
- [ ] On a device with an aggressive OEM battery manager (**Xiaomi/MIUI, Oppo, Vivo, Huawei** —
      the common Philippine handsets), leave the app closed for **two hours**, then post a
      notification and confirm capture.
- OEM tested: `________________`
- Captured after 2h idle? `________________`
- Was a battery-optimization exemption required? `________________`

> This result is not just a pass/fail — it feeds the OEM-specific onboarding guidance built in
> the M3 plan. Record which OEM, not just the outcome.

### Buffer cap
- [ ] Post 520 notifications in a loop; drain returns **exactly 500** — oldest evicted, newest
      kept → `________________`

---

## Part 3a — Do the picker's package names match the real apps?

Added 2026-08-14 by the provider-selection plan (Task 5, plan rule 3). **PARTIALLY RUN
2026-08-15 — see the adb pre-check below. The picker itself is still NOT RUN.**

> ### Pre-check done 2026-08-15 without the app — `adb shell pm list packages`
>
> The picker needs the dev client, but the *names* do not. Six of the fifteen are now confirmed to
> exist verbatim on real hardware (SM-A546E, Android 16):
>
> | Seed name | Provider | Result |
> |---|---|---|
> | `com.globe.gcash.android` | gcash | **CONFIRMED** |
> | `com.paymaya` | maya | **CONFIRMED** |
> | `com.shopee.ph` | shopeepay | **CONFIRMED** |
> | `com.grabtaxi.passenger` | grabpay | **CONFIRMED** |
> | `com.google.android.apps.messaging` | sms_relay | **CONFIRMED** |
> | `com.samsung.android.messaging` | sms_relay | **CONFIRMED** |
> | `com.android.mms` | sms_relay | **ABSENT — and a near-miss, see below** |
> | the remaining 8 bank apps | bpi, bdo, unionbank, metrobank, seabank, gotyme, cimb, landbank | **UNKNOWN** — not installed on this device |
>
> **`pm list packages <name>` matches on SUBSTRING, and it produced a false positive.** Querying
> `com.android.mms` returns a hit, but the installed package is `com.android.mms.service` — a
> different system component, not the AOSP messaging app. `com.android.mms` itself is **not
> installed here**. Always print the matched name and compare it for equality; a bare
> "did it return anything" check reports this one as confirmed.
>
> **Absence is not disproof.** The eight bank apps are simply not held by this device's owner.
> Nothing here says those names are wrong — only that this device cannot speak to them. They need
> a tester who banks with each one.
>
> This pre-check does **not** replace Step 2 below. It proves the strings match installed
> packages; only the picker proves the listener actually *observes* them and that the selection
> survives into `shouldCapture`.

**This is the check that retires the guesses.** Seven of the seed's package names were constructed
from app names and have never been seen anywhere — `com.bpi.ng.app`, `com.bdo.digitalbanking`,
`com.metrobank.mobilebanking`, `com.seabank.ph`, `com.gotyme.bank`, `com.cimbbank.ph`,
`com.lbp.mobilebanking`. `lib/ingest/seed_rules.ts`'s own header goes further: **none** of the
fifteen has been checked against a device or a Play Store listing. The other eight are not
*verified*, only *unflagged*.

A wrong package name is a **silent** failure. That provider is never routed, captures nothing, logs
nothing, and looks to the user exactly like their bank does not work.

No test suite can answer this. `buildProviderChoices` is tested against fixtures, which proves the
merge, the dedupe and the ordering are right and says nothing whatsoever about whether the strings
being merged are real.

**Prerequisites:** notification access granted (Part 3), and the app able to reach the provider
step of onboarding — the screen immediately after the recovery phrase
(`app/(onboarding)/index.tsx`).

### Step 1 — Make the phone notify

The listener records `sbn.packageName` for **every** notification it sees, including the ones it
drops for being filtered out, ongoing, paused, or carrying no text. What it cannot do is record an
app that never notifies: there is no package query anywhere in this build — deliberately not
`QUERY_ALL_PACKAGES` — so an installed-but-silent app is invisible to the picker by construction.

Before running onboarding, make every financial app you actually hold post at least one
notification: send ₱1 to yourself, check a balance, let a promo push land.

- Financial apps installed on this device → `________________`
- Apps you deliberately made notify → `________________`

### Step 2 — Read the list

Either complete onboarding as far as the provider step and read the **"Apps we've seen"** group, or
call `listObservedPackages()` from the dev client. Both read the same sealed value.

- Total packages in "Apps we've seen" → `________________`

### Step 3 — Score every seed package name

Tick **Seen** only when the exact string appears. When it does not, get ground truth from `adb`:

```bash
adb shell pm list packages | grep -i bpi     # bdo, metrobank, seabank, gotyme, cimb, landbank…
adb shell cmd package list packages -3       # every third-party package on the device
```

| Seed provider | Seed package name | Flagged invented | Seen? | Real package if different |
|---|---|---|---|---|
| gcash | `com.globe.gcash.android` | | `____` | `____` |
| maya | `com.paymaya` | | `____` | `____` |
| bpi | `com.bpi.ng.app` | **yes** | `____` | `____` |
| bdo | `com.bdo.digitalbanking` | **yes** | `____` | `____` |
| unionbank | `com.unionbank.ecommerce.mobile.android` | | `____` | `____` |
| metrobank | `com.metrobank.mobilebanking` | **yes** | `____` | `____` |
| seabank | `com.seabank.ph` | **yes** | `____` | `____` |
| gotyme | `com.gotyme.bank` | **yes** | `____` | `____` |
| cimb | `com.cimbbank.ph` | **yes** | `____` | `____` |
| landbank | `com.lbp.mobilebanking` | **yes** | `____` | `____` |
| shopeepay | `com.shopee.ph` | | `____` | `____` |
| grabpay | `com.grabtaxi.passenger` | | `____` | `____` |
| sms_relay | `com.google.android.apps.messaging` | | `____` | `____` |
| sms_relay | `com.samsung.android.messaging` | | `____` | `____` |
| sms_relay | `com.android.mms` | | `____` | `____` |

**Fifteen package names, thirteen providers** — `sms_relay` carries three. Score every row, not just
the seven flagged ones.

### What each outcome proves, and what it does not

**Seen.** The name is correct on this device and this OS build. Retire it from the guessed list and
record *which* device confirmed it — a package name can legitimately differ between an OEM build
and a Play build, so one confirmation is evidence, not a closed question.

**Not seen, you hold that app, and you made it notify this session.** The seed name is **wrong**.
The real one is already sitting in "Apps we've seen" under whatever Android calls it: the picker
renders an observed package the catalogue has never heard of using its own package name, with no
subtitle, precisely so this case is visible rather than hidden. Copy it into the last column. The
fix is a `seed.json` edit and a ruleset version bump, not an app release.

**Not seen, and you do not hold that app. → *Nothing is proved.*** Not that the name is right, not
that it is wrong. Leave the row flagged unverified and do not tick it off. This is the outcome for
*most* rows in any single session — one person does not hold ten banks — and reading an absence as
a confirmation is the specific mistake this check exists to prevent. Covering all thirteen
providers takes several testers holding different banks, not a cleverer single run.

**Not seen, you hold the app, but it never notified during the session.** Also proves nothing. Go
back to step 1.

### Two things to record while you are on this screen

- **How many rows read `sms_relay`.** Three seed packages share that provider key and
  `ProviderChoice.displayName` *is* the provider key, so the picker renders three identically
  labelled rows distinguished only by the package-name subtitle under each. Confirm whether that
  reads acceptably on a real screen. → `________________`
  > Related but separate: the seed cannot express one bank on two channels at all — see Session 2's
  > twin-suppression step below, where the same modelling gap makes the ≥95% target unreachable as
  > the corpus stands.
- **Anything in "Apps we've seen" that is a financial app the seed has never heard of.** These
  render under their raw package name with no subtitle. Each one is a provider the corpus work does
  not yet know exists. → `________________`

---

## Part 4 — Encryption end-to-end (encryption Task 11 step 5)

This is the point of the entire encryption plan. Each line is falsifiable.

- [ ] Complete onboarding **including the recovery phrase** → `________________`
- [ ] Trigger a provider notification with the app **closed**; confirm capture → `________________`
- [ ] `adb` pull the buffer file; the notification text is **NOT readable** in it → `________________`
- [ ] `adb` pull the database; a plain `sqlite3` client **rejects** it (encrypted / not a
      database) → `________________`
- [ ] Unlock the app; the capture appears in the ledger → `________________`
- [ ] Background for six minutes; the app **re-locks** → `________________`

---

## Part 5 — Five platform behaviours only a human with the phone can prove

### Remove the screen lock
- [ ] `isDeviceKeyUsable()` goes false; the app detects it on next unlock, prompts for the
      recovery words, requires a screen lock to be set again, and restores access to the **same
      ledger with no data loss** → `________________`
- [ ] **AND CAPTURE STILL WORKS AFTERWARDS.** With the listener enabled, trigger one new bank or
      e-wallet notification AFTER the recovery above, then open the app and confirm the
      transaction lands in the ledger or the Review Queue → `________________`

> The second box is the one that was missing, and it is why GAP-059 shipped. Removing the screen
> lock invalidates every key created with `setUserAuthenticationRequired(true)`, which is the device
> KEK **and** the capture keypair. Recovery only ever recreated the KEK, so the first box could pass
> while `getCapturePublicKey()` still handed back the dead pair's public half: the listener went on
> sealing captures nothing could open, every drain discarded its batch and resolved empty,
> `lastCaptureAt` kept advancing, and the listener-health card kept reporting a working listener.
> Silent, permanent, and invisible to a checklist that stops at "the ledger is still there".

### Grant notification access with the shade already full (GAP-125)
- [ ] Before granting, leave at least one bank or e-wallet notification sitting in the shade.
      Complete onboarding as far as the provider picker and confirm that app is listed under
      **"Apps we've seen"**, not merely under "Common in the Philippines" → `________________`
- [ ] **AND THE COUNT IS NOT INFLATED BY A REBIND.** Reboot the phone (which rebinds the listener),
      reopen the picker from More > Privacy, and confirm the same app has not climbed the list
      relative to the others → `________________`

> This is the acceptance criterion GAP-091 could not meet on its own and the reason that entry was
> logged PARTIAL. The picker's whole premise is that the device can say which banking apps this
> person actually uses; until `onListenerConnected` took a snapshot, the observed list was empty at
> the moment access was granted and the picker offered nothing but unverified seed guesses.
>
> The second box guards the implementation rather than the feature. The obvious version of this fix
> is a loop over `recordObservedPackage`, which increments `count` on every call — so every rebind
> would inflate the count of every package already known, and `count` is what orders the list. The
> shipped recorder is add-only and a unit test pins it, but the unit test runs on Robolectric and
> **nothing in CI compiles or tests a line of Kotlin**, so this box is the only check that a real
> reboot on a real phone behaves the same way.

### Enroll an additional fingerprint
- [ ] **The key must SURVIVE.** → `________________`

> This is the only proof that `setInvalidatedByBiometricEnrollment(false)` actually took effect.
> If the app demands the recovery words here, the flag is wrong and **every user loses their
> history on a routine settings change.**

### A device with no screen lock at all
- [ ] Onboarding refuses to proceed and routes to security settings, rather than failing at key
      generation with an opaque error → `________________`

### The app switcher, while unlocked (GAP-068)
- [ ] Unlock, open Home so a real Safe-to-Spend figure is on screen, background the app, open
      Recents, and confirm the thumbnail shows **nothing** → `________________`

> This is GAP-068's whole acceptance criterion and it has never been looked at. `FLAG_SECURE` is
> set app-wide at root mount (`lib/privacy/capture_guard.ts`) and the flag is what blanks the
> thumbnail, so the check is one glance. **Use a preview or production build.** Development builds
> are deliberately exempt, so a dev build showing the ledger in Recents proves nothing and is not a
> failure.

### The background re-lock, with no return to the app (GAP-030)
- [ ] Unlock, background the app WITHOUT killing it, leave the phone alone for six minutes, then
      reopen: the app asks to unlock again, and the figures that appear afterwards are the ones a
      fresh read produces rather than the ones that were on screen before → `________________`

> The foreground check alone would also produce an unlock prompt here, so this box is not proof on
> its own that the timer fired. What it does prove is the half a unit test cannot: that Android on
> the A54 still schedules this process's JS thread for long enough in the background for the timer
> to be worth having. **If the app re-locks, note whether the phone was charging**, since Doze
> behaves differently, and it is the on-battery case that matters.

---

## Part 6 — MVP end-to-end walkthrough (m3c Task 9, step 6)

This is the last gate on the mobile MVP. Steps 1–5 of that task are automated and already
green; **this part cannot be automated and must not be marked done by inference.** Every
box here is a claim about the product that only a human holding the phone can make.

Run it on a **fresh install** — uninstall first, do not merely clear data. Several of these
checks are specifically about first-run state, and a reused install silently skips them.

Work top to bottom. The order is not decorative: later steps depend on data earlier ones create.

> **Roughly half of this is scriptable, and `mobile/scripts/device/run_e2e_qa.ps1` runs that half.**
> Added 2026-08-30, **never executed against hardware.**
>
> ```powershell
> .\scripts\device\run_e2e_qa.ps1 -List                 # the ordered step table
> .\scripts\device\run_e2e_qa.ps1                       # everything, dev variant
> .\scripts\device\run_e2e_qa.ps1 -From live_capture    # resume
> .\scripts\device\run_e2e_qa.ps1 -IncludeSlow          # adds the ~6.5-minute re-lock wait
> ```
>
> It launches, taps, dumps the view tree, and asserts: fresh install, first-run screen, notification
> access, the Plan/More hub landings, the three deep links, the touch-target measurements, live
> capture, "why was this recorded", the twin, the review queue, capture while force-stopped, the
> buffer holding no plaintext, the database not being plain SQLite, the background re-lock, and
> reboot survival.
>
> **It settles nothing on its own.** Every row it writes is an OBSERVATION, and every step it cannot
> settle is emitted as MANUAL pointing at Part 8 rather than quietly omitted. The header line of
> this section still stands: this part must not be marked done by inference, and a script's green
> row is inference unless a human read what it observed.
>
> It never screenshots and never pulls a view tree without the device-side recovery-phrase
> interlock clearing first; onboarding is handed to `enter_recovery_phrase.ps1` rather than driven
> by reading the words.

### Onboarding
- [ ] Complete onboarding end to end, including granting notification access and the battery
      exemption. It finishes without a force-quit → `________________`
- [ ] The provider picker seeded both wallets and matchers → `________________`
- [ ] Now repeat on a second fresh install, **skipping every optional step**. Skipping always
      lands in a usable app, never a dead end → `________________`

> Why the second pass: two defects found on 2026-08-17 made first-run impossible to complete —
> setup screens whose Continue silently did nothing *after* writing real wallet rows, and a
> fresh install that dead-ended until force-quit. Both passed every per-screen test. Only a
> full tap-through catches this class, which is exactly what this section is.

### Capture — the core promise
- [ ] Trigger or post an illustrative provider notification. It appears in the ledger within
      seconds → `________________`
- [ ] Open "Why was this recorded?" — the captured text and the expiry countdown are both
      shown and correct → `________________`
- [ ] Post a twin SMS-style notification for the same payment. **No double count.**
      → `________________`

### Money movement
- [ ] Move money between two wallets. It links as a transfer and is excluded from spend
      → `________________`
- [ ] Spend past a limit's 50% threshold. **Exactly one** alert fires — not zero, not two
      → `________________`
- [ ] Safe-to-Spend on Home updates after that spend → `________________`

### Plan surfaces
- [ ] Add a bill due in three days. The reminder schedules → `________________`
- [ ] Add a loan. Payment matching proposes the right transaction → `________________`

### Reports and export
- [ ] Open Reports. Transfers are excluded from **every** figure → `________________`
- [ ] Export a CSV and open it in a real spreadsheet. Check specifically: a merchant containing
      a comma stays in one column, and the peso column reads as numbers, not text
      → `________________`

### Privacy — the promises the product is sold on
- [ ] Pause capture. The paused pill appears and nothing is captured while paused
      → `________________`
- [ ] Open the privacy centre. The captured list shows **real rows with live countdowns**,
      not placeholders → `________________`
- [ ] Export all data. The JSON bundle is complete and readable → `________________`
- [ ] Wipe everything. The app returns to onboarding with **no data left** — check the ledger,
      wallets, and the privacy centre, not just the home screen → `________________`

### Dark mode
- [ ] Repeat the core flow (capture → ledger → home) in dark mode. Nothing is unreadable and
      no colour reads as the wrong status → `________________`

### If something fails here
Record it and keep going — finish the walkthrough before fixing anything. A failure list from
one complete pass is worth more than a fix applied halfway through, because the later steps
depend on data the earlier ones create and a mid-pass rebuild invalidates everything after it.

---

## Part 7 — Confirm the three blocked permissions are gone from the built manifest

`26497ad` added `android.blockedPermissions` to `app.json` and pinned it with a test that calls
Expo's **real installed** `withInternalBlockedPermissions` and was proven non-vacuous by a negative
control (emptying the list makes the test fail).

That test proves the necessary precondition: the three permissions get tagged `tools:node="remove"`
in the base manifest. **It cannot prove they are absent from a shipped APK**, because the actual
stripping is done by the Android Gradle Plugin's manifest merger, which only runs in a real native
build. So this is a build-time check, not a unit test, and it belongs here.

Run it once before the first Play submission:

```bash
cd mobile
npx expo prebuild --platform android --clean
grep -c "READ_EXTERNAL_STORAGE\|WRITE_EXTERNAL_STORAGE\|SYSTEM_ALERT_WINDOW" \
  android/app/src/main/AndroidManifest.xml     # expect 0 in the SOURCE manifest

./gradlew :app:processDebugMainManifest
grep -c "READ_EXTERNAL_STORAGE\|WRITE_EXTERNAL_STORAGE\|SYSTEM_ALERT_WINDOW" \
  android/app/build/intermediates/merged_manifest/debug/AndroidManifest.xml   # expect 0 in the MERGED one
```

- [ ] Source manifest count is 0 → `________________`
- [ ] **Merged** manifest count is 0 → `________________`

The merged one is the check that matters. The source manifest can be clean while a library
re-injects a permission during the merge — that is the entire failure mode this exists to catch.

> An `android/` directory already exists locally (generated 2026-08-15, gitignored, predating the
> fix) whose manifest still lists all three as plain entries with no `tools:node` markers. That is
> expected and is not evidence of failure — it was generated before the change. `--clean`
> regenerates it. Afterwards: `rm -rf android` and `git checkout -- package.json`, because prebuild
> re-adds an `"ios"` script every run (see Closing the session).

---

## Part 8 — The eyes-only checklist

Added 2026-08-30. **NOT RUN.** These are the checks no script can settle, gathered from
`docs/superpowers/notes/2026-08-23-mobile-ui-revamp-handoff.md` §5 and from the visual gates
deferred across this document.

They are ordered by the app's own navigation, first run to daily use, so nothing needs a second
lap. **Switch the phone to 3-button navigation** first (Settings → System → Gestures → System
navigation) — it is the tightest case for every reachability check here, because the nav bar eats
the most screen height.

Each item says what to look at **and what a failure looks like**, because "check the shadow" is not
a check. Record what you saw; "OK" is not an outcome.

Everything below assumes Rule 0 in the runbook: the recovery-phrase screen is never screenshotted,
never dumped, never described word by word.

### 1. All twelve onboarding steps, from a WIPED install

Uninstall first, not "clear data" — a reused install skips straight past the first-run screens.

- **Look at:** every step from welcome to the finish summary, in one pass, tapping through as a
  real user would.
- **Failure looks like:** a Continue that silently does nothing after it has already written real
  wallet rows; a step that dead-ends and needs a force-quit; a skip that lands somewhere unusable
  rather than in a working app. Two defects of exactly this shape were found on 2026-08-17, and
  both passed every per-screen test.
- **Then repeat on a second fresh install, skipping every optional step.**
- → `________________`

### 2. The onboarding footer against the navigation bar

- **Look at:** the bottom of every onboarding step, and the primary button on each.
- **Failure looks like:** the button sitting under Android's navigation bar, or half-covered by it.
  This has happened here: the footer carried 24dp of flat padding against a navigation bar that
  measured 126px on this exact handset.
- → `________________`

### 3. Plan and More land on their HUB screens

Still open from an interrupted session. `run_e2e_qa.ps1 -Only nav_hubs` asserts this structurally;
this item is the visual confirmation, which is not the same thing.

- **Look at:** tap Plan. Then tap More. Then navigate into a leaf under each (Bills, Settings), go
  back to another tab, and tap Plan / More again.
- **Failure looks like:** the tab landing directly on Bills or on Settings rather than on the hub —
  especially on the *second* press, where a stack that restored its last leaf looks identical to a
  hub in any test.
- → `________________`

### 4. The three touch targets deliberately left unmeasured

`components/ui/date_field.tsx`, `components/ui/numeric_field.tsx`, and
`components/transactions/manual_entry_form.tsx` (all three paths confirmed present, 2026-08-30).
They are borderline against the 44pt minimum and their real painted height depends on an unstyled
platform-default text size that cannot be verified off-device. They were reported rather than
adjusted, because guessing a `hitSlop` on a widely shared primitive risks the overlapping-responder
bug that already had to be fixed once on `Chip`.

`run_e2e_qa.ps1 -Only touch_targets` prints each one's painted size in px and in dp at this
device's density. **That is a measurement, not a verdict** — the decision is here.

- **Look at:** the dp height the script reports, and then the field itself under a thumb.
- **Failure looks like:** a number under 44dp *and* a field that needs a second attempt to hit.
  Either alone is a judgement call; both together is a defect.
- **Do not fix it by adding `hitSlop` on the shared primitive without checking neighbours.** A slop
  that reaches into an adjacent responder trades a missed tap (noticed and retried) for a
  wrong-target tap (silent).
- → date_field `________` · numeric_field `________` · manual_entry_form `________`

### 5. Adjacent-chip mis-tap

Chips carry a `hitSlop` to reach the 44pt minimum their painted pill (~22px) does not meet. Rows are
spaced `gap-2` (8px), so horizontal slop is capped at half the gap to stop neighbouring responders
overlapping. **Jest has no real hit-testing** — it can pin the numbers and not the behaviour.

- **Look at:** a dense filter row. Tap along it deliberately, aiming at each chip in turn, including
  the short ones ("3x").
- **Failure looks like:** the chip *next to* the one you aimed at activating. That is the failure
  that matters, because a missed tap is noticed and retried while a wrong-chip tap silently applies
  a filter value the user never chose.
- → `________________`

### 6. Chip geometry in dense rows

- **Look at:** the same rows, at rest. Pill height, the gap between pills, wrapping onto a second
  line.
- **Failure looks like:** pills that read as different heights, a wrap that leaves one orphan chip,
  or a very short label whose pill is visibly narrower than its neighbours in a way that reads as
  broken rather than as deliberate.
- → `________________`

### 7. Card shadow and hairline, light AND dark

- **Look at:** any card-heavy screen (Home, Wallets) in light mode, then the same screen in dark.
- **Failure looks like:** in light, a shadow so faint the card has no edge at all, or so heavy it
  reads as a modal; in dark, a hairline that has vanished into the background, or a shadow that
  shows as a grey halo rather than depth. Dark mode is where this usually breaks, because a shadow
  tuned on white has nothing to darken.
- → light `________________` · dark `________________`

### 8. The red Transactions tab badge

- **Look at:** the badge over the Transactions tab glyph with the review queue non-empty
  (`run_e2e_qa.ps1 -Only review_queue` forces an item into it).
- **Failure looks like:** the badge clipped by the tab bar's edge, reflowing the other tabs when it
  appears, or its red failing against the tab-bar background. Also worth confirming against a known
  defect: **the count over-counts unrecognised apps** — spec rule 18 counts unknown-provider items
  one per *source app*, while `countOpen()` counts rows, so one chatty unrecognised app inflates it.
- → `________________`

### 9. Soft warn and danger chips, in daylight

- **Look at:** a warn chip and a danger chip, outdoors or under a bright window, at the phone's
  auto brightness.
- **Failure looks like:** the text washing out to unreadable against its own tint. This is the
  known-bad direction: all three soft tones originally failed AA on their own tints (brand 3.96,
  danger 3.69, warn 2.63) and were replaced with dedicated ink tokens measured at 5.63 / 6.36 /
  5.85. Numbers that clear AA on a monitor can still be unreadable in sun.
- → `________________`

### 10. Bottom sheets against the navigation bar

- **Look at:** each sheet you can reach — wallet balance correction, cash reconcile, the
  review-queue correction sheet, the category picker.
- **Failure looks like:** the sheet's Confirm/Save button under the nav bar, or a band of empty
  reserved space at the bottom of a form after a sheet has been dismissed while holding the keypad
  (roughly 350dp of reserved nothing — note WHICH screen and roughly how much).
- → `________________`

### 11. The four Plan back-stack checks

- **Look at:** from Home, tap an alert → its detail screen → **Android system back**.
- **Failure looks like:** a blank screen, or Home, instead of **the list** the detail belongs to.
  Repeat for all four Plan surfaces (limits, bills, loans, goals) — one of them behaving is not
  evidence about the others, since each is its own stack.
- → limits `______` · bills `______` · loans `______` · goals `______`

### 12. Motion, with "Remove animations" OFF and then ON

Settings → Accessibility → Remove animations.

- **Look at:** the same transitions both ways. Screen pushes, sheet presentations, the splash.
- **Failure looks like, with it OFF:** motion that reads as wrong rather than absent — a spring
  that overshoots and wobbles, a transition that lands late, an easing that feels mechanical. The
  automated tests cover keyframe transcription and the reduced-motion degrade; **nothing automated
  can tell you whether the port reads as the designer's animation**, and that is the only question
  here.
- **Failure looks like, with it ON:** anything still moving, or a screen that ends up in the wrong
  final state because the animation was carrying the layout.
- → off `________________` · on `________________`

### 13. `ImagePlaceholder` overflow

`components/ui/image_placeholder.tsx`. Jest runs no real Yoga layout pass, so its test can only
assert the **absence** of a fixed height and of `overflow: hidden`. Whether the box actually grows
is a question only a layout engine can answer.

- **Look at:** the onboarding value carousel (`components/onboarding/value_carousel.tsx`) — the
  longest art brief it renders.
- **Failure looks like:** the brief text clipped at the bottom of the placeholder box, or running
  outside its border, instead of the box growing to fit. One screenshot settles it.
- → `________________`

### 14. Dark mode, on the core flow

- **Look at:** capture → ledger → Home, entirely in dark mode.
- **Failure looks like:** anything unreadable, or — worse and easier to miss — a colour that reads
  as the **wrong status**: a warn that looks like a danger, a positive amount that looks negative.
- → `________________`

### 15. The CSV, in a real spreadsheet

Export a CSV and open it in Excel or Sheets. Not a text editor.

- **Look at:** two specific things. A merchant name containing a comma, and the peso column.
- **Failure looks like:** the comma merchant split across two columns, or the peso column
  right-aligned as text rather than summing as numbers.
- → `________________`

### 16. The JSON export bundle

- **Look at:** open the exported bundle and read it.
- **Failure looks like:** truncation, missing sections, or an amount serialised in a unit that does
  not match its label.
- → `________________`

### 17. Wipe everything

Do this last: it destroys the state every check above depends on.

- **Look at:** the ledger, wallets, **and the privacy centre** after the wipe — not just the home
  screen.
- **Failure looks like:** the app returning to onboarding while any of those three still holds a
  row. A clean Home over a dirty database is exactly the failure this check exists for.
- → `________________`

### Commit the results

```bash
git commit --allow-empty -m "test(mobile): record eyes-only device checklist results"
```

---

## Closing the session

```bash
cd mobile
rm -rf android
git checkout -- package.json     # prebuild re-adds the "ios" script every run
git status                       # must be clean

git commit --allow-empty -m "test(security): record on-device encryption verification results"
git commit --allow-empty -m "test(mobile): record on-device notification listener verification results"
git commit --allow-empty -m "test(mobile): record MVP end-to-end verification results"   # Part 6
```

Paste the recorded numbers into those commit messages — an empty commit whose message says
nothing is worth nothing.

---

## Known items that will surface later, not blockers for this session

- **Play Store permissions. LEVER PULLED 2026-08-17 (`26497ad`) — but confirmation is a build
  step, see Part 7 below.** The generated manifest carried `READ_EXTERNAL_STORAGE`,
  `WRITE_EXTERNAL_STORAGE` and `SYSTEM_ALERT_WINDOW`, pulled in by *libraries* rather than by
  `app.json` (whose own `android.permissions` declares only the two biometric ones). All three
  draw review scrutiny for a finance app, and `SYSTEM_ALERT_WINDOW` disproportionately so — a
  draw-over-other-apps grant is the signature permission of overlay credential stealers, which is
  exactly the threat a banking-adjacent app is screened for. `android.blockedPermissions` now
  lists all three.
- **No manual "Lock now" action** is exposed yet; only the 5-minute background timer reaches
  `lockNow()`. The Settings screen (M3b) is its natural home.
- **Two money formatters exist** — `formatPeso()` in `lib/alerts/alert_copy.ts` versus the
  contract-designated `formatCentavos()`. M1c must reconcile them or the contract must carve out
  an explicit exception.

---

# Session 2 — M1 walkthrough (M1c Task 11, Step 4)

Added 2026-08-14, when M1 became code-complete. **Not yet run** — it needs the dev client that
Session 1 could not get past the Metro manifest, plus a device.

Everything below is a claim the test suite cannot make. 1810 tests prove the pieces behave; this
proves the product works.

## Preconditions

- The EAS dev build installed (Session 1's route — the Windows `MAX_PATH` failure has not gone
  away, so a local build is still not an option).
- A cash wallet and a GCash wallet, so the manual-entry and matcher paths both have somewhere to go.

## The walkthrough

Record the actual outcome in each box. "OK" is not an outcome.

- [ ] **Grant notification access from inside the app** → `________________`
- [ ] **Create a GCash wallet and bind its matcher** → `________________`
- [ ] **Post an illustrative GCash notification; it lands in the ledger within seconds**
      → `________________`
- [ ] **"Why was this recorded?" shows the captured text and a real expiry countdown**
      → `________________`
- [ ] **Post a twin SMS-style notification; it does NOT double-count** → `________________`

  > Expect this one to fail as seeded, and it is not a bug in the gate. The shipped seed cannot
  > express one bank on two channels — a BPI push is `providerKey: "bpi"` and its SMS relay is
  > `"sms_relay"`, so they never compare as the same provider and §6's twin window can never fire.
  > Recording the failure here is the point: it is the evidence the corpus work needs.

- [ ] **Move money between two wallets; the transfer links and is excluded from spend**
      → `________________`
- [ ] **A low-confidence capture appears in the Review Queue** → `________________`
- [ ] **Correcting it creates a UserRule, and the next matching capture uses it**
      → `________________`
- [ ] **Add a cash transaction manually** → `________________`
- [ ] **Reconcile the cash wallet; the adjustment appears and past rows are untouched**
      → `________________`
- [ ] **The whole flow renders correctly in dark mode** → `________________`

## Known issues to confirm or refute while you are in there

- **The badge over-counts unrecognised apps.** Spec rule 18 counts unknown-provider items one per
  *source app*; `countOpen()` counts rows, so one chatty unrecognised app inflates the number.
- **Balance drift has no dismiss.** The badge is display-only until a schema decision is made
  (see below).
- ~~**Seven test files are in the route table.**~~ **CHECKED AND DISPROVEN, 2026-08-15 — not a
  blocker, and no device needed.** `npx expo export --platform android` produces the real
  production bundle; it contains **no test content at all** — zero hits for any test name, for
  `testing-library`, for `renderRouter`, for `beforeEach`. The single `__tests__` occurrence in the
  bundle is the literal glob `**/__tests__`, which is expo-router 6's own **exclusion** pattern, so
  the router is filtering these out by default rather than routing them.

  Two corrections while we are here: there are **twelve** files in `app/__tests__/`, not seven,
  plus `app/(onboarding)/__tests__/` — so the original count was wrong as well as the conclusion.
  Re-run the export check if expo-router is ever majored, since this rests on the router's default
  ignore list rather than on anything this repo controls.

## Commit the results

```bash
git commit --allow-empty -m "test(mobile): record M1 on-device walkthrough results"
```

Paste the recorded outcomes into that message. An empty commit whose message says nothing is worth
nothing.

---

## W1 — Numeric input system

W1 replaced every numeric `TextInput` in the app with the app-owned floating keypad
(`NumericField` / `KeypadHost`) and every `YYYY-MM-DD` text box with `DateField`'s native date
dialog. Jest has no layout engine and mocks the keyboard library wholesale, so **every layout and
interaction claim below is unverified until a human walks it on a real phone.**

**Two prerequisites, before anything else below:**

- [ ] **Rebuild the dev client.** `@react-native-community/datetimepicker` is a native module — a
      JS reload will not pick it up, and every date field in this section fails until a fresh
      `npx expo run:android` (or a new EAS dev build) is installed → `________________`
- [ ] **Switch the phone to 3-button navigation** (Settings → System → Gestures → System
      navigation) for this whole walkthrough. It is the tightest case for every scroll / Save-
      reachability check below — the nav bar eats the most screen height, so if a Save button
      clears it here, gesture navigation was never the mode that would hide it. Spot-check
      gesture navigation afterward if time allows → `________________`

Work top to bottom — the order follows the app's own navigation, first run to daily use, so
nothing needs a second lap. Record what you actually saw in every box, same rule as the rest of
this document; "OK" is not an outcome.

### Onboarding (fresh install)

Run this on a fresh install — uninstall first, not just clear data. A reused install skips
straight past the fresh-install screens.

- [ ] None of these screens have an amount field: device lock, recovery phrase, the provider
      picker, welcome, how it works, notification access, battery/OEM guidance, and the finish
      summary. Confirm each looks exactly as it did before this branch as you pass through it —
      spacing, text, nothing shifted → `________________`
- [ ] Wallet setup: type `1000` into any proposed wallet's opening balance. It reads ₱1,000.00.
      Type `1000.50` — it reads ₱1,000.50 → `________________`
- [ ] **The original bug report, same field:** type `100000` into a wallet's opening balance. It
      must read **₱100,000.00**, not ₱1,000.00 → `________________`
- [ ] Uncheck a proposed wallet. Its whole row dims, including the opening-balance field — visibly
      greyed out — and the field stops responding to taps → `________________`
- [ ] Income step: tap the amount field. The keypad opens and "Save my income" stays reachable
      without scrolling under it → `________________`
  > **Judgement call — no test covers this.** Nothing scrolls the focused field into view when
  > the keypad panel shrinks the onboarding frame's viewport, and this field sits below a
  > four-row cadence picker. It may scroll out of sight on the very tap that focuses it.
  > Survivable — the panel still shows the value and the field's name — but note how it actually
  > feels on the device.
- [ ] Income step, with the keypad open and an amount typed: tap **"Save my income."** The keypad
      closes and does not reappear on the next screen. Reopen the keypad, then instead tap the
      frame's own **"Let PeraPlano figure it out"** — same result → `________________`

### Home

- [ ] On a fresh install with notification access granted and nothing captured yet, Home shows
      the "Watching for your first transaction" empty state. Read its action button closely —
      does it say **"Add manually,"** or is it clipped to **"Add"**? → `________________`
  > **Still unresolved from the original report — diagnose here.** The string is correct in
  > `components/ui/empty_states.tsx` and correctly wired in `app/(tabs)/index.tsx`; the component
  > applies no width constraint and no `numberOfLines`. Suspect a reflow when the Inter font
  > finishes loading, after the label has already painted once. Try backgrounding and reopening
  > the app, or rotating the screen, once the font would have had time to load, and see whether
  > the label corrects itself. Do **NOT** fix it by shortening the label — the point is to find
  > where the reflow happens, not to hide it.

### Manual transaction entry

Reach it from Home's empty-state action — on this build that is the ONLY in-app entry point,
and it stops appearing the moment the ledger holds a single row (the Transactions tab's own
empty state renders no action button). If you need to come back a second time in this session:

```bash
adb shell am start -a android.intent.action.VIEW -d "peraplano://transaction/new"
```

- [ ] The screen lands with the keypad already open on the amount field, and Save is reachable
      without scrolling under it → `________________`
- [ ] Type `1000` — reads ₱1,000.00. Type `1000.50` — reads ₱1,000.50 → `________________`
- [ ] With the keypad open, tap the category row, then the "Spent"/"Received" toggle. Each
      registers on the very FIRST tap — neither is swallowed by the panel closing
      → `________________`
- [ ] Press hardware Back while the keypad is open. The keypad closes; you are still on the
      manual-entry screen → `________________`
- [ ] The date field opens the Android date dialog, not a text box. It refuses a future date, and
      **today is still pickable** (the bound is "now," including the current time of day —
      confirm the clock has not already excluded the rest of today) → `________________`
- [ ] The date dialog itself renders acceptably — default Android colours/theme, nothing clipped
      or mis-tinted. (Its optional colour-theming plugin could not be auto-added to this app's
      dynamic `app.config.js`, so this runs on Android's own defaults rather than a themed build —
      cosmetic only; just confirm it looks right) → `________________`
- [ ] No screen so far has raised the Android on-screen keyboard for typing a number. Keep this in
      mind for every screen still to come, and flag it immediately if one ever does
      → `________________`

### Wallets

The Wallets tab has no "Add wallet" button once the list is non-empty — onboarding already
creates at least a cash wallet, so this screen normally has nothing to tap. Reach the New screen
directly:

```bash
adb shell am start -a android.intent.action.VIEW -d "peraplano://wallet/new"
```

- [ ] **Wallet → New:** tap the opening-balance field. The keypad opens, the form scrolls, and
      Save stays reachable without being hidden under the panel → `________________`
- [ ] **Wallet detail → Edit** (any wallet): the form scrolls correctly and Save is reachable. This
      is the screen from the original bug report → `________________`
- [ ] **Navigating away with the panel still open.** On **Wallet → New**, tap the opening-balance
      field so the keypad comes up, then — WITHOUT closing it — tap **Save**. Save is reachable
      with the panel open by design, so this is an ordinary thing to do. The keypad must be gone
      the instant the Wallets list appears, and your NEXT back press must navigate rather than
      being swallowed. Repeat with hardware Back instead of Save (two presses: the first closes
      the panel, the second leaves the screen) → `________________`
  > **The regression this is here for.** The panel is global state drawn by the host beside the
  > Stack, which never unmounts on navigation — so nothing used to take it down when the SCREEN
  > went away. A keypad left floating over the wallet list, wired to a form that no longer exists,
  > with its back-press handler still live. Watch specifically for a first back press that does
  > nothing visible. Any migrated form works for this; Wallet → New is just the shortest path.

### Income

There is no Income row on the Plan hub — the only in-app path to this screen is Plan → Limits →
add a limit → "% of income" → "Set my income," and that link only shows up while income is still
unknown. Once income is known there is no menu path back to it, so reach it directly instead:

```bash
adb shell am start -a android.intent.action.VIEW -d "peraplano://plan/income"
```

- [ ] Re-open **"Change my income"** on income PeraPlano detected on its own (not one you set
      manually). Detection produces an average, rarely a round peso — e.g. ₱18,333.33 — so the
      field seeds already at two decimal places, the maximum the input allows. Tap the field and
      press a digit: it must **replace** the seeded figure, so pressing `2` leaves ₱2, not a
      keypad that ignores you. If your test account's income was set manually instead, this needs
      an account where detection produced the figure — note if you could not reproduce the setup
      this session → `________________`
  > **Fixed on this branch, and worth confirming by hand.** Before the fix every digit key was
  > inert on a seeded non-round amount — no error, no explanation, the field simply appeared not
  > to respond — because `appendKey` refuses everything once the fraction is full.
- [ ] Same field, same seeded figure: press **backspace** instead. It must edit the seeded value
      in place (₱18,333.33 → ₱18,333.3), NOT clear the whole thing — and the next digit must then
      append to what is left (→ ₱18,333.35), not replace it → `________________`
  > The other half of the same rule. Replace-on-first-keystroke is for someone retyping the
  > figure; backspace means they are correcting it, and throwing away the part they kept would be
  > the worse bug of the two.

### Bills

Plan → Bills → add a bill.

- [ ] The amount field and the "Day of the month" field (the default due-date rule) each carry a
      small extra gap above them versus before this branch — about 8px, from `NumericField`'s own
      built-in top margin. Confirm it reads as intentional spacing, not a layout glitch
      → `________________`
- [ ] The decimal key is visibly dimmed and does nothing when tapped on "Day of the month" (the
      default due-date rule). Switch the rule to "Every few months" and check "Every how many
      months?" too; switch to "Every few weeks" and check "Every how many weeks?" — same dimming
      on all three → `________________`

### Loans

Plan → Loans → add a loan.

- [ ] The screen's top spacing, below the tab bar, looks right — no extra gap and nothing crowding
      the first row, now that this route's own wrapper was removed and its `pt-4` restored
      directly on the form → `________________`
- [ ] Choose **"Fixed installments."** The decimal key is dimmed and inert on "How many payments"
      and "Days between payments" → `________________`
- [ ] Choose **"With interest."** The decimal key stays ACTIVE on "Annual rate" — it is not an
      integer field, and a rate like 12.5% needs one — but is dimmed and inert on "Months" right
      below it, the same as the other integer fields on this form → `________________`
- [ ] The "First payment due" date picker refuses a past date, and **today is still pickable**
      → `________________`

### Goals

Plan → Goals → create a goal.

- [ ] The optional deadline date picker refuses a past date, and **today is still pickable**
      → `________________`

### Bottom sheets

Four sheets now host the keypad: goal allocation, wallet balance correction, cash reconcile, and
the review-queue correction sheet. By now you have already passed through Wallets and Goals above
— Review Queue is the one new stop. Reach them here:

- **Balance correction** — Wallet detail on any bank / savings / e-wallet (not cash) → "Adjust
  balance."
- **Cash reconcile** — Wallet detail on a **cash** wallet → "Reconcile."
- **Review-queue correction** — the Review Queue banner/badge is absent at zero, by design, so
  force an item into it first: post a notification from a package no wallet's matchers cover
  (same technique as Part 3's live-capture check, e.g.
  `adb shell cmd notification post -S bigtext -t "TEST" tag1 "Sent PHP 500.00 to a friend."` from
  an unmatched app) — it lands as an unknown-provider card. Then Transactions tab → the "Needs
  your review" banner → "Correct."
- **Goal allocation** — opportunistic, not a button: it only appears once a payday is detected and
  at least one goal has a "move money automatically on payday" rule set. It may not surface in one
  sitting — verify the other three fully, and leave this one recorded as not-reached this session
  if it never appears.

Verify these three on every sheet you can reach:

- [ ] The keypad draws ABOVE the sheet, never behind it → `________________`
- [ ] The sheet's own Confirm/Save button is never covered by the panel → `________________`
- [ ] Closing the sheet (backdrop tap, or hardware Back) while the keypad is open closes the
      keypad first, rather than closing both at once or leaving the panel floating
      → `________________`

Three more, and they are the ones the checks above do NOT reach — everything so far opens a keypad
INSIDE a sheet that is already there. These start from a keypad that is already open:

- [ ] **Opening a sheet while the panel is already up.** Manual entry (`peraplano://transaction/new`)
      lands with the keypad already open. WITHOUT closing it, tap the category row. The category
      picker opens as a sheet, and the panel must re-appear ABOVE it — not behind it, not gone,
      not duplicated (exactly one keypad on screen). Dismiss the picker: the panel closes with it
      and you are back on the manual-entry form with the amount you typed intact
      → `________________`
  > The panel physically moves between native windows here — a sheet is its own window, so the
  > keypad is torn down at the root and redrawn inside the sheet. Two panels, a panel behind the
  > picker, or a flicker on the handover all belong in the box.
- [ ] **The dead band a dismissed sheet can leave behind.** Same sequence as above, but stay on
      the screen afterwards: open the panel, open the picker sheet, dismiss the picker, then close
      the keypad. Look at the bottom of the form. There must be NO band of empty space where the
      panel used to be — Save/Confirm sits where it did before you started, not pushed up by
      several centimetres. Repeat inside the review-queue correction sheet (tap the amount, tap
      the category row, dismiss the picker) and check Confirm's position there
      → `________________`
  > **The measurement, not the panel.** The panel's height is published for the forms and sheets
  > to reserve space with, and a sheet that dies while holding the panel used to take the panel
  > with it and leave the MEASUREMENT behind — roughly 350dp of reserved nothing, on every form
  > and sheet, until someone opened and closed a keypad at the root. If you see it, note WHICH
  > screen and roughly how much space.

- [ ] **On the review-queue correction sheet specifically, with the keypad open on the amount
      field:** its content runs to roughly 830dp, and the panel may now clip off the TOP of the
      sheet — the grab handle and the "Fix what's wrong" title — while Save stays reachable.
      Judge whether that reads acceptably in practice on this device → `________________`
  > **A known trade, not an oversight.** The alternative was an unreachable Save. If the clipping
  > does not read as acceptable, the named remedy is a `maxHeight` from `useWindowDimensions()`
  > on the panel, or shrinking the sheet's own `max-h-96` scroll area while a panel is open.

### Reports

More → Reports.

- [ ] Pick a period with little or no data (or scroll past the summary on an empty one). The
      background below the short content is the same colour as the rest of the screen — no visible
      seam or mismatched band, even though it is now painted by the navigator rather than by the
      scroll view itself → `________________`
- [ ] Open **"Custom range."** The Start and End date pickers bound each other — End cannot be set
      before Start, and Start cannot be set after End → `________________`
- [ ] With no End date chosen yet, Start's picker still allows **today** → `________________`

### Wrap-up

- [ ] Across this entire walkthrough, no screen ever raised the Android on-screen keyboard for a
      number → `________________`
- [ ] Every other migrated form not already named above — bills, loans, and goals — also kept its
      Save button reachable without being hidden under the panel, in the same 3-button navigation
      this walkthrough started in. Flag any exception → `________________`

### Commit the results

```bash
git commit --allow-empty -m "test(mobile): record W1 on-device verification results"
```

Paste the recorded outcomes into that message. An empty commit whose message says nothing is worth
nothing.
