// mobile/lib/ai/__tests__/downloader.test.ts
//
// THE HASHER IS REAL. Spec §5.2/6 is explicit that verification is tested with
// the real `@noble/hashes` SHA-256 against a fixture with a precomputed digest:
// "a mocked hasher tests the plumbing and not the thing". The fake filesystem
// below holds real bytes, and the digest asserted is one this test computes
// from those bytes with the same library the production path uses.
//
// WHY A TRUNCATED FILE IS THE FAILURE THAT MATTERS. llama.cpp will happily mmap
// a short GGUF and decode noise rather than failing loudly (spec §2.3 rule 1),
// and on a finance app a confidently wrong assistant is strictly worse than one
// that will not start. So `ready` is unreachable except through `verifying`,
// and that is asserted as an illegal-transition throw rather than left as a
// comment.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { ModelSpec } from "../catalogue";
import {
  FREE_SPACE_SLACK_BYTES,
  IllegalTransitionError,
  assertTransition,
  createDownloader,
  meteredConfirmation,
  type FileStore,
  type HttpResponse,
} from "../downloader";

const MODELS_DIR = "file:///documents/models/";

const WEIGHTS = new Uint8Array(4096);
for (let i = 0; i < WEIGHTS.length; i += 1) WEIGHTS[i] = (i * 7) % 251;

const DIGEST = bytesToHex(sha256(WEIGHTS));

const SPEC: ModelSpec = {
  id: "test-tier",
  displayName: "Test Tier",
  params: "0.6B",
  quant: "Q4_K_M",
  bytes: WEIGHTS.length,
  sha256: DIGEST,
  url: "https://example.test/resolve/0000000000000000000000000000000000000000/model.gguf",
  minRamBytes: 1024 * 1024 * 1024,
  contextTokens: 2048,
  suppressThinking: true,
  license: "apache-2.0",
};

/** An in-memory filesystem that holds real bytes, so the real hasher can run. */
function createFakeFiles(freeSpace: number): FileStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    ensureDir: async () => {},
    exists: async (path) => files.has(path),
    size: async (path) => files.get(path)?.length ?? 0,
    append: async (path, chunk) => {
      const existing = files.get(path) ?? new Uint8Array(0);
      const next = new Uint8Array(existing.length + chunk.length);
      next.set(existing, 0);
      next.set(chunk, existing.length);
      files.set(path, next);
    },
    readChunks: async function* (path, chunkSize) {
      const bytes = files.get(path);
      if (!bytes) return;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      }
    },
    remove: async (path) => {
      files.delete(path);
    },
    rename: async (from, to) => {
      const bytes = files.get(from);
      if (bytes) {
        files.set(to, bytes);
        files.delete(from);
      }
    },
    freeSpace: async () => freeSpace,
  };
}

function respond(body: Uint8Array, status: number, extraHeaders: Record<string, string> = {}) {
  const headers = new Map<string, string>([
    ["content-length", String(body.length)],
    ...Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v] as [string, string]),
  ]);
  const response: HttpResponse = {
    status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    body: (async function* () {
      // Two chunks, so a partial write is representable.
      const half = Math.floor(body.length / 2);
      yield body.subarray(0, half);
      yield body.subarray(half);
    })(),
  };
  return response;
}

/** Records every request so "the fetch was never called" is assertable. */
function createFakeFetch(serve: (url: string, range: string | null) => HttpResponse) {
  const calls: { url: string; range: string | null }[] = [];
  const fetchLike = async (url: string, init?: { headers?: Record<string, string> }) => {
    const range = init?.headers?.Range ?? init?.headers?.range ?? null;
    calls.push({ url, range });
    return serve(url, range);
  };
  return { fetchLike, calls };
}

const NEVER_METERED = async () => false;

describe("the state machine", () => {
  test("an attempted downloading -> ready transition throws", () => {
    // The whole point of the machine. `ready` means "the bytes on disk have
    // been hashed and matched", and there is no path to that claim that skips
    // the hashing.
    expect(() => assertTransition("downloading", "ready")).toThrow(IllegalTransitionError);
  });

  test("ready is reachable from verifying", () => {
    expect(() => assertTransition("verifying", "ready")).not.toThrow();
  });

  test("a failed verification returns to absent", () => {
    expect(() => assertTransition("verifying", "absent")).not.toThrow();
  });

  test("absent cannot jump straight to ready or active", () => {
    expect(() => assertTransition("absent", "ready")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("absent", "active")).toThrow(IllegalTransitionError);
  });
});

describe("verification before activation", () => {
  test("a clean download verifies, renames the .part, and becomes ready", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const { fetchLike } = createFakeFetch(() => respond(WEIGHTS, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await downloader.download(SPEC);

    expect(await downloader.stateOf(SPEC)).toBe("ready");
    expect(files.files.has(`${MODELS_DIR}${SPEC.id}.gguf`)).toBe(true);
    expect(files.files.has(`${MODELS_DIR}${SPEC.id}.gguf.part`)).toBe(false);
  });

  test("a byte-corrupted fixture fails verification, returns to absent, and deletes the .part", async () => {
    const corrupted = Uint8Array.from(WEIGHTS);
    corrupted[corrupted.length - 1] ^= 0xff; // one flipped bit, the realistic failure

    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const { fetchLike } = createFakeFetch(() => respond(corrupted, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await expect(downloader.download(SPEC)).rejects.toThrow(/digest|verif/i);

    expect(await downloader.stateOf(SPEC)).toBe("absent");
    expect(files.files.has(`${MODELS_DIR}${SPEC.id}.gguf`)).toBe(false);
    expect(files.files.has(`${MODELS_DIR}${SPEC.id}.gguf.part`)).toBe(false);
  });

  test("a .part file is not a load candidate on the next launch", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    files.files.set(`${MODELS_DIR}${SPEC.id}.gguf.part`, WEIGHTS.subarray(0, 100));
    const { fetchLike } = createFakeFetch(() => respond(WEIGHTS, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    expect(await downloader.loadCandidatePath(SPEC)).toBeNull();
    expect(await downloader.stateOf(SPEC)).toBe("downloading");
  });

  test("a Content-Length that disagrees with the catalogue is rejected before hashing", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const short = WEIGHTS.subarray(0, 2048);
    const { fetchLike } = createFakeFetch(() => respond(short, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await expect(downloader.download(SPEC)).rejects.toThrow(/length/i);
    expect(files.files.has(`${MODELS_DIR}${SPEC.id}.gguf`)).toBe(false);
  });

  test("a response it refuses to read is aborted, not left to arrive in full", async () => {
    // `expo/fetch` keeps pulling a body nobody reads. Without the abort, the
    // refusal above would still spend the whole file's worth of mobile data.
    const signals: (AbortSignal | undefined)[] = [];
    const downloader = createDownloader({
      fetch: async (_url, init) => {
        signals.push(init?.signal);
        return respond(WEIGHTS.subarray(0, 2048), 200);
      },
      files: createFakeFiles(10 * 1024 * 1024 * 1024),
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await expect(downloader.download(SPEC)).rejects.toThrow(/length/i);

    expect(signals.map((signal) => signal?.aborted)).toEqual([true]);
  });
});

describe("resume", () => {
  test("sends Range: bytes=n- and the assembled file is byte-identical to a fresh download", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const partial = WEIGHTS.subarray(0, 1000);
    files.files.set(`${MODELS_DIR}${SPEC.id}.gguf.part`, Uint8Array.from(partial));

    const { fetchLike, calls } = createFakeFetch((_url, range) => {
      expect(range).toBe("bytes=1000-");
      return respond(WEIGHTS.subarray(1000), 206, {
        "content-range": `bytes 1000-${WEIGHTS.length - 1}/${WEIGHTS.length}`,
      });
    });

    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await downloader.download(SPEC);

    expect(calls[0].range).toBe("bytes=1000-");
    expect(files.files.get(`${MODELS_DIR}${SPEC.id}.gguf`)).toEqual(WEIGHTS);
  });

  test("across a restart the offset comes from disk, not from memory", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    files.files.set(`${MODELS_DIR}${SPEC.id}.gguf.part`, Uint8Array.from(WEIGHTS.subarray(0, 2500)));

    // The downloader object that started the download is GONE — this is a
    // fresh process. If the offset were held in memory it would be 0 here and
    // the resumed file would be 2500 bytes too long.
    const { fetchLike, calls } = createFakeFetch(() =>
      respond(WEIGHTS.subarray(2500), 206, {
        "content-range": `bytes 2500-${WEIGHTS.length - 1}/${WEIGHTS.length}`,
      }),
    );
    const rebuilt = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await rebuilt.download(SPEC);

    expect(calls[0].range).toBe("bytes=2500-");
    expect(files.files.get(`${MODELS_DIR}${SPEC.id}.gguf`)).toEqual(WEIGHTS);
  });

  test("a server that ignores Range and answers 200 restarts cleanly rather than concatenating", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    files.files.set(`${MODELS_DIR}${SPEC.id}.gguf.part`, Uint8Array.from(WEIGHTS.subarray(0, 1000)));

    const { fetchLike } = createFakeFetch(() => respond(WEIGHTS, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await downloader.download(SPEC);

    // Concatenating would produce 5096 bytes and a digest mismatch. The bytes
    // must be exactly the file.
    expect(files.files.get(`${MODELS_DIR}${SPEC.id}.gguf`)).toEqual(WEIGHTS);
  });
});

describe("free space", () => {
  test("refusal happens BEFORE any request", async () => {
    // "A check that runs after 2 GB has already landed is not a check."
    const files = createFakeFiles(SPEC.bytes + 10);
    const { fetchLike, calls } = createFakeFetch(() => respond(WEIGHTS, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await expect(downloader.download(SPEC)).rejects.toThrow(/space/i);
    expect(calls).toHaveLength(0);
  });

  test("the slack is required on top of the file, not counted inside it", () => {
    // The slack is not for the file; Android becomes unstable near zero free
    // space and the user still needs room for photos.
    expect(FREE_SPACE_SLACK_BYTES).toBe(500 * 1024 * 1024);
  });
});

describe("metered networks", () => {
  test("no request on a metered network without the explicit override", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const { fetchLike, calls } = createFakeFetch(() => respond(WEIGHTS, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: async () => true,
    });

    await expect(downloader.download(SPEC)).rejects.toThrow(/mobile data/i);
    expect(calls).toHaveLength(0);
  });

  test("the explicit override lets it through", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const { fetchLike, calls } = createFakeFetch(() => respond(WEIGHTS, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: async () => true,
    });

    await downloader.download(SPEC, { allowMetered: true });
    expect(calls).toHaveLength(1);
  });

  test("the confirmation states the size in the sentence", () => {
    // "3.3 GB on a Philippine prepaid plan is real money, and a user who taps
    // through a generic 'Continue?' has not been asked."
    const real: ModelSpec = { ...SPEC, bytes: 1107409472 };
    expect(meteredConfirmation(real)).toContain("1.1 GB");
    expect(meteredConfirmation(real)).toMatch(/mobile data/i);
  });
});

describe("redirects", () => {
  test("a cross-host https redirect is followed, because the happy path needs it", async () => {
    // Verified 2026-08-31: a `resolve/<sha>/` URL answers 302 to a Hugging Face
    // CDN host, and only that second hop returns 200. An implementation that
    // refused cross-host redirects would fail every download.
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const { fetchLike, calls } = createFakeFetch((url) =>
      url === SPEC.url
        ? {
            status: 302,
            headers: { get: (name) => (name.toLowerCase() === "location" ? "https://cdn.test/x" : null) },
            body: (async function* () {})(),
          }
        : respond(WEIGHTS, 200),
    );
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await downloader.download(SPEC);
    expect(calls.map((call) => call.url)).toEqual([SPEC.url, "https://cdn.test/x"]);
  });

  test("a redirect that leaves https is refused", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const { fetchLike } = createFakeFetch(() => ({
      status: 302,
      headers: { get: (name) => (name.toLowerCase() === "location" ? "http://cdn.test/x" : null) },
      body: (async function* () {})(),
    }));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await expect(downloader.download(SPEC)).rejects.toThrow(/https/i);
  });

  test("a redirect loop terminates instead of hanging", async () => {
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    const { fetchLike } = createFakeFetch(() => ({
      status: 302,
      headers: { get: (name) => (name.toLowerCase() === "location" ? "https://cdn.test/loop" : null) },
      body: (async function* () {})(),
    }));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await expect(downloader.download(SPEC)).rejects.toThrow(/redirect/i);
  });
});

describe("deleting a model", () => {
  test("removes both the finished file and any partial", async () => {
    // "Downloading gigabytes with no visible way to reclaim them is the kind of
    // thing that gets a finance app uninstalled."
    const files = createFakeFiles(10 * 1024 * 1024 * 1024);
    files.files.set(`${MODELS_DIR}${SPEC.id}.gguf`, WEIGHTS);
    files.files.set(`${MODELS_DIR}${SPEC.id}.gguf.part`, WEIGHTS.subarray(0, 10));
    const { fetchLike } = createFakeFetch(() => respond(WEIGHTS, 200));
    const downloader = createDownloader({
      fetch: fetchLike,
      files,
      modelsDir: MODELS_DIR,
      isMetered: NEVER_METERED,
    });

    await downloader.remove(SPEC);

    expect(files.files.size).toBe(0);
    expect(await downloader.stateOf(SPEC)).toBe("absent");
  });
});
