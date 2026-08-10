# On-Device Verification — one session, two plans

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
> | **Gate A** — Argon2id timing | **NOT RUN** — needs JS in Hermes; blocked |
> | Part 3 switches / drain-empties | **NOT RUN** — need the JS bridge; blocked |
> | Part 4 database unreadable / ledger / re-lock | **NOT RUN** — need onboarding; blocked |
> | Battery-manager 2 h idle | **NOT RUN** — and this device is Samsung, not one of the four target OEMs |
> | Part 5 (screen lock, fingerprint, no-lock device) | Deferred by decision |
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
| JS suite | 679 tests, 43 suites, green |
| Kotlin suite | 87 tests, 10 suites, green |
| `tsc --noEmit` | clean |
| Prebuild → generated manifest | `<service>`, its intent-filter, and `RECEIVE_BOOT_COMPLETED` verified present; no `READ_SMS` |
| Log hygiene | no key, DEK, phrase, or notification text reachable from any log or exception message |

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

## Part 1 — Two ship gates. Do these FIRST.

Both fix parameters that **cannot change once a real user holds a recovery phrase**. Measuring
them after release is measuring something you can no longer act on.

### Gate A — Argon2id derivation timing

The parameters (`m=2048 KiB, t=2, p=1`) were tuned against Jest, which is materially slower than
a Hermes release build. The real figure is unknown, and **too fast is as bad as too slow** — it
means the recovery phrase is cheaper to brute-force than intended.

Time `deriveRecoveryKey` on a mid-range device. **Target ≈ 500 ms – 1 s.**

- Measured: `________ ms`
- Device / chipset: `________________`
- If far off target, retune **now**, while no user has a phrase.

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
adb shell am force-stop com.peraplano.app
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

## Part 5 — Three platform behaviours only a human changing phone settings can prove

### Remove the screen lock
- [ ] `isDeviceKeyUsable()` goes false; the app detects it on next unlock, prompts for the
      recovery words, requires a screen lock to be set again, and restores access to the **same
      ledger with no data loss** → `________________`

### Enroll an additional fingerprint
- [ ] **The key must SURVIVE.** → `________________`

> This is the only proof that `setInvalidatedByBiometricEnrollment(false)` actually took effect.
> If the app demands the recovery words here, the flag is wrong and **every user loses their
> history on a routine settings change.**

### A device with no screen lock at all
- [ ] Onboarding refuses to proceed and routes to security settings, rather than failing at key
      generation with an opaque error → `________________`

---

## Closing the session

```bash
cd mobile
rm -rf android
git checkout -- package.json     # prebuild re-adds the "ios" script every run
git status                       # must be clean

git commit --allow-empty -m "test(security): record on-device encryption verification results"
git commit --allow-empty -m "test(mobile): record on-device notification listener verification results"
```

Paste the recorded numbers into those commit messages — an empty commit whose message says
nothing is worth nothing.

---

## Known items that will surface later, not blockers for this session

- **Play Store permissions.** The generated manifest carries `READ_EXTERNAL_STORAGE`,
  `WRITE_EXTERNAL_STORAGE` and `SYSTEM_ALERT_WINDOW`, pulled in by *libraries* rather than by
  `app.json` (whose `android.permissions` is `[]`). All three draw review scrutiny for a finance
  app. `android.blockedPermissions` is the lever.
- **No manual "Lock now" action** is exposed yet; only the 5-minute background timer reaches
  `lockNow()`. The Settings screen (M3b) is its natural home.
- **Two money formatters exist** — `formatPeso()` in `lib/alerts/alert_copy.ts` versus the
  contract-designated `formatCentavos()`. M1c must reconcile them or the contract must carve out
  an explicit exception.
