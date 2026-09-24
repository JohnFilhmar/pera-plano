// app/(tabs)/more/__tests__/ai_models.test.tsx — on-device-ai Task 22.
//
// Drives the REAL `createDownloader` state machine over a fake file store and
// a fake fetch, the same way app/__tests__/parser_diagnostics_screen.test.tsx
// drives a real repository: this file is about what the screen does with the
// downloader's real refusals, not about a mocked-out promise resolving.
//
// The three that are product rules rather than plumbing:
//
//   - A `.part` on disk is RESUMABLE, never ready (spec §2.3 rule 1). A
//     truncated GGUF mmaps and decodes noise instead of failing, so a screen
//     that calls a partial "Ready" is the first step to a confidently wrong
//     assistant.
//   - Mobile data is not spent before the user is asked in a sentence that
//     names the size (§2.3 rule 2) — asserted as "the fake fetch was never
//     called", because a confirmation shown after the request has left is not
//     a confirmation.
//   - Delete is reachable, and it confirms (§2.3: "downloading gigabytes with
//     no visible way to reclaim them is the kind of thing that gets a finance
//     app uninstalled").

// expo-file-system/legacy is mocked project-wide in test_support/jest_setup.ts,
// but that mock is inert and knows nothing about free space or moves. This one
// replaces it for this suite so the legacy adapter's own mapping is assertable.
// Declared inline in the factory, the way lib/privacy/__tests__/data_export.ts
// does it — a factory that closes over a `const` declared below runs into the
// temporal dead zone the moment the module under test requires it.
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///test-documents/",
  cacheDirectory: "file:///test-cache/",
  EncodingType: { UTF8: "utf8", Base64: "base64" },
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  getFreeDiskStorageAsync: jest.fn(async () => 50_000_000_000),
}));

// `Device.totalMemory` is the single call expo-device was added for, and this
// suite is the only place the production RAM reader is exercised. A GETTER,
// not a value: the namespace import in the screen copies property descriptors
// once at require time, so a plain field would freeze at its first reading and
// every per-test RAM change would be silently ignored.
jest.mock("expo-device", () => ({
  get totalMemory() {
    return mockTotalMemory;
  },
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as FileSystem from "expo-file-system/legacy";

import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import type { FetchLike, FileStore, HttpResponse } from "@/lib/ai/downloader";

import AiModelsScreen, {
  MODELS_DIR,
  createLegacyFileStore,
  createProductionDeps,
} from "../ai/models";

const GIB = 1024 * 1024 * 1024;

let mockTotalMemory: number | null = 8 * GIB;

/**
 * The mock above is this module's whole implementation under Jest, so the cast
 * is a statement of that fact rather than a hole in the typing: the real
 * legacy module's `FileInfo` union would otherwise force every stub to carry
 * `uri`, `isDirectory` and `modificationTime` for no assertion's benefit.
 */
const mockFileSystem = FileSystem as unknown as {
  makeDirectoryAsync: jest.Mock;
  deleteAsync: jest.Mock;
  moveAsync: jest.Mock;
  getInfoAsync: jest.Mock;
  getFreeDiskStorageAsync: jest.Mock;
};
const TIER_ONE = MODEL_CATALOGUE[0];
const TIER_TWO = MODEL_CATALOGUE[1];

const FINAL_PATH = `${MODELS_DIR}${TIER_ONE.id}.gguf`;
const PART_PATH = `${FINAL_PATH}.part`;

/** In-memory stand-in for the device's disk: path -> byte length. */
function fakeFileStore(initial: Record<string, number> = {}): FileStore & {
  sizes: Map<string, number>;
} {
  const sizes = new Map<string, number>(Object.entries(initial));
  return {
    sizes,
    ensureDir: async () => undefined,
    exists: async (path) => sizes.has(path),
    size: async (path) => sizes.get(path) ?? 0,
    append: async (path, chunk) => {
      sizes.set(path, (sizes.get(path) ?? 0) + chunk.length);
    },
    readChunks: async function* () {
      // Nothing on this fake disk hashes to a catalogue digest, and no test
      // here pretends otherwise — verification failure is the honest outcome.
    },
    remove: async (path) => {
      sizes.delete(path);
    },
    rename: async (from, to) => {
      sizes.set(to, sizes.get(from) ?? 0);
      sizes.delete(from);
    },
    freeSpace: async () => 50_000_000_000,
  };
}

/** Keeps `sizes` visible to the assertions — a bare `FileStore` hides it. */
type FakeFileStore = ReturnType<typeof fakeFileStore>;

function renderScreen(overrides: {
  files?: FakeFileStore;
  fetch?: jest.Mock;
  isMetered?: () => Promise<boolean>;
  readTotalRam?: () => number;
}) {
  const files = overrides.files ?? fakeFileStore();
  const fetchFake = overrides.fetch ?? jest.fn(async (): Promise<HttpResponse> => {
    throw new Error("the network was not supposed to be reached");
  });

  render(
    <AiModelsScreen
      deps={{
        fetch: fetchFake as unknown as FetchLike,
        files,
        modelsDir: MODELS_DIR,
        isMetered: overrides.isMetered ?? (async () => false),
      }}
      readTotalRam={overrides.readTotalRam}
    />,
  );

  return { files, fetchFake };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTotalMemory = 8 * GIB;
});

test("a .part on disk renders as resumable, never as ready", async () => {
  renderScreen({ files: fakeFileStore({ [PART_PATH]: 200_000_000 }) });

  await screen.findByText("Resume download");
  expect(screen.queryByText("Ready on this phone")).toBeNull();
});

test("a verified model renders as ready and offers to reclaim its space", async () => {
  renderScreen({ files: fakeFileStore({ [FINAL_PATH]: TIER_ONE.bytes }) });

  await screen.findByText("Ready on this phone");
  expect(screen.getByTestId(`model-card-${TIER_ONE.id}-delete`)).toBeTruthy();
});

test("the menu is gated on this device's own total RAM, read from expo-device", async () => {
  mockTotalMemory = 4 * GIB;
  renderScreen({});

  await screen.findByText(TIER_ONE.displayName);
  expect(screen.queryByText(TIER_TWO.displayName)).toBeNull();
  screen.getByTestId("model-picker-note");
});

test("an unreadable total RAM offers nothing rather than everything", async () => {
  mockTotalMemory = null;
  renderScreen({});

  await screen.findByTestId("model-picker-note");
  expect(screen.queryByText(TIER_ONE.displayName)).toBeNull();
});

test("no mobile data is spent before the user is asked, in a sentence naming the size", async () => {
  const { fetchFake } = renderScreen({ isMetered: async () => true });

  fireEvent.press(await screen.findByTestId(`model-card-${TIER_TWO.id}-action`));

  await screen.findByText(/Download 1\.1 GB over mobile data\?/);
  expect(fetchFake).not.toHaveBeenCalled();
});

test("confirming the mobile-data prompt is what lets the request out", async () => {
  const { fetchFake } = renderScreen({ isMetered: async () => true });

  fireEvent.press(await screen.findByTestId(`model-card-${TIER_ONE.id}-action`));
  await screen.findByText(/Download 0\.4 GB over mobile data\?/);

  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));

  await waitFor(() => expect(fetchFake).toHaveBeenCalledTimes(1));
  await screen.findByText(/could not be completed/);
});

test("a fresh download shows its bytes as they land, then the checksum step", async () => {
  // The disk says `absent` for the whole transfer, so everything the card
  // shows before the end comes from the download's own callbacks.
  let releaseBody = () => {};
  let releaseHash = () => {};
  const bodyGate = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  const hashGate = new Promise<void>((resolve) => {
    releaseHash = resolve;
  });

  const files = {
    ...fakeFileStore(),
    // Nothing here hashes to a catalogue digest, so this ends in the honest
    // checksum refusal once the test lets it finish.
    readChunks: async function* (): AsyncGenerator<Uint8Array> {
      await hashGate;
    },
  };
  const fetchFake = jest.fn(
    async (): Promise<HttpResponse> => ({
      status: 200,
      headers: { get: (name) => (name === "content-length" ? String(TIER_ONE.bytes) : null) },
      body: (async function* () {
        yield new Uint8Array(1024);
        await bodyGate;
        // The rest of the file, from one shared block. A body that stops short
        // is kept for a resume and never reaches the checksum step, and the
        // fake disk only counts bytes, so this costs no memory.
        const block = new Uint8Array(16 * 1024 * 1024);
        for (let left = TIER_ONE.bytes - 1024; left > 0; left -= block.length) {
          yield block.subarray(0, Math.min(block.length, left));
        }
      })(),
    }),
  );
  const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
  renderScreen({ files, fetch: fetchFake });
  const stateLine = () => String(screen.getByTestId(`model-card-${TIER_ONE.id}-state`).props.children);

  fireEvent.press(await screen.findByTestId(`model-card-${TIER_ONE.id}-action`));
  await waitFor(() => expect(stateLine()).toBe("0% of 0.4 GB downloaded"));

  releaseBody();
  await waitFor(() => expect(stateLine()).toBe("Checking the file"));

  releaseHash();
  await screen.findByText(/did not match its checksum/);
  expect(stateLine()).toBe("Not on this phone yet");

  // docs/13 Gate 7: the checksum step started, and a file that failed it is
  // never logged as verified.
  expect(info.mock.calls.map(([line]) => line)).toEqual([
    `[ai_download] {"event":"verify_start","id":"${TIER_ONE.id}"}`,
  ]);
  info.mockRestore();
});

test("delete asks first — cancelling reclaims nothing", async () => {
  const { files } = renderScreen({ files: fakeFileStore({ [FINAL_PATH]: TIER_ONE.bytes }) });

  fireEvent.press(await screen.findByTestId(`model-card-${TIER_ONE.id}-delete`));
  await screen.findByText(`Delete ${TIER_ONE.displayName}?`);
  fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));

  expect(files.sizes.has(FINAL_PATH)).toBe(true);
});

test("confirming delete removes the model and the screen offers it again", async () => {
  const { files } = renderScreen({
    files: fakeFileStore({ [FINAL_PATH]: TIER_ONE.bytes, [PART_PATH]: 10 }),
  });

  fireEvent.press(await screen.findByTestId(`model-card-${TIER_ONE.id}-delete`));
  await screen.findByText(`Delete ${TIER_ONE.displayName}?`);
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));

  await waitFor(() => expect(files.sizes.has(FINAL_PATH)).toBe(false));
  // The stray partial goes with it — reclaiming space means all of it.
  expect(files.sizes.has(PART_PATH)).toBe(false);
  await screen.findByTestId(`model-card-${TIER_ONE.id}-action`);
});

test("no speed figure from a spec sheet reaches this screen", async () => {
  renderScreen({ files: fakeFileStore({ [FINAL_PATH]: TIER_ONE.bytes }) });

  await screen.findByText("Ready on this phone");
  expect(screen.queryByText(/tokens\/second/)).toBeNull();
});

test("models live under documentDirectory/models/, unencrypted and outside the database", () => {
  expect(MODELS_DIR).toBe("file:///test-documents/models/");
});

test("the production file store is the legacy API, and refuses what legacy cannot do", async () => {
  const store = createLegacyFileStore();

  mockFileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 512 });
  expect(await store.exists(FINAL_PATH)).toBe(true);

  mockFileSystem.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 512 });
  expect(await store.size(FINAL_PATH)).toBe(512);

  await store.ensureDir(MODELS_DIR);
  expect(mockFileSystem.makeDirectoryAsync).toHaveBeenCalledWith(MODELS_DIR, {
    intermediates: true,
  });

  await store.remove(FINAL_PATH);
  expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(FINAL_PATH, { idempotent: true });

  await store.rename(PART_PATH, FINAL_PATH);
  expect(mockFileSystem.moveAsync).toHaveBeenCalledWith({ from: PART_PATH, to: FINAL_PATH });

  expect(await store.freeSpace()).toBe(50_000_000_000);

  // The gap is loud rather than silent: a no-op `append` would let an empty
  // file reach verification and fail for a reason no log would explain.
  await expect(store.append(PART_PATH, new Uint8Array([1]))).rejects.toThrow(/legacy/);
});

test("an unknown network is treated as metered until a reachability package lands", async () => {
  const deps = createProductionDeps();

  expect(await deps.isMetered()).toBe(true);
  expect(deps.modelsDir).toBe(MODELS_DIR);
});
