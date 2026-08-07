import { readFileSync } from "fs";
import { join } from "path";

type ExpoModuleConfig = {
  platforms: string[];
  android: { modules: string[] };
};

type AppPackageJson = {
  expo?: { autolinking?: { nativeModulesDir?: string } };
};

const MODULE_ROOT = join(__dirname, "..");

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

describe("notification_listener local module wiring", () => {
  it("declares an android-only Expo module and registers the Kotlin module class", () => {
    const config = readJson<ExpoModuleConfig>(join(MODULE_ROOT, "expo-module.config.json"));
    expect(config.platforms).toEqual(["android"]);
    expect(config.android.modules).toEqual([
      "expo.modules.notificationlistener.NotificationListenerModule",
    ]);
  });

  it("tells expo autolinking to scan the local modules directory", () => {
    const pkg = readJson<AppPackageJson>(join(MODULE_ROOT, "..", "..", "package.json"));
    expect(pkg.expo?.autolinking?.nativeModulesDir).toBe("./modules");
  });

  it("names the android gradle library after the snake_case module directory", () => {
    const gradle = readFileSync(join(MODULE_ROOT, "android", "build.gradle"), "utf8");
    expect(gradle).toContain('namespace "expo.modules.notificationlistener"');
    expect(gradle).toContain("applyKotlinExpoModulesCorePlugin()");
    expect(gradle).toContain("useCoreDependencies()");
  });
});
