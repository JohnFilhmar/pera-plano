// mobile/modules/llama_bridge/__tests__/digest.test.ts
//
// Jest has no native modules, so these tests pin what can break without one.
// Loading the wrapper must not need the module, and the names it calls must be
// the names the Kotlin declares. A mismatch in those names compiles, passes
// every other suite, and fails on a phone only after a whole model downloads.
import { readFileSync } from "fs";
import { join } from "path";

import { sha256File } from "../digest";

/** The object `digest.ts` resolves `requireNativeModule` on, so a spy here is one it sees. */
const expoModulesCore: typeof import("expo-modules-core") = require("expo-modules-core");

const MODULE_ROOT = join(__dirname, "..");
const KOTLIN_MODULE = join(
  MODULE_ROOT,
  "android",
  "src",
  "main",
  "java",
  "expo",
  "modules",
  "llamabridge",
  "LlamaBridgeModule.kt",
);
const PART_URI = "file:///data/user/0/com.filldev.peraplano/files/models/test-tier.gguf.part";
const DIGEST = "ab".repeat(32);

afterEach(() => {
  jest.restoreAllMocks();
});

test("loads where no native module exists, and a call rejects rather than throwing", async () => {
  await expect(sha256File(PART_URI)).rejects.toThrow("Cannot find native module 'LlamaBridge'");
});

test("asks the LlamaBridge module's sha256File for the digest of the URI it was given", async () => {
  const native = { sha256File: jest.fn(async () => DIGEST) };
  const lookup = jest.spyOn(expoModulesCore, "requireNativeModule").mockReturnValue(native);

  await expect(sha256File(PART_URI)).resolves.toBe(DIGEST);
  expect(lookup).toHaveBeenCalledWith("LlamaBridge");
  expect(native.sha256File).toHaveBeenCalledWith(PART_URI);
});

test("the Kotlin module is autolinked under the name, function and argument this wrapper sends", () => {
  const config: { platforms: string[]; android: { modules: string[] } } = JSON.parse(
    readFileSync(join(MODULE_ROOT, "expo-module.config.json"), "utf8"),
  );
  const kotlin = readFileSync(KOTLIN_MODULE, "utf8");

  expect(config.platforms).toEqual(["android"]);
  expect(config.android.modules).toEqual(["expo.modules.llamabridge.LlamaBridgeModule"]);
  expect(kotlin).toContain("class LlamaBridgeModule : Module()");
  expect(kotlin).toContain('Name("LlamaBridge")');
  expect(kotlin).toContain('AsyncFunction("sha256File") Coroutine { uri: String ->');
});
