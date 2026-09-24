import { readFileSync } from "fs";
import { join } from "path";

import type {
  AndroidManifest,
  ExportedConfig,
  ExportedConfigWithProps,
} from "expo/config-plugins";

import withNotificationListener from "../app.plugin.js";

/**
 * M1a plan Task 7 -- the config plugin that puts the listener service into the
 * generated `AndroidManifest.xml`.
 *
 * WHY A PLUGIN AND NOT A COMMITTED MANIFEST: `mobile/android/` is produced by
 * `expo prebuild` / EAS Build and is gitignored, so anything hand-written
 * there is destroyed on the next prebuild. The plugin is the only place this
 * declaration can live and survive.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE: they call the plugin against a
 * fixture manifest object and assert on the transformed structure, which pins
 * every attribute Android actually reads. They cannot prove the plugin is
 * registered and runs -- that is what the `npx expo prebuild` check in the
 * task's Step 5 is for, plus the app.json test at the bottom of this file.
 */

const MODULE_ROOT = join(__dirname, "..");
const APP_JSON = join(MODULE_ROOT, "..", "..", "app.json");
const SERVICE_KOTLIN = join(
  MODULE_ROOT,
  "android",
  "src",
  "main",
  "java",
  "expo",
  "modules",
  "notificationlistener",
  "PeraPlanoNotificationListenerService.kt",
);

const LISTENER_SERVICE_CLASS =
  "expo.modules.notificationlistener.PeraPlanoNotificationListenerService";
const BIND_PERMISSION = "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE";
const LISTENER_ACTION = "android.service.notification.NotificationListenerService";
const BOOT_PERMISSION = "android.permission.RECEIVE_BOOT_COMPLETED";
const PLUGIN_PATH = "./modules/notification_listener/app.plugin.js";
const LAUNCHER_ACTION = "android.intent.action.MAIN";
const LAUNCHER_CATEGORY = "android.intent.category.LAUNCHER";
const QUERY_ALL_PACKAGES = "android.permission.QUERY_ALL_PACKAGES";

const THIRD_PARTY_SERVICE = "com.example.thirdparty.SomeOtherService";
const PRE_EXISTING_PERMISSION = "android.permission.INTERNET";
/** Some other library's `<queries>` entry, so the tests catch a plugin that
 * assigns over the array instead of appending to it. */
const THIRD_PARTY_QUERY_PACKAGE = "com.example.thirdparty";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/**
 * A minimal stand-in for what prebuild hands the manifest mod: one
 * `.MainApplication`, one permission, and one service contributed by some
 * other library. The last two exist so the tests can catch a plugin that
 * *replaces* those arrays instead of appending to them -- a bug that would
 * silently strip other libraries' manifest entries.
 */
function prebuiltManifest(): AndroidManifest {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      "uses-permission": [{ $: { "android:name": PRE_EXISTING_PERMISSION } }],
      queries: [{ package: [{ $: { "android:name": THIRD_PARTY_QUERY_PACKAGE } }] }],
      application: [
        {
          $: { "android:name": ".MainApplication", "android:label": "PeraPlano" },
          activity: [{ $: { "android:name": ".MainActivity" } }],
          service: [{ $: { "android:name": THIRD_PARTY_SERVICE } }],
        },
      ],
    },
  };
}

/**
 * Applies the plugin `times` times, then runs the resulting manifest mod once.
 *
 * Applying twice is the realistic double-registration case (the plugin listed
 * in `app.json` and pulled in again by something else): `withAndroidManifest`
 * chains mods, so the transform genuinely runs twice over the same object.
 */
async function applyPlugin(
  manifest: AndroidManifest,
  times = 1,
): Promise<AndroidManifest> {
  let config = { name: "PeraPlano", slug: "pera-plano" } as ExportedConfig;
  for (let i = 0; i < times; i++) {
    config = withNotificationListener(config) as ExportedConfig;
  }

  const mod = config.mods?.android?.manifest;
  if (!mod) {
    throw new Error("the plugin registered no android manifest mod");
  }

  const result = await mod({
    ...config,
    modResults: manifest,
    modRequest: {},
  } as unknown as ExportedConfigWithProps<AndroidManifest>);

  return result.modResults;
}

function services(manifest: AndroidManifest) {
  return manifest.manifest.application?.[0]?.service ?? [];
}

/** Matched on `android:name` -- the only identity Android itself uses. */
function listenerServices(manifest: AndroidManifest) {
  return services(manifest).filter(
    (service) => service.$?.["android:name"] === LISTENER_SERVICE_CLASS,
  );
}

function queries(manifest: AndroidManifest): Array<Record<string, unknown>> {
  return (manifest.manifest as { queries?: Array<Record<string, unknown>> }).queries ?? [];
}

/**
 * The `<queries>` entries whose `<intent>` is the MAIN/LAUNCHER pair -- the
 * shape `AppLabels.kt` needs to resolve another app's real name on API 30+.
 */
function launcherQueries(manifest: AndroidManifest) {
  return queries(manifest).filter((entry) =>
    ((entry.intent ?? []) as Array<Record<string, Array<{ $?: Record<string, string> }>>>).some(
      (intent) =>
        (intent.action ?? []).some(
          (action) => action.$?.["android:name"] === LAUNCHER_ACTION,
        ) &&
        (intent.category ?? []).some(
          (category) => category.$?.["android:name"] === LAUNCHER_CATEGORY,
        ),
    ),
  );
}

function permissionNames(manifest: AndroidManifest): string[] {
  return (manifest.manifest["uses-permission"] ?? []).map(
    (permission) => permission.$["android:name"],
  );
}

function readAppJson(): {
  expo: {
    plugins: unknown[];
    android: { permissions: string[]; allowBackup: boolean };
    updates: { enabled: boolean };
  };
} {
  return JSON.parse(readFileSync(APP_JSON, "utf8"));
}

// ---------------------------------------------------------------------------

describe("notification listener config plugin", () => {
  it("injects the listener service with the BIND_NOTIFICATION_LISTENER_SERVICE permission", async () => {
    const manifest = await applyPlugin(prebuiltManifest());

    const injected = listenerServices(manifest);
    expect(injected).toHaveLength(1);

    // Asserted as a whole object, not attribute by attribute: every one of
    // these is load-bearing and a later edit must not be able to drop one
    // quietly. `android:permission` in particular is what stops ANY other app
    // from binding this service, and `android:exported="false"` is what stops
    // it being addressable from outside the app at all.
    expect(injected[0].$).toEqual({
      "android:name": LISTENER_SERVICE_CLASS,
      "android:exported": "false",
      "android:label": "PeraPlano",
      "android:permission": BIND_PERMISSION,
    });
  });

  it("injects the notification listener intent-filter action", async () => {
    const manifest = await applyPlugin(prebuiltManifest());

    // Without this exact action Android never routes notifications to the
    // service and never lists the app on the Notification Access screen --
    // and it fails silently, with a manifest that builds perfectly.
    expect(listenerServices(manifest)[0]["intent-filter"]).toEqual([
      { action: [{ $: { "android:name": LISTENER_ACTION } }] },
    ]);
  });

  it("adds RECEIVE_BOOT_COMPLETED to permissions", async () => {
    const manifest = await applyPlugin(prebuiltManifest());

    // Must land in `uses-permission` -- `permission` declares a NEW permission
    // rather than requesting one, so a plugin writing to that array would look
    // right in a diff and grant nothing.
    expect(permissionNames(manifest)).toContain(BOOT_PERMISSION);
    expect(manifest.manifest.permission).toBeUndefined();
  });

  it("applying the plugin twice does not duplicate the service element", async () => {
    const manifest = await applyPlugin(prebuiltManifest(), 2);

    // Counted by `android:name`, not by array length: a duplicate `<service>`
    // is a merge failure at build time, and a length check would pass for a
    // plugin that appended a second, differently-named element.
    expect(listenerServices(manifest)).toHaveLength(1);
    expect(
      permissionNames(manifest).filter((name) => name === BOOT_PERMISSION),
    ).toHaveLength(1);
  });

  it("never declares READ_SMS or RECEIVE_SMS", async () => {
    // POLICY GUARD -- DO NOT DELETE THIS TEST.
    // Google Play prohibits READ_SMS for expense tracking; shipping it risks
    // removal of the app. It also buys nothing: bank SMS reach PeraPlano as
    // notifications posted by the device's Messages app, which is exactly what
    // the listener service above captures.
    const manifest = await applyPlugin(prebuiltManifest(), 2);
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain("READ_SMS");
    expect(serialized).not.toContain("RECEIVE_SMS");

    // The static config is the other door these could come in through.
    const staticPermissions = readAppJson().expo.android.permissions;
    expect(staticPermissions).not.toContain("android.permission.READ_SMS");
    expect(staticPermissions).not.toContain("android.permission.RECEIVE_SMS");
  });

  it("declares MAIN/LAUNCHER package visibility so app labels can be resolved", async () => {
    // Without this, `PackageManager.getApplicationInfo` throws
    // NameNotFoundException for every third-party package on API 30+, and
    // `AppLabels.kt` resolves nothing -- the picker silently falls back to the
    // parser seed's stale brand names ("seabank" for an app now called
    // Maribank) with no error anywhere to explain why.
    const manifest = await applyPlugin(prebuiltManifest());

    expect(launcherQueries(manifest)).toHaveLength(1);
  });

  it("applying the plugin twice does not duplicate the queries entry", async () => {
    const manifest = await applyPlugin(prebuiltManifest(), 2);

    expect(launcherQueries(manifest)).toHaveLength(1);
  });

  it("never declares QUERY_ALL_PACKAGES", async () => {
    // POLICY GUARD -- DO NOT DELETE THIS TEST.
    // QUERY_ALL_PACKAGES is a Play-restricted permission requiring a
    // declaration form and a policy justification. The `<queries>` element
    // above buys everything this app needs from it: the ability to ask about
    // a launchable package by name. Reaching for the permission because a
    // lookup failed is the wrong fix and a review risk on a finance app.
    const manifest = await applyPlugin(prebuiltManifest(), 2);

    expect(permissionNames(manifest)).not.toContain(QUERY_ALL_PACKAGES);
    expect(JSON.stringify(manifest)).not.toContain("QUERY_ALL_PACKAGES");
    expect(readAppJson().expo.android.permissions).not.toContain(QUERY_ALL_PACKAGES);
  });

  it("leaves other libraries' services, permissions and queries untouched", async () => {
    const manifest = await applyPlugin(prebuiltManifest());

    // A plugin that assigns `application.service = [ours]` passes every test
    // above and deletes every other library's service on the way through.
    expect(
      services(manifest).map((service) => service.$?.["android:name"]),
    ).toEqual([THIRD_PARTY_SERVICE, LISTENER_SERVICE_CLASS]);
    expect(permissionNames(manifest)).toContain(PRE_EXISTING_PERMISSION);
    // Same failure mode one element over: `manifest.queries = [ours]` passes
    // the visibility test above and silently deletes another library's
    // `<queries>` entry, which breaks THEIR package lookups, not ours — the
    // kind of bug that surfaces as someone else's library misbehaving.
    expect(JSON.stringify(queries(manifest))).toContain(THIRD_PARTY_QUERY_PACKAGE);
    expect(queries(manifest)).toHaveLength(2);
  });

  it("names the Kotlin class that is actually shipped", async () => {
    // The plan's XML is a string in a markdown file; the class is real code.
    // A typo between the two prebuilds cleanly and never starts the service,
    // so the manifest name is checked against the source of truth.
    const source = readFileSync(SERVICE_KOTLIN, "utf8");
    const packageName = /^package\s+([\w.]+)/m.exec(source)?.[1];
    const className = /^class\s+(\w+)\s*:\s*NotificationListenerService\(\)/m.exec(
      source,
    )?.[1];

    expect(`${packageName}.${className}`).toBe(LISTENER_SERVICE_CLASS);

    const manifest = await applyPlugin(prebuiltManifest());
    expect(listenerServices(manifest)).toHaveLength(1);
  });

  it("disables Android Auto Backup, so nothing reaches Google Drive", () => {
    // GAP-093. Left at its default this is `true`, and Auto Backup then uploads
    // the app's shared_prefs.
    //
    // THE LEDGER AND THE SEALED BUFFER WERE ALREADY SPARED, which is not
    // obvious and is why this needs a test rather than a comment:
    // expo-secure-store's config plugin merges `secure_store_backup_rules` and
    // `secure_store_data_extraction_rules` into the manifest, and both read
    // `<include domain="sharedpref" path="."/>`. One `<include>` turns Android's
    // rules allowlist-only, so `files/` and `databases/` never travelled.
    //
    // WHAT DID TRAVEL WAS WORSE THAN CIPHERTEXT. CapturePrefs keeps three of its
    // six values unsealed, `capture_enabled` among them, beside a sealed
    // provider filter whose Keystore key does NOT travel. A restored install
    // therefore came back with capture ON and a filter `openSealed` cannot
    // open; it returns null, `getProviderFilter` maps that to an empty set, and
    // `shouldCapture` reads an empty filter as capture-everything. Silently,
    // for every app on the device.
    //
    // docs/07 says raw notification text "never leaves the phone under any
    // configuration". This attribute is what makes that sentence true.
    expect(readAppJson().expo.android.allowBackup).toBe(false);
  });

  it("keeps the updates system off, so nothing contacts Expo at launch", () => {
    // GAP-028. `expo-updates` is a dependency and `updates.url` is set, but
    // nothing in this app has ever called `Updates.*`. Left enabled with no
    // `checkAutomatically`, the library default has the client contact
    // u.expo.dev on EVERY launch, carrying runtime version, platform, channel
    // and an EAS client identifier.
    //
    // That is a network egress with a persistent id, and docs/07's lifecycle
    // table presents itself as the complete list of what leaves the device.
    // It is also a way for a JS-only change to alter what the listener reads
    // AFTER a Play policy review, which is exactly what docs/07 §3.1 rule 6's
    // re-declaration discipline exists to prevent.
    //
    // The url is deliberately left in place beside this flag: it is the EAS
    // project binding, it does nothing while the system is off, and deleting it
    // would only make re-enabling harder to do correctly.
    expect(readAppJson().expo.updates.enabled).toBe(false);
  });

  it("is registered in app.json alongside the existing plugins", () => {
    // An unregistered plugin transforms nothing: prebuild never calls it, the
    // app never appears on the Notification Access screen, and every unit test
    // above still passes.
    const plugins = readAppJson().expo.plugins;

    expect(plugins).toContain(PLUGIN_PATH);
    expect(plugins).toContain("expo-router");
    expect(plugins).toContain("expo-font");
    expect(plugins).toContain("expo-secure-store");
    expect(plugins).toContain("expo-local-authentication");
    expect(
      plugins.some(
        (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
      ),
    ).toBe(true);
  });
});
