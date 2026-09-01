// app/(tabs)/more/ai/models.tsx — on-device-ai Task 22. Route: /more/ai/models.
//
// NESTED UNDER app/(tabs)/more/, matching app/(tabs)/more/reports.tsx and
// app/(tabs)/more/parser_diagnostics.tsx — NOT a sibling app/more/ tree, which
// would collide on the same /more/* URL space (that mistake has landed five
// times already; see reports.tsx's own header).
//
// THE PRODUCTION CALL SITE for three injected seams, and the only file that
// knows what they are made of:
//
//   RAM — `() => Device.totalMemory ?? 0`, the single call `expo-device` was
//   added for. The `?? 0` is the fail-closed half of spec §2.2: `totalMemory`
//   is nullable, and failing OPEN would offer a 2 GB phone a model that cannot
//   load and a crash that looks like a bug in the app rather than a phone that
//   was never eligible.
//
//   THE NETWORK IS ASSUMED METERED. `package.json` still has no reachability
//   package, so this app cannot yet tell WiFi from mobile data. The seam fails
//   closed, the same direction as the RAM gate: an unknown network is treated
//   as metered, so the user is always asked the size question rather than
//   having a prepaid load spent on a guess. `METERED_NOTE` says so in the
//   dialog rather than letting the copy assert a network fact it does not know.
//
//   THE BYTE TRANSFER IS NOT WIRED, AND SAYS SO OUT LOUD. `createDownloader`
//   streams a response body into an appendable file, and neither half exists
//   in this app's dependencies today: React Native's `fetch` does not expose a
//   streaming body, and `expo-file-system/legacy` — this repo's file API — has
//   no append and no positional write. Both are therefore explicit throws
//   rather than silent no-ops, because a no-op `append` would let an EMPTY
//   file reach verification, and the digest mismatch would be reported as a
//   corrupt download of a file that was never fetched. Everything the legacy
//   API genuinely supports (state, size, delete, the atomic rename, free
//   space) is implemented, so the screen shows the real disk. The transfer
//   itself lands with the streaming pair (`expo/fetch` plus a writable file
//   handle) or in `llama_bridge` — one dependency decision, not a UI change.
//
// DELETE IS MIRRORED IN More → Settings → Privacy (Task 25). Two entry points,
// one behaviour: "downloading gigabytes with no visible way to reclaim them is
// the kind of thing that gets a finance app uninstalled" (spec §2.3).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { ModelPicker } from "@/components/ai/model_picker";
import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import type { ModelSpec } from "@/lib/ai/catalogue";
import { createDownloader } from "@/lib/ai/downloader";
import type { DownloadState, DownloaderDeps } from "@/lib/ai/downloader";
import { createProductionDeps, readDeviceTotalRam } from "@/lib/ai/model_files";
import type { RamReader } from "@/lib/ai/ram_gate";

// RE-EXPORTED, NOT DEFINED HERE. These moved to `lib/ai/model_files.ts` once
// the Privacy centre needed the same adapter (assistant plan Task 25); a route
// file importing another route file is the wrong direction for a shared piece.
// The re-export keeps every caller that already had them working.
export {
  MODELS_DIR,
  UnstreamableTransferError,
  createLegacyFileStore,
  createProductionDeps,
  readDeviceTotalRam,
} from "@/lib/ai/model_files";

/** Shown beside the size question, because this app cannot yet see the network type. */
const METERED_NOTE = "PeraPlano cannot tell WiFi from mobile data yet, so it asks every time.";


export type AiModelsScreenProps = {
  /** Injected by tests. The route renders with none and builds the real thing. */
  deps?: DownloaderDeps;
  readTotalRam?: RamReader;
};

export default function AiModelsScreen({ deps, readTotalRam }: AiModelsScreenProps = {}) {
  const downloaderDeps = useMemo(() => deps ?? createProductionDeps(), [deps]);
  const downloader = useMemo(() => createDownloader(downloaderDeps), [downloaderDeps]);

  const [states, setStates] = useState<Record<string, DownloadState>>({});
  const [progress, setProgress] = useState<Record<string, { received: number; total: number }>>({});

  // Read from DISK on every settle, never remembered: the `.part` that decides
  // "resumable" survives a process kill, and a state cached in memory would
  // not (spec §2.3, "Resume").
  const refresh = useCallback(async () => {
    const next: Record<string, DownloadState> = {};
    for (const spec of MODEL_CATALOGUE) {
      next[spec.id] = await downloader.stateOf(spec);
    }
    setStates(next);
  }, [downloader]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(
    async (spec: ModelSpec, allowMetered: boolean) => {
      try {
        await downloader.download(spec, {
          allowMetered,
          onProgress: (received, total) =>
            setProgress((current) => ({ ...current, [spec.id]: { received, total } })),
        });
      } finally {
        // Runs on the refusals too — a metered or free-space refusal leaves a
        // `.part` exactly as it was, and the card must keep saying so.
        await refresh();
      }
    },
    [downloader, refresh],
  );

  const handleDelete = useCallback(
    async (spec: ModelSpec) => {
      await downloader.remove(spec);
      setProgress((current) => {
        const next = { ...current };
        delete next[spec.id];
        return next;
      });
      await refresh();
    },
    [downloader, refresh],
  );

  return (
    <ScrollView
      testID="ai-models-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <View>
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Assistant model</Text>
        {/* Spec §2.4, said plainly rather than glossed: no user data leaves the
            phone, but the download itself reveals this device's IP address and
            the chosen model to whoever hosts the weights. */}
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
          The assistant runs entirely on this phone. Downloading a model is a one-time transfer from
          the model's public host, which sees this phone's IP address and which model you chose —
          nothing about your money, ever.
        </Text>
      </View>

      <ModelPicker
        readTotalRam={readTotalRam ?? readDeviceTotalRam}
        states={states}
        progress={progress}
        onDownload={handleDownload}
        onDelete={handleDelete}
        meteredNote={METERED_NOTE}
      />

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
