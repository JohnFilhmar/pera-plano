# Build variants — naming & direct ADB install

How the three PeraPlano build variants are named, and how to build each one
locally and install it onto a USB-connected device with `adb`.

## The three variants

Each variant has its own Android package id, so all three coexist on one device,
and its own app / notification-listener label, so they are tellable apart on the
launcher and on the **Notification Access** screen.

| `APP_VARIANT` | App name         | Android package                 | Build type |
| ------------- | ---------------- | ------------------------------- | ---------- |
| `development` | **PeraPlano(Dev)**  | `com.filldev.peraplano.dev`  | debug (dev client, JS from Metro) |
| `preview`     | **PeraPlano(Prev)** | `com.filldev.peraplano.prev` | release (standalone, JS bundled)  |
| `production` / unset | **PeraPlano** | `com.filldev.peraplano`      | release |

### How it works

`mobile/app.config.js` reads `process.env.APP_VARIANT` and overrides `name` and
`android.package` on top of the static `mobile/app.json`. Because the package is
driven from config, `expo prebuild` regenerates it every time — there is no
hand-edited `applicationIdSuffix` in the gitignored `android/` project that a
`--clean` prebuild could drop.

`mobile/eas.json` sets `APP_VARIANT` in each build profile's `env`, so EAS builds
pick the same identity automatically.

**`APP_VARIANT` unset means production.** A local build that forgets to set it
produces `PeraPlano` / `com.filldev.peraplano` and installs over the production
app. An *unrecognised* value (`prev`, `dev`, `Preview`) throws instead of falling
back, so a typo fails the build rather than silently mislabelling it.

The commands below use PowerShell (the primary shell on this machine). All paths
assume the repo is at `D:\My Folder\pera-plano`.

---

## Step 0 — prerequisites

- USB debugging enabled on the device, and the device authorized for this laptop.
- **`mobile/app.config.js` must exist in the checkout you are building from.**
  Without it there is no variant logic at all: every build gets the production
  name and package, and each install overwrites the last.

Verify both before building anything:

```powershell
Test-Path "D:\My Folder\pera-plano\mobile\app.config.js"   # must print True
adb devices                                                 # one line ending in "device"
```

If `Test-Path` prints `False`, merge the branch carrying the change first.

---

## Step 1 — Development build → device (PeraPlano(Dev))

The dev client is a debug APK whose **JS is served by Metro, not bundled**, so
Metro has to be running for the app to load.

```powershell
cd "D:\My Folder\pera-plano\mobile"
$env:APP_VARIANT = "development"
npx expo prebuild --clean -p android

# Confirm prebuild wrote the dev identity before spending time on a build:
Select-String -Path android\app\build.gradle -Pattern "applicationId"
# expect: applicationId 'com.filldev.peraplano.dev'

cd android
.\gradlew.bat assembleDebug
adb install -r --user 0 app\build\outputs\apk\debug\app-debug.apk
cd ..
npx expo start --dev-client
```

Then open **PeraPlano(Dev)** on the phone — it connects to Metro over USB.

One-shot shortcut (build + install + start Metro):

```powershell
$env:APP_VARIANT = "development"
npx expo run:android --variant debug
```

APK path: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

---

## Step 2 — Preview build → device (PeraPlano(Prev))

Preview is a **release** APK with **JS bundled in** — standalone, no Metro.
`assembleRelease` bundles the JS automatically and signs with the debug keystore,
so it installs with no keystore setup.

`prebuild --clean` regenerates `android/` for one variant at a time, so re-run it
for preview after building dev:

```powershell
cd "D:\My Folder\pera-plano\mobile"
$env:APP_VARIANT = "preview"
npx expo prebuild --clean -p android

# Confirm prebuild wrote the preview identity:
Select-String -Path android\app\build.gradle -Pattern "applicationId"
# expect: applicationId 'com.filldev.peraplano.prev'

cd android
.\gradlew.bat assembleRelease
adb install -r --user 0 app\build\outputs\apk\release\app-release.apk
cd ..
```

Launch **PeraPlano(Prev)** directly — it runs offline.

APK path: `mobile/android/app/build/outputs/apk/release/app-release.apk`

Reset the env var if you keep the shell open:

```powershell
Remove-Item Env:\APP_VARIANT
```

---

## Step 3 — after install

Notification capture needs the grant, per variant: **Settings → Notifications →
Notification access** (Samsung One UI wording varies) → enable the row labeled
**PeraPlano(Dev)** or **PeraPlano(Prev)**.

---

## Traps

- **One build overwrites the other.** Both APKs carry the same `applicationId`,
  so Android treats the second install as an update of the first. Causes, in the
  order worth checking: `app.config.js` missing from the checkout (Step 0), or
  `APP_VARIANT` not set in the shell that ran `prebuild`. Confirm with the
  `Select-String` check above, and with `adb shell pm list packages peraplano` —
  a working pair shows both `com.filldev.peraplano.dev` and
  `com.filldev.peraplano.prev`.
- **The old `applicationIdSuffix ".dev"` hack is gone, deliberately.** It used to
  be hand-added to `android/app/build.gradle`, which `prebuild --clean` wipes —
  that is precisely how both builds ended up sharing one package id. The suffix
  must not be re-added: with the config-driven package it would produce
  `com.filldev.peraplano.dev.dev`.
- **A second, badged copy of the icon appears after install.** `adb install`
  installs for *every* Android user, and the Samsung test device permanently
  carries a Dual App profile (user 95) next to Secure Folder (user 150), so the
  sideload is cloned there and One UI draws a second icon. The clone is a real
  second instance: its own data directory, its own notification-access grant,
  its own encrypted ledger. Install owner-only with `--user 0` (as above), and
  clear an existing clone with:

  ```powershell
  adb shell pm list users                                   # confirm the DUAL_APP user id
  adb shell pm uninstall --user 95 com.filldev.peraplano.dev
  ```

  Verify with `adb shell dumpsys package <pkg> | Select-String "User \d+:"` —
  only user 0 should read `installed=true`.
- **`INSTALL_FAILED_UPDATE_INCOMPATIBLE` on reinstall.** Each `prebuild --clean`
  mints a fresh debug keystore, so a rebuilt APK may carry a new signature.
  Fix: `adb uninstall com.filldev.peraplano.prev` (or `.dev`), then install again.
- **Order matters.** dev and preview share the `android/` folder; the `--clean`
  between them is required, and it wipes uncommitted native edits (`android/` is
  gitignored, so this is expected).
- **Ninja swap is safe.** The local ninja swap lives in the Android SDK/cmake,
  not in `android/`, so `--clean` does not touch it.

---

## Alternative — EAS (respects the same config automatically)

```powershell
eas build --profile development --platform android
eas build --profile preview --platform android
```

Download the resulting APK, then `adb install -r <file>`.
