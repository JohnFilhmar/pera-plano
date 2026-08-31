// mobile/lib/ai/__tests__/ram_gate.test.ts
//
// TOTAL RAM IS INJECTED, so the gate is testable without a device. In
// production the reader is `() => Device.totalMemory` — the single call
// `expo-device` was added for, and the spike verified it is byte-identical to
// `/proc/meminfo`'s MemTotal (7,798,394,880 B on the A54).
//
// THE FIGURES BELOW ARE WHAT REAL PHONES REPORT, not round powers of two.
// Android's `totalMem` excludes what the kernel and the bootloader reserved, so
// a "6 GB" phone reports roughly 5.5 GiB and an "8 GB" phone 7.26 GiB. A test
// written against 6 * 1024^3 would pass while the real 6 GB device it stands
// for failed the gate.
import { MODEL_CATALOGUE } from "../catalogue";
import { offeredModels } from "../ram_gate";

const GIB = 1024 * 1024 * 1024;

/** The owner's A54 5G, read from the device on 2026-08-31. */
const EIGHT_GB = 7798394880;
/** A nominal 6 GB phone, at the same ~91% ratio. */
const SIX_GB = Math.round(5.5 * GIB);
/** A nominal 4 GB phone. */
const FOUR_GB = Math.round(3.6 * GIB);
/** A nominal 3 GB phone — below every tier. */
const THREE_GB = Math.round(2.7 * GIB);

describe("what each class of phone is offered", () => {
  test("8 GB sees both tiers", () => {
    const { models } = offeredModels(MODEL_CATALOGUE, () => EIGHT_GB);
    expect(models.map((spec) => spec.id)).toEqual(["qwen3-0.6b-q4", "qwen3-1.7b-q4"]);
  });

  test("6 GB sees tier 1 only", () => {
    // Measured: tier 2 costs 2.51 GB PSS and a 6 GB phone has roughly 2 GiB
    // available. Offering it there is offering a model the OS will kill.
    const { models } = offeredModels(MODEL_CATALOGUE, () => SIX_GB);
    expect(models.map((spec) => spec.id)).toEqual(["qwen3-0.6b-q4"]);
  });

  test("4 GB sees tier 1 only", () => {
    const { models } = offeredModels(MODEL_CATALOGUE, () => FOUR_GB);
    expect(models.map((spec) => spec.id)).toEqual(["qwen3-0.6b-q4"]);
  });

  test("below tier 1 the menu is EMPTY, not a greyed-out list", () => {
    // "A greyed-out row invites the user to go looking for the setting that
    // ungreys it." There is no such setting; the phone is too small.
    const { models } = offeredModels(MODEL_CATALOGUE, () => THREE_GB);
    expect(models).toEqual([]);
  });
});

describe("the note appears exactly when something was hidden", () => {
  test("present when the list is shorter than the catalogue", () => {
    expect(offeredModels(MODEL_CATALOGUE, () => SIX_GB).note).not.toBeNull();
  });

  test("present, and explanatory, when nothing is offered at all", () => {
    const { note } = offeredModels(MODEL_CATALOGUE, () => THREE_GB);
    expect(note).not.toBeNull();
    expect(note?.length).toBeGreaterThan(0);
  });

  test("ABSENT when the whole catalogue is offered", () => {
    // Both directions, because a note that always shows is a note nobody reads.
    expect(offeredModels(MODEL_CATALOGUE, () => EIGHT_GB).note).toBeNull();
  });
});

describe("the reader is called, not cached at module load", () => {
  test("a reader that changes its answer changes the menu", () => {
    // The gate must not be evaluated once at import time: RAM is read when the
    // menu is shown, and a module-level constant would be captured before
    // `Device` is even available.
    let ram = THREE_GB;
    const read = () => ram;
    expect(offeredModels(MODEL_CATALOGUE, read).models).toEqual([]);
    ram = EIGHT_GB;
    expect(offeredModels(MODEL_CATALOGUE, read).models).toHaveLength(2);
  });

  test("an unreadable total (0 or negative) offers nothing rather than everything", () => {
    // `Device.totalMemory` is nullable on some platforms. Failing open here
    // would offer a 2 GB phone a model that cannot load, so it fails closed.
    expect(offeredModels(MODEL_CATALOGUE, () => 0).models).toEqual([]);
    expect(offeredModels(MODEL_CATALOGUE, () => -1).models).toEqual([]);
    expect(offeredModels(MODEL_CATALOGUE, () => Number.NaN).models).toEqual([]);
  });

  test("catalogue order is preserved", () => {
    const { models } = offeredModels(MODEL_CATALOGUE, () => EIGHT_GB);
    expect(models).toEqual(MODEL_CATALOGUE.filter((spec) => spec.minRamBytes <= EIGHT_GB));
  });
});
