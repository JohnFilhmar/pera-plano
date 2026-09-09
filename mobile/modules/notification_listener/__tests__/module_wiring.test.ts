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

const MODULE_KOTLIN = join(
  MODULE_ROOT,
  "android",
  "src",
  "main",
  "java",
  "expo",
  "modules",
  "notificationlistener",
  "NotificationListenerModule.kt",
);

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

/**
 * The source text between the braces of `AsyncFunction("<name>") { ... }`,
 * brace-matched so a body that grew braces of its own comes back whole
 * rather than truncated at the first inner `}`.
 */
function asyncFunctionBody(source: string, name: string): string {
  const opener = `AsyncFunction("${name}") {`;
  const start = source.indexOf(opener);
  if (start === -1) {
    throw new Error(`NotificationListenerModule.kt has no AsyncFunction("${name}")`);
  }

  let depth = 0;
  let index = start + opener.length - 1;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  return source.slice(start + opener.length, index);
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

  /**
   * The one claim about the Kotlin bridge that NO Kotlin test can make.
   *
   * An `AsyncFunction` body cannot be invoked without the JSI runtime, so
   * `NotificationListenerModuleTest` reaches `drainPendingCaptures` by
   * calling the top-level function the DSL block delegates to. That is only
   * honest coverage while the DSL block really is that one-line delegation:
   * the moment logic moves back inside the block -- which is where the error
   * mapping used to live, forcing the Kotlin test to re-type it into a copy
   * of its own -- the Kotlin tests go on passing against a function the
   * bridge no longer runs as written.
   *
   * Asserting on source text is deliberate and is what the file's own class
   * doc asks for ("Keep the DSL bodies one-liners so that stays the only
   * gap"). `app_plugin.test.ts` reads the listener service's Kotlin the same
   * way, for the same reason: some cross-language facts have no runtime this
   * suite can reach.
   */
  it("keeps the drainPendingCaptures bridge body a one-line delegation to its testable helper", () => {
    const source = readFileSync(MODULE_KOTLIN, "utf8");

    const body = asyncFunctionBody(source, "drainPendingCaptures")
      .replace(/\/\/[^\n]*/g, "")
      .trim();

    expect(body).toBe("drainPendingCaptures(requireContext())");

    // ...and the helper it names is a real top-level function, not a method
    // on the Module that the Kotlin suite could never have called.
    expect(source).toMatch(
      /^internal fun drainPendingCaptures\(context: Context\): List<Map<String, Any\?>> \{/m,
    );
  });

  /**
   * The other cross-language fact with no runtime here: ARITY.
   *
   * `index.ts` sends `setProviderFilter` two arguments -- the allowlist and
   * the deny-all flag an allowlist cannot express (GAP-103) -- and Expo
   * coerces positionally against the Kotlin lambda's parameters. A Kotlin
   * side still declaring one parameter would not fail to compile, would not
   * fail any Kotlin test, and would not fail the TypeScript build: it would
   * throw on a real device the first time a user touched a provider switch.
   * Kotlin is compiled in no worktree of this project, so this text assertion
   * is the only place the two halves are checked against each other at all.
   */
  it("declares setProviderFilter with BOTH parameters the JS wrapper sends", () => {
    const source = readFileSync(MODULE_KOTLIN, "utf8");

    expect(source).toContain(
      'AsyncFunction("setProviderFilter") { packageNames: List<String>, denyAll: Boolean ->',
    );
    // And the helper the block delegates to takes them in the same order --
    // two arguments of different types, so a swap is a compile error rather
    // than a silent inversion of the most restrictive control in the app.
    expect(source).toMatch(
      /^internal fun setProviderFilter\(\r?\n\s*context: Context,\r?\n\s*packageNames: List<String>,\r?\n\s*denyAll: Boolean = false,\r?\n\) \{/m,
    );
  });
});
