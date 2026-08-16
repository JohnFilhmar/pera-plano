import { readFileSync } from "fs";
import { join } from "path";

import { AndroidConfig } from "expo/config-plugins";
import type {
  AndroidManifest,
  ExportedConfig,
  ExportedConfigWithProps,
} from "expo/config-plugins";

/**
 * Verifies `android.blockedPermissions` in `app.json` actually reaches the
 * mechanism Expo uses to strip library-injected permissions from the merged
 * manifest.
 *
 * BACKGROUND: `docs/13-on-device-verification.md` records that three
 * permissions show up in the generated manifest despite this app never
 * declaring or using them -- `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`
 * and `SYSTEM_ALERT_WINDOW` -- injected by some dependency's own
 * `AndroidManifest.xml`. All three draw Play review scrutiny on a finance
 * app; `SYSTEM_ALERT_WINDOW` (draw-over-other-apps) in particular is the
 * signature permission of overlay-based credential stealers.
 * `android.blockedPermissions` is Expo's supported way to suppress a
 * permission no matter which library requested it.
 *
 * WHAT THIS TEST CAN AND CANNOT PROVE:
 *
 * `android.blockedPermissions` is not a plugin registered under
 * `expo.plugins` -- unlike `./app.plugin.js` (tested in
 * `app_plugin.test.ts`), nothing in this repo calls it directly. It is
 * consumed automatically by `@expo/prebuild-config`'s
 * `withAndroidExpoPlugins`, which unconditionally runs
 * `AndroidConfig.Permissions.withInternalBlockedPermissions` on every
 * project's config as one of the base Android mods, before the app's own
 * `plugins` list even applies. This was confirmed by reading
 * `node_modules/@expo/prebuild-config/build/plugins/withDefaultPlugins.js`
 * at the version this project has installed:
 *
 *   AndroidConfig.Permissions.withInternalBlockedPermissions,
 *   AndroidConfig.Permissions.withPermissions,
 *
 * `withInternalBlockedPermissions` reads `config.android.blockedPermissions`
 * and, if non-empty, hands it to `withBlockedPermissions`, which tags the
 * matching `<uses-permission>` element with `tools:node="remove"`. That tag
 * is an instruction to the Android Gradle Plugin's manifest merger -- the
 * thing that actually deletes a permission some library's AAR manifest
 * declared, since that merge happens across every dependency's manifest,
 * not just this app's own.
 *
 * This test calls the real, installed `withInternalBlockedPermissions` --
 * the exact function `@expo/prebuild-config` calls, not a reimplementation
 * of it -- against a fixture manifest standing in for one after library
 * manifests have already been merged in (i.e. it already carries the three
 * permissions, the way the real merged manifest does today per the docs
 * note), and asserts the three come out tagged for removal while an
 * unrelated permission does not.
 *
 * It CANNOT prove the permissions are actually absent from a real built
 * APK. `tools:node="remove"` is only obeyed by the Android Gradle Plugin's
 * manifest merger, which runs during a native Gradle build (`expo prebuild`
 * followed by `./gradlew` or an EAS build) -- a process this Jest test does
 * not invoke and was explicitly told not to invoke (`expo prebuild` writes
 * `mobile/android/`, which must never be committed). Confirming removal
 * from the final merged manifest still requires either a real prebuild +
 * Gradle build with the merged manifest inspected under
 * `android/app/build/intermediates/merged_manifest` (variant subfolder,
 * then `AndroidManifest.xml`), or `aapt dump permissions` against a built
 * APK.
 */

const APP_JSON = join(__dirname, "..", "..", "..", "app.json");

const BLOCKED_PERMISSIONS = [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
];

/** A permission that must survive -- present so a plugin that blocks
 * everything, not just the listed ones, gets caught. */
const UNRELATED_PERMISSION = "android.permission.INTERNET";

function readAppJson(): {
  expo: { android: { blockedPermissions?: string[] } };
} {
  return JSON.parse(readFileSync(APP_JSON, "utf8"));
}

/**
 * Stands in for the manifest *after* every library's own `AndroidManifest.xml`
 * has already been merged in by the Android Gradle Plugin -- i.e. it already
 * carries the three library-injected permissions this app is trying to
 * strip, plus one unrelated permission that must come through untouched.
 */
function mergedManifestFixture(): AndroidManifest {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      "uses-permission": [
        { $: { "android:name": UNRELATED_PERMISSION } },
        ...BLOCKED_PERMISSIONS.map((name) => ({ $: { "android:name": name } })),
      ],
      queries: [],
      application: [{ $: { "android:name": ".MainApplication" } }],
    },
  };
}

function permissionEntry(manifest: AndroidManifest, name: string) {
  return (manifest.manifest["uses-permission"] ?? []).find(
    (permission) => permission.$["android:name"] === name,
  );
}

describe("android.blockedPermissions", () => {
  it("lists the three library-injected permissions that draw Play review scrutiny", () => {
    const blocked = readAppJson().expo.android.blockedPermissions ?? [];

    expect(blocked).toEqual(expect.arrayContaining(BLOCKED_PERMISSIONS));
  });

  it("reaches the real Expo mechanism that tags permissions for removal from the merged manifest", async () => {
    const blocked = readAppJson().expo.android.blockedPermissions ?? [];

    // Same shape and cast pattern as `applyPlugin` in `app_plugin.test.ts`,
    // applied to Expo's own base plugin instead of this app's custom one.
    let config = {
      name: "PeraPlano",
      slug: "pera-plano",
      android: { blockedPermissions: blocked },
    } as ExportedConfig;

    config = AndroidConfig.Permissions.withInternalBlockedPermissions(
      config,
    ) as ExportedConfig;

    const mod = config.mods?.android?.manifest;
    if (!mod) {
      throw new Error(
        "withInternalBlockedPermissions registered no android manifest mod " +
          "-- is app.json's android.blockedPermissions empty?",
      );
    }

    const result = await mod({
      ...config,
      modResults: mergedManifestFixture(),
      modRequest: {},
    } as unknown as ExportedConfigWithProps<AndroidManifest>);

    for (const name of BLOCKED_PERMISSIONS) {
      const entry = permissionEntry(result.modResults, name);
      // This is what the Android Gradle Plugin's manifest merger reads to
      // decide whether to delete the permission a library injected -- not a
      // stand-in this test invented.
      expect(entry?.$["tools:node"]).toBe("remove");
    }

    // A plugin that tags every permission for removal, not just the listed
    // ones, would pass the loop above too.
    const unrelated = permissionEntry(result.modResults, UNRELATED_PERMISSION);
    expect(unrelated?.$["tools:node"]).toBeUndefined();
  });
});
