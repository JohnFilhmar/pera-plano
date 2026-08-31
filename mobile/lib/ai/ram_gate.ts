// mobile/lib/ai/ram_gate.ts
//
// MODELS THAT WILL NOT FIT DO NOT APPEAR IN THE MENU AT ALL. Spec §2.2: a
// greyed-out row "invites the user to go looking for the setting that ungreys
// it", and there is no such setting — the phone is simply too small. A shorter
// list plus one sentence explaining why is honest; a disabled row is a puzzle.
//
// TOTAL RAM IS INJECTED so this is unit-testable without a device. In
// production the reader is `() => Device.totalMemory`, the single call
// `expo-device` was added for, and the spike verified it reports exactly
// `/proc/meminfo`'s MemTotal — 7,798,394,880 B on the A54, byte-identical.
//
// IT FAILS CLOSED. An unreadable total offers nothing rather than everything:
// `Device.totalMemory` is nullable on some platforms, and failing open would
// offer a 2 GB phone a model that cannot load and a crash that looks like a bug
// in the app rather than a phone that was never eligible.
import type { ModelSpec } from "./catalogue";

export type RamReader = () => number;

const NOTHING_FITS_NOTE =
  "This phone does not have enough memory to run the assistant. Nothing here will work on it, so nothing is offered.";

const SOME_HIDDEN_NOTE =
  "Larger models are hidden because this phone does not have enough memory to run them.";

export function offeredModels(
  catalogue: readonly ModelSpec[],
  readTotalRam: RamReader,
): { models: ModelSpec[]; note: string | null } {
  const totalRam = readTotalRam();
  // `Number.isFinite` catches NaN and Infinity together; the `> 0` catches a
  // zero or negative reading from a platform that does not know.
  const usable = Number.isFinite(totalRam) && totalRam > 0 ? totalRam : 0;

  const models = catalogue.filter((spec) => spec.minRamBytes <= usable);

  if (models.length === catalogue.length) {
    // The note is ABSENT here, deliberately. A note that always shows is a note
    // nobody reads, and by the time it matters it has become furniture.
    return { models, note: null };
  }

  return { models, note: models.length === 0 ? NOTHING_FITS_NOTE : SOME_HIDDEN_NOTE };
}
