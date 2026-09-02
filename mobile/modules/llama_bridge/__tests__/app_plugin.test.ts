// mobile/modules/llama_bridge/__tests__/app_plugin.test.ts
//
// Plan Task 12 — the plugin is the load-bearing half, which is why it is
// tested first.
//
// WHY A PLUGIN AND NOT A COMMITTED MANIFEST: `mobile/android/` is produced by
// `expo prebuild` / EAS Build and is gitignored (CNG), so anything hand-written
// there is destroyed by the next prebuild. The backup exclusion and the ABI
// filter are the two things this dependency needs from the Android build, and
// the plugin is the only place either can live and survive.
//
// THE EXCLUDED PATH IS RE-DERIVED FROM THE PLUGIN'S OWN EXPORTED CONSTANT,
// never retyped here — a typo in a backup path produces a plugin that prebuilds
// cleanly, builds cleanly, and excludes nothing.
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type {
  AndroidManifest,
  ExportedConfig,
  ExportedConfigWithProps,
} from "expo/config-plugins";

import withLlamaBridge, {
  ANDROID_ABI,
  ARCHITECTURES_PROPERTY,
  BACKUP_EXCLUDE_DOMAIN,
  BACKUP_EXCLUDE_PATH,
  BACKUP_RULES_RESOURCE,
  DATA_EXTRACTION_RULES_RESOURCE,
  SECURE_STORE_PREF,
  SHAREDPREF_DOMAIN,
  XML_RESOURCE_DIR,
} from "../app.plugin.js";

/**
 * Read straight out of `expo-secure-store`'s own shipped resource, so this
 * suite fails if that library ever changes what it excludes. Retyping it would
 * leave us pinning a rule the dependency no longer uses.
 */
const SECURE_STORE_RULES = join(
  __dirname,
  "..",
  "..",
  "..",
  "node_modules",
  "expo-secure-store",
  "android",
  "src",
  "main",
  "res",
  "xml",
  "secure_store_backup_rules.xml",
);

const MODULE_ROOT = join(__dirname, "..");
const APP_JSON = join(MODULE_ROOT, "..", "..", "app.json");
const PLUGIN_PATH = "./modules/llama_bridge/app.plugin.js";

const THIRD_PARTY_PROPERTY = "org.gradle.jvmargs";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

function prebuiltManifest(): AndroidManifest {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      queries: [],
      application: [
        {
          $: {
            "android:name": ".MainApplication",
            "android:label": "PeraPlano",
            // Left in place so the tests catch a plugin that assigns over the
            // attribute bag instead of adding to it.
            "android:allowBackup": "true",
          },
          activity: [{ $: { "android:name": ".MainActivity" } }],
        },
      ],
    },
  };
}

function applied(times = 1): ExportedConfig {
  let config = { name: "PeraPlano", slug: "pera-plano" } as ExportedConfig;
  for (let index = 0; index < times; index += 1) {
    config = withLlamaBridge(config) as ExportedConfig;
  }
  return config;
}

/**
 * Applies the plugin `times` times, then runs the resulting manifest mod once.
 *
 * Applying twice is the realistic double-registration case: `withAndroidManifest`
 * chains mods, so the transform genuinely runs twice over the same object.
 */
async function applyManifestMod(times = 1): Promise<AndroidManifest> {
  const config = applied(times);
  const mod = config.mods?.android?.manifest;
  if (!mod) throw new Error("the plugin registered no android manifest mod");

  const result = await mod({
    ...config,
    modResults: prebuiltManifest(),
    modRequest: {},
  } as unknown as ExportedConfigWithProps<AndroidManifest>);

  return result.modResults;
}

type GradleProperty = { type: string; key?: string; value?: string };

async function applyGradlePropertiesMod(
  existing: GradleProperty[],
  times = 1,
): Promise<GradleProperty[]> {
  const config = applied(times);
  const mod = config.mods?.android?.gradleProperties;
  if (!mod) throw new Error("the plugin registered no gradle properties mod");

  // Typed off the mod itself rather than restated: `gradleProperties` works in
  // expo's own `PropertiesItem`, and a hand-written stand-in for it would drift
  // the first time expo changes the shape.
  const result = await mod({
    ...config,
    modResults: existing,
    modRequest: {},
  } as unknown as Parameters<typeof mod>[0]);

  return result.modResults as GradleProperty[];
}

/**
 * Runs the dangerous mod against a throwaway project root and reads back what
 * it wrote. Asserting only that a mod was REGISTERED would pass for a plugin
 * that writes its files to the wrong path.
 */
async function writeResourceFiles(): Promise<{ root: string; read: (name: string) => string }> {
  const root = mkdtempSync(join(tmpdir(), "llama-bridge-plugin-"));
  const config = applied();
  const mod = config.mods?.android?.dangerous;
  if (!mod) throw new Error("the plugin registered no android dangerous mod");

  await mod({
    ...config,
    modResults: {},
    modRequest: { platformProjectRoot: root },
  } as unknown as ExportedConfigWithProps<unknown>);

  return {
    root,
    read: (name: string) => readFileSync(join(root, ...XML_RESOURCE_DIR, name), "utf8"),
  };
}

function mainApplication(manifest: AndroidManifest) {
  return manifest.manifest.application?.[0];
}

function readAppJson(): { expo: { plugins: unknown[] } } {
  return JSON.parse(readFileSync(APP_JSON, "utf8"));
}

// ---------------------------------------------------------------------------

describe("llama_bridge config plugin — the backup exclusion", () => {
  it("points the manifest at both backup rule resources", async () => {
    const manifest = await applyManifestMod();

    // BOTH, not one. `android:dataExtractionRules` is API 31+ and
    // `android:fullBackupContent` is what every device below it reads; shipping
    // only the newer one leaves older phones backing up gigabytes of weights.
    expect(mainApplication(manifest)?.$["android:dataExtractionRules"]).toBe(
      `@xml/${DATA_EXTRACTION_RULES_RESOURCE}`,
    );
    expect(mainApplication(manifest)?.$["android:fullBackupContent"]).toBe(
      `@xml/${BACKUP_RULES_RESOURCE}`,
    );
  });

  it("adds to the application attributes rather than replacing them", async () => {
    const manifest = await applyManifestMod();

    expect(mainApplication(manifest)?.$["android:name"]).toBe(".MainApplication");
    expect(mainApplication(manifest)?.$["android:label"]).toBe("PeraPlano");
    expect(mainApplication(manifest)?.$["android:allowBackup"]).toBe("true");
  });

  it("is idempotent when applied twice", async () => {
    const once = await applyManifestMod(1);
    const twice = await applyManifestMod(2);

    expect(twice).toEqual(once);
  });

  it("writes a full-backup rule that excludes the models directory", async () => {
    const { root, read } = await writeResourceFiles();
    try {
      const xml = read(`${BACKUP_RULES_RESOURCE}.xml`);

      expect(xml).toContain("<full-backup-content>");
      expect(xml).toContain(
        `<exclude domain="${BACKUP_EXCLUDE_DOMAIN}" path="${BACKUP_EXCLUDE_PATH}" />`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a data-extraction rule that excludes the models directory from BOTH cloud backup and device transfer", async () => {
    const { root, read } = await writeResourceFiles();
    try {
      const xml = read(`${DATA_EXTRACTION_RULES_RESOURCE}.xml`);
      const exclusion = `<exclude domain="${BACKUP_EXCLUDE_DOMAIN}" path="${BACKUP_EXCLUDE_PATH}" />`;

      // Two sections, and both are required. `device-transfer` is the
      // phone-to-phone copy; excluding only the cloud path still moves 3.3 GB
      // of public weights across a cable during a device migration.
      const cloud = xml.slice(xml.indexOf("<cloud-backup>"), xml.indexOf("</cloud-backup>"));
      const transfer = xml.slice(xml.indexOf("<device-transfer>"), xml.indexOf("</device-transfer>"));

      expect(cloud).toContain(exclusion);
      expect(transfer).toContain(exclusion);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries expo-secure-store's exclusion, because claiming the attributes took its rules away", async () => {
    // `expo-secure-store` applies its own rules ONLY while the manifest
    // attributes are unset or already point at its resources. This plugin
    // claims them, so that library backs off with a warning at prebuild and its
    // exclusion is simply gone. An app can name one backup resource, so ours
    // has to carry it — and what it protects is the shared-preferences file
    // holding this app's wrapped key material.
    const { root, read } = await writeResourceFiles();
    try {
      const exclusion = `<exclude domain="${SHAREDPREF_DOMAIN}" path="${SECURE_STORE_PREF}" />`;
      const extraction = read(`${DATA_EXTRACTION_RULES_RESOURCE}.xml`);

      expect(read(`${BACKUP_RULES_RESOURCE}.xml`)).toContain(exclusion);
      expect(
        extraction.slice(extraction.indexOf("<cloud-backup>"), extraction.indexOf("</cloud-backup>")),
      ).toContain(exclusion);
      expect(
        extraction.slice(
          extraction.indexOf("<device-transfer>"),
          extraction.indexOf("</device-transfer>"),
        ),
      ).toContain(exclusion);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still excludes what expo-secure-store's own shipped resource excludes", () => {
    // Re-derived from the dependency rather than retyped. If a future
    // expo-secure-store starts excluding something else, this fails instead of
    // leaving the app quietly backing it up.
    const theirs = readFileSync(SECURE_STORE_RULES, "utf8");

    expect(theirs).toContain(`domain="${SHAREDPREF_DOMAIN}"`);
    expect(theirs).toContain(`path="${SECURE_STORE_PREF}"`);
    // Their file excludes exactly one thing. A second exclusion appearing there
    // is a signal to widen ours, not to update this number and move on.
    expect(theirs.match(/<exclude /g) ?? []).toHaveLength(1);
  });

  it("keeps the sharedpref include, which is what holds everything else out of backup", async () => {
    // NOT REDUNDANT, and the most dangerous line in the file to "tidy up".
    // Under Android's full-backup semantics the presence of any `<include>`
    // flips the rules from "back up everything except..." to "back up ONLY
    // these". This one line is therefore what keeps the SQLCipher database, the
    // capture buffer and the whole of `files/` out of a Google backup. Remove
    // it and the app silently opts its entire data directory back in — while
    // every `<exclude>` assertion above still passes.
    const { root, read } = await writeResourceFiles();
    try {
      const include = `<include domain="${SHAREDPREF_DOMAIN}" path="." />`;

      expect(read(`${BACKUP_RULES_RESOURCE}.xml`)).toContain(include);
      expect(read(`${DATA_EXTRACTION_RULES_RESOURCE}.xml`)).toContain(include);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes the directory the downloader actually writes to", () => {
    // The exclusion is a path under the app's `files/` dir, which is what
    // `domain="file"` means. A leading slash or a `files/` prefix here would be
    // a path Android never matches, and the exclusion would silently do nothing.
    expect(BACKUP_EXCLUDE_DOMAIN).toBe("file");
    expect(BACKUP_EXCLUDE_PATH).toBe("models/");
  });
});

describe("llama_bridge config plugin — the ABI filter", () => {
  it("pins the react native architectures to arm64 only", async () => {
    const properties = await applyGradlePropertiesMod([]);

    expect(properties).toContainEqual({
      type: "property",
      key: ARCHITECTURES_PROPERTY,
      value: ANDROID_ABI,
    });
    expect(ANDROID_ABI).toBe("arm64-v8a");
  });

  it("replaces a pre-existing architectures value instead of appending a second one", async () => {
    const properties = await applyGradlePropertiesMod([
      { type: "property", key: THIRD_PARTY_PROPERTY, value: "-Xmx4g" },
      {
        type: "property",
        key: ARCHITECTURES_PROPERTY,
        value: "armeabi-v7a,arm64-v8a,x86,x86_64",
      },
    ]);

    const architectures = properties.filter((entry) => entry.key === ARCHITECTURES_PROPERTY);
    // A duplicate key in gradle.properties resolves to the LAST one, so an
    // appended second entry would work by luck and break the day the order
    // changes.
    expect(architectures).toEqual([
      { type: "property", key: ARCHITECTURES_PROPERTY, value: ANDROID_ABI },
    ]);
    expect(properties).toContainEqual({
      type: "property",
      key: THIRD_PARTY_PROPERTY,
      value: "-Xmx4g",
    });
  });

  it("is idempotent when applied twice", async () => {
    const once = await applyGradlePropertiesMod([], 1);
    const twice = await applyGradlePropertiesMod([], 2);

    expect(twice).toEqual(once);
  });
});

describe("llama_bridge config plugin — registration", () => {
  it("is listed in app.json", () => {
    // `llama_bridge` has no `expo-module.config.json`, so autolinking does not
    // pick it up. A plugin that is written and never registered runs never,
    // silently, and the backup exclusion simply does not happen.
    expect(readAppJson().expo.plugins).toContain(PLUGIN_PATH);
  });
});
