// hooks/use_model_download.ts
//
// ONE DOWNLOAD FLOW FOR THE TWO SCREENS THAT START ONE: the assistant's picker
// and Assistant models. The transfer lives in the screen's state while it runs,
// because the disk changes only at the end (see `TransferProgress`), and it is
// cleared when `download()` settles, before the disk is read again.
//
// docs/13 GATE 7 READS THE CHECKSUM STEP OFF LOGCAT. A development build writes
// one `[ai_download]` line when hashing starts and one when the file verifies,
// with the model id and the hashing time and nothing else.
import { useCallback, useState } from "react";

import type { TransferProgress } from "@/components/ai/download_card";
import type { ModelSpec } from "@/lib/ai/catalogue";
import type { Downloader } from "@/lib/ai/downloader";
import { systemClock } from "@/lib/clock";

type DownloadLogLine =
  | { event: "verify_start"; id: string }
  | { event: "verified"; id: string; digestMs: number };

/** Ids and numbers only. A URL, a path or a byte of the file never goes out. */
function logDownload(line: DownloadLogLine): void {
  if (!__DEV__) return;
  console.info(`[ai_download] ${JSON.stringify(line)}`);
}

/**
 * Starts model downloads and tracks each one while it runs.
 *
 * @param downloader - The screen's downloader.
 * @param refresh - Re-reads the disk. Runs after every download settles,
 *   refusals included, because a refusal can leave a `.part` the card must show.
 * @returns `transfers`, the live transfer per model id, for `ModelPicker`'s
 *   `progress`; and `download`, for its `onDownload`, which rejects with the
 *   downloader's own errors so the card can turn them into copy.
 */
export function useModelDownload(
  downloader: Downloader,
  refresh: () => Promise<void>,
): {
  transfers: Readonly<Record<string, TransferProgress>>;
  download: (spec: ModelSpec, allowMetered: boolean) => Promise<void>;
} {
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});

  const download = useCallback(
    async (spec: ModelSpec, allowMetered: boolean) => {
      const track = (next: TransferProgress) =>
        setTransfers((current) => ({ ...current, [spec.id]: next }));
      // An object, so the callback's write is visible after the await.
      const hashing: { since: number | null } = { since: null };

      try {
        await downloader.download(spec, {
          allowMetered,
          onProgress: (received, total) => track({ phase: "downloading", received, total }),
          onVerifying: () => {
            hashing.since = systemClock.now();
            logDownload({ event: "verify_start", id: spec.id });
            track({ phase: "verifying", received: spec.bytes, total: spec.bytes });
          },
        });
        if (hashing.since !== null) {
          logDownload({ event: "verified", id: spec.id, digestMs: systemClock.now() - hashing.since });
        }
      } finally {
        setTransfers((current) => {
          const next = { ...current };
          delete next[spec.id];
          return next;
        });
        await refresh();
      }
    },
    [downloader, refresh],
  );

  return { transfers, download };
}
