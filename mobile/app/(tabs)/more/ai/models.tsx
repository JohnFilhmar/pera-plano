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
//   THE BYTE TRANSFER STREAMS. `createProductionDeps` reads the response body
//   through `expo/fetch` as it arrives and appends it with the SDK 54 `File`
//   API (`lib/ai/model_transfer.ts`); the legacy store covers state, size,
//   delete, the atomic rename and free space. `useModelDownload` holds each
//   transfer in this screen's state while it runs, because the disk says
//   nothing until the final rename: the card shows bytes as they land, then
//   the checksum step, and the disk is read again once `download()` settles.
//
// DELETE IS MIRRORED IN More → Settings → Privacy (Task 25). Two entry points,
// one behaviour: "downloading gigabytes with no visible way to reclaim them is
// the kind of thing that gets a finance app uninstalled" (spec §2.3).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { ModelPicker } from "@/components/ai/model_picker";
import { useModelDownload } from "@/hooks/use_model_download";
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

  const { transfers, download: handleDownload } = useModelDownload(downloader, refresh);

  const handleDelete = useCallback(
    async (spec: ModelSpec) => {
      await downloader.remove(spec);
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
        progress={transfers}
        onDownload={handleDownload}
        onDelete={handleDelete}
        meteredNote={METERED_NOTE}
      />

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
