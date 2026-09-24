// hooks/__tests__/use_model_download.test.ts
//
// The transfer a card shows while the disk still says nothing, the re-read of
// the disk once a download settles either way, and the two docs/13 Gate 7
// lines a development build writes around the checksum step.
import { act, renderHook } from "@testing-library/react-native";

import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import { VerificationError, type DownloadOptions, type Downloader } from "@/lib/ai/downloader";
import { systemClock } from "@/lib/clock";

import { useModelDownload } from "../use_model_download";

const SPEC = MODEL_CATALOGUE[0];

/** A downloader whose one transfer is whatever the test scripts. */
function fakeDownloader(run: (opts: DownloadOptions) => Promise<void>): Downloader {
  return {
    stateOf: async () => "absent",
    loadCandidatePath: async () => null,
    download: (_spec, opts = {}) => run(opts),
    remove: async () => undefined,
  };
}

/** A promise the test resolves when it chooses. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

let info: jest.SpyInstance;

beforeEach(() => {
  info = jest.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("bytes, then the checksum step, then nothing once the download settles", async () => {
  const hashing = gate();
  const renamed = gate();
  const refresh = jest.fn(async () => undefined);
  const downloader = fakeDownloader(async (opts) => {
    opts.onProgress?.(400_000_000, SPEC.bytes);
    await hashing.wait;
    opts.onVerifying?.();
    await renamed.wait;
  });
  const { result } = renderHook(() => useModelDownload(downloader, refresh));

  let settled: Promise<void> = Promise.resolve();
  act(() => {
    settled = result.current.download(SPEC, false);
  });
  expect(result.current.transfers[SPEC.id]).toEqual({
    phase: "downloading",
    received: 400_000_000,
    total: SPEC.bytes,
  });

  await act(async () => {
    hashing.open();
    await hashing.wait;
  });
  expect(result.current.transfers[SPEC.id]?.phase).toBe("verifying");

  await act(async () => {
    renamed.open();
    await settled;
  });
  expect(result.current.transfers).toEqual({});
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("a refused download still re-reads the disk, and rejects with the downloader's own error", async () => {
  const refresh = jest.fn(async () => undefined);
  const downloader = fakeDownloader(async (opts) => {
    opts.onProgress?.(1024, SPEC.bytes);
    throw new VerificationError("digest mismatch");
  });
  const { result } = renderHook(() => useModelDownload(downloader, refresh));

  await act(async () => {
    await expect(result.current.download(SPEC, false)).rejects.toThrow(VerificationError);
  });
  expect(result.current.transfers).toEqual({});
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("a development build logs the checksum step with the model id and its time only", async () => {
  jest.spyOn(systemClock, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(4_250);
  const downloader = fakeDownloader(async (opts) => {
    opts.onVerifying?.();
  });
  const { result } = renderHook(() => useModelDownload(downloader, async () => undefined));

  await act(async () => {
    await result.current.download(SPEC, false);
  });

  expect(info.mock.calls.map(([line]) => line)).toEqual([
    `[ai_download] {"event":"verify_start","id":"${SPEC.id}"}`,
    `[ai_download] {"event":"verified","id":"${SPEC.id}","digestMs":3250}`,
  ]);
});
