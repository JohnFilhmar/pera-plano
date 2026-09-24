// mobile/lib/ai/__tests__/model_transfer.test.ts
//
// DRIVES THE PRODUCTION DEPS, NOT A HAND-BUILT COPY. Every test below runs the
// real `createDownloader` over the real `createProductionDeps()`: the real
// `expo/fetch` adapter, the real File API append and bounded read, the real
// legacy store, and the real `@noble/hashes` digest. Only the two things Jest
// cannot provide are replaced. The network is a scripted `expo/fetch` that
// answers the way Hugging Face was measured to answer on 2026-09-24 (302 from
// huggingface.co, then 206 for a Range from the CDN host). The disk is
// `test_support/expo_file_system_memory_mock.ts`, which holds real bytes.
//
// THE BODY ARRIVES IN 8 KB PIECES because that is what one OkHttp read hands
// `expo/fetch` on Android, and the adapter's block size only means anything
// against the piece size the phone actually produces.
const mockExpoFetch = jest.fn();
jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));
jest.mock("expo-file-system", () => require("@/test_support/expo_file_system_memory_mock"));
jest.mock("expo-file-system/legacy", () => require("@/test_support/expo_file_system_memory_mock"));

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { ModelSpec } from "@/lib/ai/catalogue";
import { createDownloader } from "@/lib/ai/downloader";
import { MODELS_DIR, createProductionDeps } from "@/lib/ai/model_files";
import {
  memoryDisk,
  openHandleCount,
  readRequests,
  resetMemoryDisk,
  shortenNextWrite,
} from "@/test_support/expo_file_system_memory_mock";

const MIB = 1024 * 1024;
const PIECE_BYTES = 8192;

const WEIGHTS = new Uint8Array(2.5 * MIB);
for (let i = 0; i < WEIGHTS.length; i += 1) WEIGHTS[i] = (i * 7) % 251;

const CDN_URL = "https://cdn.test/xet-bridge/model.gguf";

const SPEC: ModelSpec = {
  id: "test-tier",
  displayName: "Test Tier",
  params: "0.6B",
  quant: "Q4_K_M",
  bytes: WEIGHTS.length,
  sha256: bytesToHex(sha256(WEIGHTS)),
  url: "https://example.test/resolve/0000000000000000000000000000000000000000/model.gguf",
  minRamBytes: 1024 * 1024 * 1024,
  contextTokens: 2048,
  suppressThinking: true,
  license: "apache-2.0",
};

const FINAL_PATH = `${MODELS_DIR}${SPEC.id}.gguf`;
const PART_PATH = `${FINAL_PATH}.part`;

/** Every abort signal the adapter handed `expo/fetch`, in request order. */
let signals: AbortSignal[] = [];

/** A digest of what is on the memory disk at `path`, so a mismatch prints two short strings. */
function digestOnDisk(path: string): string {
  const bytes = memoryDisk.get(path);
  return bytes === undefined ? "missing" : bytesToHex(sha256(bytes));
}

/** The shape of an `expo/fetch` response the adapter reads: status, headers, and a body reader. */
function respond(
  status: number,
  headers: Record<string, string>,
  bytes: Uint8Array,
  failAfterPieces?: number,
) {
  const pieces: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += PIECE_BYTES) {
    pieces.push(bytes.subarray(at, at + PIECE_BYTES));
  }
  let next = 0;
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (next === failAfterPieces) throw new Error("connection reset by peer");
          return next < pieces.length
            ? { done: false, value: pieces[next++] }
            : { done: true, value: undefined };
        },
      }),
    },
  };
}

/**
 * Scripts Hugging Face: the pinned URL answers 302 to the CDN, and the CDN
 * answers a `Range: bytes=N-` with 206 and the rest of the file, or ignores it.
 */
function serve(options: { ignoreRange?: boolean; failAfterPieces?: number } = {}): void {
  mockExpoFetch.mockImplementation(
    async (url: string, init: { headers?: Record<string, string>; signal: AbortSignal }) => {
      signals.push(init.signal);
      if (url === SPEC.url) return respond(302, { location: CDN_URL }, new Uint8Array(0));

      const range = init.headers?.Range;
      const from = range === undefined || options.ignoreRange ? 0 : Number(range.slice(6, -1));
      const rest = WEIGHTS.subarray(from);
      return respond(
        from > 0 ? 206 : 200,
        { "content-length": String(rest.length) },
        rest,
        options.failAfterPieces,
      );
    },
  );
}

/** Production is always "metered" (it fails closed), so every run here says the user agreed. */
function download(onProgress?: (received: number) => void): Promise<void> {
  return createDownloader(createProductionDeps()).download(SPEC, {
    allowMetered: true,
    onProgress,
  });
}

beforeEach(() => {
  resetMemoryDisk();
  mockExpoFetch.mockReset();
  signals = [];
});

test("native fetch's 8 KB pieces reach the .part in order, as 1 MiB blocks, and verify", async () => {
  serve();
  const progress: number[] = [];

  await download((received) => progress.push(received));

  expect(digestOnDisk(FINAL_PATH)).toBe(SPEC.sha256);
  expect(memoryDisk.has(PART_PATH)).toBe(false);
  // 320 pieces, three writes and three progress updates. Per-piece work on a
  // 1.1 GB model would be 135,000 of each on the JS thread.
  expect(progress).toEqual([MIB, 2 * MIB, 2.5 * MIB]);
  expect(openHandleCount()).toBe(0);
});

test("a resume sends Range: bytes=N- on both hops and appends only the rest", async () => {
  memoryDisk.set(PART_PATH, WEIGHTS.slice(0, 1_000_000));
  serve();

  await download();

  const expectedInit = expect.objectContaining({
    headers: { Range: "bytes=1000000-" },
    redirect: "manual",
    credentials: "omit",
    signal: expect.any(AbortSignal),
  });
  expect(mockExpoFetch.mock.calls).toEqual([
    [SPEC.url, expectedInit],
    [CDN_URL, expectedInit],
  ]);
  expect(digestOnDisk(FINAL_PATH)).toBe(SPEC.sha256);
});

test("a server that ignores Range and answers 200 discards the partial and restarts clean", async () => {
  memoryDisk.set(PART_PATH, WEIGHTS.slice(0, 1_000_000));
  serve({ ignoreRange: true });

  await download();

  // Appended onto the partial, the file would be 1,000,000 bytes too long.
  expect(memoryDisk.get(FINAL_PATH)?.length).toBe(WEIGHTS.length);
  expect(digestOnDisk(FINAL_PATH)).toBe(SPEC.sha256);
});

test("verification reads the file back in pieces of at most 1 MiB", async () => {
  serve();

  await download();

  expect(readRequests.length).toBeGreaterThan(2);
  expect(Math.max(...readRequests)).toBeLessThanOrEqual(MIB);
  expect(openHandleCount()).toBe(0);
});

test("a dropped connection leaves whole blocks on disk, stops the transfer, and a resume completes it", async () => {
  // 200 pieces is 1.56 MiB: one block flushed, the rest still being gathered.
  serve({ failAfterPieces: 200 });

  await expect(download()).rejects.toThrow(/connection reset/);

  expect(memoryDisk.get(PART_PATH)?.length).toBe(MIB);
  expect(digestOnDisk(PART_PATH)).toBe(bytesToHex(sha256(WEIGHTS.subarray(0, MIB))));
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);

  serve();
  mockExpoFetch.mockClear();
  await download();

  expect(mockExpoFetch).toHaveBeenLastCalledWith(
    CDN_URL,
    expect.objectContaining({ headers: { Range: `bytes=${MIB}-` } }),
  );
  expect(digestOnDisk(FINAL_PATH)).toBe(SPEC.sha256);
});

test("a short write on a full disk stops at a clean prefix instead of misplacing the next block", async () => {
  // Carrying on would write block two at byte 1,000 instead of byte 1 MiB. The
  // digest would catch that, but only by discarding the whole download.
  serve();
  shortenNextWrite(1000);

  await expect(download()).rejects.toThrow(/short write/);

  expect(digestOnDisk(PART_PATH)).toBe(bytesToHex(sha256(WEIGHTS.subarray(0, 1000))));

  mockExpoFetch.mockClear();
  await download();

  expect(mockExpoFetch).toHaveBeenLastCalledWith(
    CDN_URL,
    expect.objectContaining({ headers: { Range: "bytes=1000-" } }),
  );
  expect(digestOnDisk(FINAL_PATH)).toBe(SPEC.sha256);
});
