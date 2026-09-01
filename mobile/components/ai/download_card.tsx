// components/ai/download_card.tsx — on-device-ai Task 22 (spec §2.3, §2.5).
//
// One model, one card, and the three refusals the downloader owns rendered as
// things a person can answer:
//
//   MOBILE DATA. The card never decides the network is metered — it asks the
//   downloader to start, and turns `MeteredNetworkError` into the question the
//   spec requires, with the SIZE IN THE SENTENCE (`meteredConfirmation`).
//   Duplicating the metered check here would give the app two sources of truth
//   for "may this download run", and the one on screen would be the wrong one
//   the moment a reachability package lands behind the downloader's seam.
//
//   DELETE IS FIRST-CLASS, not buried in a settings screen: "downloading
//   gigabytes with no visible way to reclaim them is the kind of thing that
//   gets a finance app uninstalled." It confirms, because 1.1 GB over a
//   prepaid plan is not a mis-tap the user can undo.
//
//   A `.part` IS NOT A MODEL. `downloading` renders as resumable, and the
//   word "Ready" appears for exactly one state. A truncated GGUF mmaps and
//   decodes noise instead of failing loudly, so a card that flatters a partial
//   file is the first step to a confidently wrong assistant.
//
// NO SPEED NUMBER THIS PHONE DID NOT MEASURE. Every tok/s in spec §2.1's table
// is extrapolated from comparable silicon and not one was measured on an A54,
// so `measuredTps` is the only source of a figure here and its absence prints
// a sentence rather than an estimate.
import { useState } from "react";
import { Download, Trash2 } from "lucide-react-native";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import type { ModelSpec } from "@/lib/ai/catalogue";
import {
  InsufficientSpaceError,
  MeteredNetworkError,
  VerificationError,
  meteredConfirmation,
} from "@/lib/ai/downloader";
import type { DownloadState } from "@/lib/ai/downloader";

export type DownloadCardProps = {
  spec: ModelSpec;
  state: DownloadState;
  /** Live byte counts while a transfer is running, or null between runs. */
  progress?: { received: number; total: number } | null;
  /** This phone's own measured decode rate (§2.5), or null if never measured. */
  measuredTps?: number | null;
  /**
   * `allowMetered` is true only after the user answered the size question.
   * Rejections are the downloader's own error types — the card reads them
   * rather than pre-empting them.
   */
  onDownload: (spec: ModelSpec, allowMetered: boolean) => Promise<void>;
  onDelete: (spec: ModelSpec) => Promise<void>;
  /** Appended to the mobile-data question when the app cannot tell WiFi from data. */
  meteredNote?: string;
  testID?: string;
};

/** Decimal GB, matching `meteredConfirmation` — a data plan is sold in decimal GB. */
function formatSize(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * "Ready" belongs to exactly one state. `downloading` says paused and resumable
 * — see this file's header for why flattering a `.part` is dangerous.
 */
const STATE_LINE: Record<DownloadState, string> = {
  absent: "Not on this phone yet",
  downloading: "Paused — part of this download is already here",
  verifying: "Checking this download against its checksum",
  ready: "Ready on this phone",
  active: "Ready on this phone, and in use",
};

const ACTION_LABEL: Partial<Record<DownloadState, string>> = {
  absent: "Download",
  downloading: "Resume download",
};

/**
 * User-facing copy per refusal, never the raw `Error.message`. Each one says
 * what is on the phone now, because "failed" without that leaves the user
 * unsure whether they are storing a broken 1.1 GB file.
 */
function failureMessage(cause: unknown): string {
  if (cause instanceof InsufficientSpaceError) {
    return "There is not enough free space on this phone for this model. Nothing was downloaded.";
  }
  if (cause instanceof VerificationError) {
    return "This download did not match its checksum, so it was discarded. Nothing was installed.";
  }
  return "This download could not be completed. Nothing was installed.";
}

type Prompt = "none" | "metered" | "delete";

export function DownloadCard({
  spec,
  state,
  progress = null,
  measuredTps = null,
  onDownload,
  onDelete,
  meteredNote,
  testID = `model-card-${spec.id}`,
}: DownloadCardProps) {
  const [prompt, setPrompt] = useState<Prompt>("none");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const actionLabel = ACTION_LABEL[state];

  async function start(allowMetered: boolean): Promise<void> {
    setPrompt("none");
    setFailure(null);
    setBusy(true);
    try {
      await onDownload(spec, allowMetered);
    } catch (cause) {
      // The downloader refuses BEFORE the first byte, so this is a question
      // still worth asking rather than a report on data already spent.
      if (cause instanceof MeteredNetworkError && !allowMetered) {
        setPrompt("metered");
        return;
      }
      setFailure(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    setPrompt("none");
    setBusy(true);
    try {
      await onDelete(spec);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card testID={testID}>
      <Text className="text-body font-semibold text-fg dark:text-fg-dark">{spec.displayName}</Text>
      <Text className="mt-1 text-secondary text-fg-2 dark:text-fg-2-dark">
        {`${spec.params} · ${spec.quant} · ${formatSize(spec.bytes)}`}
      </Text>

      <Text testID={`${testID}-state`} className="mt-2 text-secondary text-fg-2 dark:text-fg-2-dark">
        {progress && state === "downloading"
          ? `${formatSize(progress.received)} of ${formatSize(progress.total)} downloaded`
          : STATE_LINE[state]}
      </Text>

      {/* The device's own number or none at all — never §2.1's table. */}
      <Text testID={`${testID}-speed`} className="mt-1 text-secondary text-fg-2 dark:text-fg-2-dark">
        {measuredTps === null
          ? "Speed is measured on this phone after it downloads."
          : `On your phone: ${Math.round(measuredTps)} tokens/second`}
      </Text>

      {failure === null ? null : (
        <Text testID={`${testID}-failure`} className="mt-2 text-secondary text-danger dark:text-danger-dark">
          {failure}
        </Text>
      )}

      <View className="mt-3 gap-2">
        {actionLabel === undefined ? null : (
          <Button
            testID={`${testID}-action`}
            title={actionLabel}
            icon={Download}
            loading={busy}
            onPress={() => void start(false)}
          />
        )}
        {/* A stray `.part` occupies real space too, so anything but `absent`
            offers the reclaim. */}
        {state === "absent" ? null : (
          <Button
            testID={`${testID}-delete`}
            title="Delete"
            variant="outline-destructive"
            icon={Trash2}
            onPress={() => setPrompt("delete")}
          />
        )}
      </View>

      <ConfirmDialog
        visible={prompt === "metered"}
        title="Use mobile data?"
        body={
          meteredNote === undefined
            ? meteredConfirmation(spec)
            : `${meteredConfirmation(spec)} ${meteredNote}`
        }
        confirmLabel="Download over mobile data"
        onConfirm={() => void start(true)}
        onCancel={() => setPrompt("none")}
      />

      <ConfirmDialog
        visible={prompt === "delete"}
        title={`Delete ${spec.displayName}?`}
        body={`This frees up to ${formatSize(spec.bytes)} on this phone. You can download it again later, over the same ${formatSize(spec.bytes)}.`}
        confirmLabel="Delete model"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPrompt("none")}
      />
    </Card>
  );
}
