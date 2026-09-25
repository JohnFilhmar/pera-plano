// mobile/modules/llama_bridge/digest.ts
//
// The JS side of `LlamaBridgeModule.kt`, kept apart from `index.ts` so that
// the model downloader can hash a file without importing `llama.rn`.
//
// THE NATIVE MODULE IS LOOKED UP ON EACH CALL, NOT AT LOAD. Jest has no native
// modules, and a lookup at load would crash every suite that imports
// `lib/ai/model_files.ts`, most of which never hash anything.
import { requireNativeModule } from "expo-modules-core";

/** What `LlamaBridgeModule.kt` declares. Its `AsyncFunction` is a `Promise` here. */
type NativeLlamaBridge = {
  sha256File(uri: string): Promise<string>;
};

/**
 * Hashes a file on this phone in Kotlin, so none of its bytes pass through JS.
 *
 * @param uri - A `file://` URI, as the model downloader builds them.
 * @returns The SHA-256 of the file's bytes on disk, as 64 lowercase hex characters.
 * @throws When there is no file at `uri`, or when this build has no native
 *   `LlamaBridge` module: under Jest, or in an APK built before the module had Kotlin.
 */
export async function sha256File(uri: string): Promise<string> {
  return requireNativeModule<NativeLlamaBridge>("LlamaBridge").sha256File(uri);
}
