// hooks/use_model_download.ts
//
// ONE DOWNLOAD FLOW FOR THE TWO SCREENS THAT START ONE: the assistant's picker
// and Assistant models. The transfer is held here while it runs, because the
// disk changes only at the end (see `TransferProgress`), and it is cleared when
// `download()` settles, before the disk is read again.
//
// A TRANSFER OUTLIVES THE SCREEN THAT STARTED IT. Leave Assistant models
// mid-download and come back, and the new screen must show the same bytes, so
// transfers live at module scope and every mounted screen reads them through
// `useSyncExternalStore`. `mobile/` has no Zustand, and one store this small
// did not justify adding it.
//
// docs/13 GATE 7 READS THE CHECKSUM STEP OFF LOGCAT. A development build writes
// one `[ai_download]` line when hashing starts and one when the file verifies,
// with the model id and the hashing time and nothing else.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { TransferProgress } from "@/components/ai/download_card";
import type { ModelSpec } from "@/lib/ai/catalogue";
import type { Downloader } from "@/lib/ai/downloader";
import { systemClock } from "@/lib/clock";

type Transfers = Readonly<Record<string, TransferProgress>>;

type DownloadLogLine =
  | { event: "verify_start"; id: string }
  | { event: "verified"; id: string; digestMs: number };

let transfersNow: Transfers = {};
const transferListeners = new Set<() => void>();
/** Told which screen's download settled, so every other mounted screen re-reads the disk. */
const settleListeners = new Set<(origin: symbol) => void>();

function subscribeTransfers(listener: () => void): () => void {
  transferListeners.add(listener);
  return () => {
    transferListeners.delete(listener);
  };
}

function readTransfers(): Transfers {
  return transfersNow;
}

function updateTransfers(update: (current: Transfers) => Transfers): void {
  transfersNow = update(transfersNow);
  for (const listener of transferListeners) listener();
}

/** Ids and numbers only. A URL, a path or a byte of the file never goes out. */
function logDownload(line: DownloadLogLine): void {
  if (!__DEV__) return;
  console.info(`[ai_download] ${JSON.stringify(line)}`);
}

/**
 * Starts model downloads and tracks each one while it runs, on every screen
 * that uses this hook at once.
 *
 * @param downloader - The screen's downloader.
 * @param refresh - Re-reads the disk. Runs after every download settles,
 *   refusals included, because a refusal can leave a `.part` the card must show,
 *   and on every other mounted screen too, because its disk changed as well.
 * @returns `transfers`, the live transfer per model id, for `ModelPicker`'s
 *   `progress`; and `download`, for its `onDownload`, which rejects with the
 *   downloader's own errors so the card can turn them into copy.
 */
export function useModelDownload(
  downloader: Downloader,
  refresh: () => Promise<void>,
): {
  transfers: Transfers;
  download: (spec: ModelSpec, allowMetered: boolean) => Promise<void>;
} {
  const transfers = useSyncExternalStore(subscribeTransfers, readTransfers);
  // Marks this screen's own downloads, which re-read the disk themselves.
  const [self] = useState(() => Symbol("model_download_screen"));

  useEffect(() => {
    const onSettle = (origin: symbol) => {
      if (origin !== self) void refresh();
    };
    settleListeners.add(onSettle);
    return () => {
      settleListeners.delete(onSettle);
    };
  }, [refresh, self]);

  const download = useCallback(
    async (spec: ModelSpec, allowMetered: boolean) => {
      const track = (next: TransferProgress) =>
        updateTransfers((current) => ({ ...current, [spec.id]: next }));
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
        updateTransfers((current) => {
          const next = { ...current };
          delete next[spec.id];
          return next;
        });
        for (const listener of settleListeners) listener(self);
        await refresh();
      }
    },
    [downloader, refresh, self],
  );

  return { transfers, download };
}
