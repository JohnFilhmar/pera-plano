// components/ai/__tests__/model_picker.test.tsx — on-device-ai Task 22.
//
// The picker is the only place a user ever chooses a model, so the tests here
// are about what the list SAYS rather than about React:
//
//   - A model this phone cannot hold is ABSENT, never disabled. Spec §2.2: a
//     greyed-out row "invites the user to go looking for the setting that
//     ungreys it", and there is no such setting. The sweep below is the
//     enforcement — nothing in the tree may carry `disabled`, so a future
//     "helpful" greyed row fails here rather than shipping.
//   - The short-list note appears when the list is short and NOT when it is
//     full, both directions, because a note that always shows is furniture.
//   - No tok/s figure exists until this phone measured one (spec §2.5). Every
//     number in the spec's §2.1 table is an estimate extrapolated from other
//     silicon; none was measured on an A54, so none of them may reach a user.
//   - The mobile-data confirmation names the SIZE in the sentence (§2.3 rule
//     2) — "1.1 GB on a Philippine prepaid plan is real money, and a user who
//     taps through a generic 'Continue?' has not been asked".
//   - Every colour carries a dark-mode counterpart. A missing one fails
//     silently, in dark mode, on a device no test runs on.
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import { MeteredNetworkError } from "@/lib/ai/downloader";
import type { DownloadState } from "@/lib/ai/downloader";

import type { TransferProgress } from "../download_card";
import { ModelPicker } from "../model_picker";

const GIB = 1024 * 1024 * 1024;

/** Total RAM readings that put the gate either side of both catalogue entries. */
const RAM_BELOW_EVERYTHING = 2 * GIB;
const RAM_TIER_ONE_ONLY = 4 * GIB;
const RAM_EVERYTHING = 8 * GIB;

const TIER_ONE = MODEL_CATALOGUE[0];
const TIER_TWO = MODEL_CATALOGUE[1];

const noop = async () => {};

type PickerOverrides = {
  readTotalRam?: () => number;
  states?: Record<string, DownloadState>;
  measuredTps?: Record<string, number>;
  progress?: Record<string, TransferProgress>;
  onDownload?: (spec: (typeof MODEL_CATALOGUE)[number], allowMetered: boolean) => Promise<void>;
  onDelete?: (spec: (typeof MODEL_CATALOGUE)[number]) => Promise<void>;
};

function renderPicker(overrides: PickerOverrides = {}) {
  return render(
    <ModelPicker
      readTotalRam={overrides.readTotalRam ?? (() => RAM_EVERYTHING)}
      states={overrides.states ?? {}}
      measuredTps={overrides.measuredTps}
      progress={overrides.progress}
      onDownload={overrides.onDownload ?? noop}
      onDelete={overrides.onDelete ?? noop}
    />,
  );
}

/**
 * Class *lists*, not the joined string: `bg-fg-2` is a substring of
 * `bg-fg-2-dark`, so a `toContain` on the raw string passes on the wrong
 * token. Same reasoning as components/ui/__tests__/primitives.test.tsx.
 */
function eachNodeProps(node: unknown, visit: (props: Record<string, unknown>) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child) => eachNodeProps(child, visit));
    return;
  }
  const record = node as { props?: Record<string, unknown>; children?: unknown };
  if (record.props) visit(record.props);
  eachNodeProps(record.children, visit);
}

/** Every colour token in tailwind.config.ts that has a `-dark` counterpart. */
const COLOUR_ROOTS = [
  "bg",
  "surface",
  "fg",
  "fg-2",
  "brand",
  "brand-soft",
  "on-brand",
  "danger",
  "warn",
  "line",
  "chip",
  "brand-ink",
  "danger-ink",
  "warn-ink",
];

function coloursWithoutDarkCounterpart(): string[] {
  const missing: string[] = [];
  eachNodeProps(screen.toJSON(), (props) => {
    const classes = String(props.className ?? "")
      .split(/\s+/)
      .filter(Boolean);
    for (const token of classes) {
      const match = /^(bg|text|border)-(.+)$/.exec(token);
      if (!match) continue;
      const [, prefix, root] = match;
      if (!COLOUR_ROOTS.includes(root)) continue;
      if (!classes.includes(`dark:${prefix}-${root}-dark`)) missing.push(token);
    }
  });
  return missing;
}

function disabledNodes(): number {
  let count = 0;
  eachNodeProps(screen.toJSON(), (props) => {
    const state = props.accessibilityState as { disabled?: boolean } | undefined;
    if (props.disabled === true || state?.disabled === true) count += 1;
  });
  return count;
}

test("a model this phone cannot hold is absent from the list, not disabled", () => {
  renderPicker({ readTotalRam: () => RAM_TIER_ONE_ONLY });

  screen.getByText(TIER_ONE.displayName);
  expect(screen.queryByText(TIER_TWO.displayName)).toBeNull();
  expect(JSON.stringify(screen.toJSON())).not.toContain(TIER_TWO.displayName);
  expect(disabledNodes()).toBe(0);
});

test("the note explains why the list is short", () => {
  renderPicker({ readTotalRam: () => RAM_TIER_ONE_ONLY });

  expect(screen.getByTestId("model-picker-note")).toBeTruthy();
  screen.getByText(/not have enough memory/);
});

test("no note when every model in the catalogue fits — a note that always shows is furniture", () => {
  renderPicker({ readTotalRam: () => RAM_EVERYTHING });

  expect(screen.queryByTestId("model-picker-note")).toBeNull();
  screen.getByText(TIER_ONE.displayName);
  screen.getByText(TIER_TWO.displayName);
});

test("a phone below the smallest model offers nothing and says why", () => {
  renderPicker({ readTotalRam: () => RAM_BELOW_EVERYTHING });

  expect(screen.queryByText(TIER_ONE.displayName)).toBeNull();
  expect(screen.queryByText(TIER_TWO.displayName)).toBeNull();
  screen.getByTestId("model-picker-note");
});

test("no speed figure exists until this phone has measured one", () => {
  renderPicker({ readTotalRam: () => RAM_EVERYTHING });

  expect(screen.queryByText(/tokens\/second/)).toBeNull();
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/tok\/s/);
  screen.getAllByText(/measured on this phone/);
});

test("the speed shown is the number this phone measured", () => {
  renderPicker({
    readTotalRam: () => RAM_EVERYTHING,
    measuredTps: { [TIER_ONE.id]: 11.4 },
  });

  screen.getByText("On your phone: 11 tokens/second");
  // Exactly one, because the unmeasured tier still shows no figure — one
  // model's measurement never speaks for the other.
  expect(screen.queryAllByText(/tokens\/second/)).toHaveLength(1);
});

test("a running transfer shows its bytes while the disk still says absent, then the checksum step", () => {
  // A fresh download is `absent` on disk until the final rename, so the live
  // transfer has to outrank the disk or the card says "Not on this phone yet"
  // for the whole 1.1 GB.
  const stateLine = () => String(screen.getByTestId(`model-card-${TIER_TWO.id}-state`).props.children);

  // A whole percent, not tenths of a GB: on slow mobile data 0.1 GB can take
  // over ten minutes, and a line that does not move for that long reads as stuck.
  renderPicker({
    progress: { [TIER_TWO.id]: { phase: "downloading", received: 400_000_000, total: TIER_TWO.bytes } },
  });
  expect(stateLine()).toBe("36% of 1.1 GB downloaded");

  renderPicker({
    progress: { [TIER_TWO.id]: { phase: "verifying", received: TIER_TWO.bytes, total: TIER_TWO.bytes } },
  });
  expect(stateLine()).toBe("Checking the file");
});

test("an absent model offers a download, a downloaded one offers a delete", () => {
  renderPicker({
    readTotalRam: () => RAM_EVERYTHING,
    states: { [TIER_ONE.id]: "ready", [TIER_TWO.id]: "absent" },
  });

  expect(screen.getByTestId(`model-card-${TIER_ONE.id}-delete`)).toBeTruthy();
  expect(screen.queryByTestId(`model-card-${TIER_ONE.id}-action`)).toBeNull();
  expect(screen.getByTestId(`model-card-${TIER_TWO.id}-action`)).toBeTruthy();
});

test("a partial download reads as resumable, never as ready", () => {
  renderPicker({
    readTotalRam: () => RAM_EVERYTHING,
    states: { [TIER_ONE.id]: "downloading" },
  });

  screen.getByText("Resume download");
  expect(screen.queryByText("Ready on this phone")).toBeNull();
});

test("the download press asks for no mobile data until the user has been asked", async () => {
  const onDownload = jest.fn(async () => {});
  renderPicker({ readTotalRam: () => RAM_EVERYTHING, onDownload });

  fireEvent.press(screen.getByTestId(`model-card-${TIER_ONE.id}-action`));

  await waitFor(() => expect(onDownload).toHaveBeenCalledWith(TIER_ONE, false));
});

test("the mobile-data confirmation names the size in the sentence", async () => {
  const onDownload = jest.fn(async (_spec: unknown, allowMetered: boolean) => {
    if (!allowMetered) throw new MeteredNetworkError("metered");
  });
  renderPicker({ readTotalRam: () => RAM_EVERYTHING, onDownload });

  fireEvent.press(screen.getByTestId(`model-card-${TIER_TWO.id}-action`));

  // 1,107,409,472 bytes is 1.1 GB in the decimal units a data plan is sold in.
  await screen.findByText("Download 1.1 GB over mobile data?");

  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(onDownload).toHaveBeenCalledWith(TIER_TWO, true));
});

test("delete is reachable and confirms before it destroys gigabytes", async () => {
  const onDelete = jest.fn(async () => {});
  renderPicker({
    readTotalRam: () => RAM_EVERYTHING,
    states: { [TIER_ONE.id]: "ready" },
    onDelete,
  });

  fireEvent.press(screen.getByTestId(`model-card-${TIER_ONE.id}-delete`));
  await screen.findByText(`Delete ${TIER_ONE.displayName}?`);

  fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));
  expect(onDelete).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId(`model-card-${TIER_ONE.id}-delete`));
  await screen.findByText(`Delete ${TIER_ONE.displayName}?`);
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));

  await waitFor(() => expect(onDelete).toHaveBeenCalledWith(TIER_ONE));
});

test("every colour the picker paints has a dark-mode counterpart", () => {
  renderPicker({
    readTotalRam: () => RAM_TIER_ONE_ONLY,
    states: { [TIER_ONE.id]: "ready" },
    measuredTps: { [TIER_ONE.id]: 11.4 },
  });
  expect(coloursWithoutDarkCounterpart()).toEqual([]);

  screen.rerender(
    <ModelPicker
      readTotalRam={() => RAM_EVERYTHING}
      states={{ [TIER_ONE.id]: "downloading", [TIER_TWO.id]: "absent" }}
      onDownload={noop}
      onDelete={noop}
    />,
  );
  expect(coloursWithoutDarkCounterpart()).toEqual([]);
});
