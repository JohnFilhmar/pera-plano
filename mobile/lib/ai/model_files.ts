// mobile/lib/ai/model_files.ts
//
// THE PRODUCTION SIDE OF `downloader.ts`: where the weights actually live on
// this phone, and the adapters that reach them. The `expo-file-system/legacy`
// store below does everything but the byte transfer, which lives in
// `model_transfer.ts`, and the digest, which is Kotlin in `modules/llama_bridge/`.
//
// WHY IT IS HERE RATHER THAN IN THE MODELS SCREEN, where plan Task 22 first
// wrote it. Two screens need it now — More → Assistant → Models offers the
// download, and More → Privacy mirrors the delete (spec §2.3: "downloading
// gigabytes with no visible way to reclaim them is the kind of thing that
// gets a finance app uninstalled"). A route file importing another route file
// is the wrong direction for that shared piece, so it lives in `lib/` and
// `app/(tabs)/more/ai/models.tsx` re-exports it for the callers that already
// had it.
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";

import { sha256File } from "@/modules/llama_bridge/digest";

import { MODEL_CATALOGUE } from "./catalogue";
import type { ModelSpec } from "./catalogue";
import { createDownloader } from "./downloader";
import type { DownloaderDeps, FileStore } from "./downloader";
import { appendBytes, streamingFetch } from "./model_transfer";
import type { RamReader } from "./ram_gate";

/**
 * Spec §2.3 rule 4: public weights, unencrypted, OUTSIDE the SQLCipher
 * database. A gigabyte inside the encrypted store would cost enormously in
 * write amplification and protect nothing, since anyone can fetch the same
 * file from Hugging Face.
 *
 * This is also the directory `modules/llama_bridge/app.plugin.js` excludes
 * from Android backup. The two must stay in step: the plugin excludes
 * `domain="file" path="models/"`, which is this path relative to the app's
 * own `files/` directory.
 */
export const MODELS_DIR = `${FileSystem.documentDirectory ?? ""}models/`;

/** The capability neither `expo-file-system/legacy` nor RN's `fetch` provides. */
export class UnstreamableTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnstreamableTransferError";
  }
}

/**
 * A file store on `expo-file-system/legacy`: state, size, delete, the atomic
 * rename and free space. `append` and `sha256` throw, because the legacy
 * API has neither; `createProductionDeps` replaces those two.
 *
 * @returns A store whose paths are `file://` URIs.
 */
export function createLegacyFileStore(): FileStore {
  return {
    ensureDir: async (path) => {
      await FileSystem.makeDirectoryAsync(path, { intermediates: true });
    },
    exists: async (path) => (await FileSystem.getInfoAsync(path)).exists,
    size: async (path) => {
      const info = await FileSystem.getInfoAsync(path);
      return info.exists ? info.size : 0;
    },
    append: async () => {
      // THROWS RATHER THAN NO-OPS. A silent no-op would let an empty file
      // reach verification and report a digest mismatch for a file that was
      // never fetched, which sends whoever debugs it hunting a corrupt
      // download that does not exist.
      throw new UnstreamableTransferError(
        "expo-file-system/legacy cannot append to a file; the model transfer needs a writable file handle",
      );
    },
    sha256: async () => {
      throw new UnstreamableTransferError(
        "expo-file-system/legacy cannot hash a file without reading all of it into JS; the digest is native",
      );
    },
    remove: async (path) => {
      await FileSystem.deleteAsync(path, { idempotent: true });
    },
    /** The atomic activation step of spec §2.3 rule 1. */
    rename: async (from, to) => {
      await FileSystem.moveAsync({ from, to });
    },
    freeSpace: () => FileSystem.getFreeDiskStorageAsync(),
  };
}

/**
 * The downloader's dependencies as this phone provides them.
 *
 * @returns `expo/fetch` for the transfer, the legacy store with the File API's
 *   append and the native digest in place of the two it lacks, the models
 *   directory, and a metered-network check that always says yes.
 */
export function createProductionDeps(): DownloaderDeps {
  return {
    fetch: streamingFetch,
    files: { ...createLegacyFileStore(), append: appendBytes, sha256: sha256File },
    modelsDir: MODELS_DIR,
    /**
     * FAILS CLOSED. No reachability package exists in this app, and guessing
     * "WiFi" spends a prepaid load unasked. An unknown network is treated as
     * metered, the same direction the RAM gate errs in.
     */
    isMetered: async () => true,
  };
}

export const readDeviceTotalRam: RamReader = () => Device.totalMemory ?? 0;

export type InstalledModel = {
  spec: ModelSpec;
  /** Bytes ON DISK, read from the file, never `spec.bytes`. */
  bytes: number;
};

/**
 * The models this phone actually holds, with what deleting each would reclaim.
 *
 * VERIFIED FILES ONLY. `loadCandidatePath` never returns a `.part`, so a
 * half-finished download is not listed here and cannot be presented to the
 * user as reclaimable space under a name that implies a working model.
 *
 * The size is read from the file rather than taken from `spec.bytes`, because
 * the catalogue figure is what the download SHOULD be. Offering to reclaim a
 * number the disk does not agree with is how a "frees 1.06 GB" button frees
 * something else.
 */
export async function installedModels(
  deps: DownloaderDeps = createProductionDeps(),
  catalogue: readonly ModelSpec[] = MODEL_CATALOGUE,
): Promise<InstalledModel[]> {
  const downloader = createDownloader(deps);
  const found: InstalledModel[] = [];

  for (const spec of catalogue) {
    const path = await downloader.loadCandidatePath(spec);
    if (path === null) continue;
    found.push({ spec, bytes: await deps.files.size(path) });
  }

  return found;
}

/** Removes both `<id>.gguf` and any `<id>.gguf.part` left beside it. */
export async function removeInstalledModel(
  spec: ModelSpec,
  deps: DownloaderDeps = createProductionDeps(),
): Promise<void> {
  await createDownloader(deps).remove(spec);
}
