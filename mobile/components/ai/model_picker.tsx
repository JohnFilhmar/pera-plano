// components/ai/model_picker.tsx — on-device-ai Task 22 (spec §2.2, §2.3).
//
// THE LIST IS THE GATE. `offeredModels` decides what exists here, and a model
// this phone cannot hold is not rendered at all — not disabled, not greyed,
// not "unavailable". Spec §2.2: a greyed-out row "invites the user to go
// looking for the setting that ungreys it", and there is no such setting; the
// phone is simply too small. A shorter list plus one sentence is honest.
//
// THE NOTE IS CONDITIONAL, and both directions matter. It says why the list is
// short, and it is absent when the list is full — "a note that always shows is
// a note nobody reads, and by the time it matters it has become furniture"
// (lib/ai/ram_gate.ts). This component renders `offeredModels`' own `note`
// rather than composing its own, so the copy cannot drift from the gate that
// produced it.
//
// TOTAL RAM ARRIVES AS A READER, not as a number: the injection seam
// `ram_gate.ts` exists for. In production the screen passes
// `() => Device.totalMemory ?? 0`; tests pass a literal and never need a phone.
import { Text, View } from "react-native";

import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import type { ModelSpec } from "@/lib/ai/catalogue";
import type { DownloadState } from "@/lib/ai/downloader";
import { offeredModels } from "@/lib/ai/ram_gate";
import type { RamReader } from "@/lib/ai/ram_gate";

import { DownloadCard, type TransferProgress } from "./download_card";

export type ModelPickerProps = {
  readTotalRam: RamReader;
  /** Overridable for tests only; the app has exactly one catalogue. */
  catalogue?: readonly ModelSpec[];
  /** Per-model download state, keyed by `ModelSpec.id`. Absent means `absent`. */
  states: Readonly<Record<string, DownloadState>>;
  /** Transfers in flight, keyed by `ModelSpec.id`. Absent means none is running. */
  progress?: Readonly<Record<string, TransferProgress>>;
  /** This phone's own measured decode rates (§2.5). Never a §2.1 estimate. */
  measuredTps?: Readonly<Record<string, number>>;
  onDownload: (spec: ModelSpec, allowMetered: boolean) => Promise<void>;
  onDelete: (spec: ModelSpec) => Promise<void>;
  meteredNote?: string;
  testID?: string;
};

export function ModelPicker({
  readTotalRam,
  catalogue = MODEL_CATALOGUE,
  states,
  progress,
  measuredTps,
  onDownload,
  onDelete,
  meteredNote,
  testID = "model-picker",
}: ModelPickerProps) {
  const { models, note } = offeredModels(catalogue, readTotalRam);

  return (
    <View testID={testID} className="gap-3">
      {note === null ? null : (
        <View
          testID={`${testID}-note`}
          className="rounded-lg bg-surface px-4 py-3 dark:bg-surface-dark"
        >
          <Text className="text-secondary text-fg-2 dark:text-fg-2-dark">{note}</Text>
        </View>
      )}

      {models.map((spec) => (
        <DownloadCard
          key={spec.id}
          spec={spec}
          state={states[spec.id] ?? "absent"}
          progress={progress?.[spec.id] ?? null}
          measuredTps={measuredTps?.[spec.id] ?? null}
          onDownload={onDownload}
          onDelete={onDelete}
          meteredNote={meteredNote}
        />
      ))}
    </View>
  );
}
