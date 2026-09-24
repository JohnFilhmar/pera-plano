// mobile/lib/ai/downloader.ts
//
// RESUMABLE, VERIFIED, WIFI-GATED. Spec §2.3 plus the hardening in
// `docs/superpowers/specs/2026-08-31-model-hosting-decision.md` §4.
//
// THE ONE RULE THIS FILE EXISTS FOR: `ready` is unreachable except through
// `verifying`. A truncated GGUF does not fail loudly — llama.cpp will happily
// mmap a short file and decode noise — so an unverified model is not a broken
// assistant, it is a CONFIDENTLY WRONG one, which on a finance app is strictly
// worse than one that will not start. The download writes `<id>.gguf.part`, and
// the rename to `<id>.gguf` happens ONLY after the digest matches. That rename
// is the atomic activation step, and a `.part` file is never a load candidate.
//
// THE BYTES VERIFIED ARE THE BYTES ON DISK, never the stream in flight. A
// partial-write or truncated-flush bug must not be able to pass verification:
// the thing hashed has to be the thing that will later be mmap'd.
//
// EVERYTHING IS INJECTED — fetch, the filesystem, the metered-network reader —
// because this module's whole job is failure handling, and failures that only
// happen on a real 1.1 GB transfer over Philippine prepaid data are failures
// that never get tested. The production adapters are thin and live in
// `model_files.ts` and `model_transfer.ts`, and there is no
// network-reachability package in `package.json` yet, so `isMetered` is the
// seam where one lands.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { ModelSpec } from "./catalogue";

export type DownloadState = "absent" | "downloading" | "verifying" | "ready" | "active";

/**
 * The slack is NOT for the file. Android becomes unstable near zero free space
 * and the user still needs room for photos.
 */
export const FREE_SPACE_SLACK_BYTES = 500 * 1024 * 1024;

/** Hashing reads the file back in pieces; a 1.1 GB `Uint8Array` is not an option. */
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * Hashing hands the JS thread back after this many pieces. `for await` resumes
 * as a microtask, and a chain of microtasks never lets a timer, a touch or a
 * frame in, so without a real yield the digest holds the thread for its whole
 * run.
 */
// ponytail: a fixed slice of 4 MiB. If docs/13 Gate 7 still shows jank or too
// long a digest, spec §6 risk 8's native digest replaces this loop.
const YIELD_EVERY_PIECES = 4;

/** Hugging Face answers a pinned URL with a 302 to a CDN host. One hop is normal, five is a loop. */
const MAX_REDIRECTS = 5;

const LEGAL_TRANSITIONS: Record<DownloadState, readonly DownloadState[]> = {
  absent: ["downloading"],
  // A resume re-enters `downloading`; a cancel or a failure drops to `absent`.
  downloading: ["downloading", "verifying", "absent"],
  // The only two ways out of verification: the digest matched, or it did not.
  verifying: ["ready", "absent"],
  ready: ["active", "absent"],
  active: ["ready", "absent"],
};

export class IllegalTransitionError extends Error {
  constructor(from: DownloadState, to: DownloadState) {
    super(`illegal download transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * Asserted, not commented. The transition that must never exist is
 * `downloading -> ready`: it is the one that would ship unverified weights.
 */
export function assertTransition(from: DownloadState, to: DownloadState): void {
  if (!LEGAL_TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(from, to);
}

export type HttpResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array>;
};

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<HttpResponse>;

export type FileStore = {
  ensureDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** The resume offset comes from HERE, so it survives a process kill. */
  size(path: string): Promise<number>;
  append(path: string, chunk: Uint8Array): Promise<void>;
  readChunks(path: string, chunkSize: number): AsyncIterable<Uint8Array>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  freeSpace(): Promise<number>;
};

export type DownloaderDeps = {
  fetch: FetchLike;
  files: FileStore;
  /** `FileSystem.documentDirectory + "models/"` in production. */
  modelsDir: string;
  isMetered: () => Promise<boolean>;
};

export type DownloadOptions = {
  /** The user was asked, in a sentence containing the size, and said yes. */
  allowMetered?: boolean;
  onProgress?: (received: number, total: number) => void;
  /** Called once, when every byte is on disk and hashing starts. */
  onVerifying?: () => void;
};

export class MeteredNetworkError extends Error {}
export class InsufficientSpaceError extends Error {}
export class VerificationError extends Error {}
export class ContentLengthError extends Error {}
export class RedirectError extends Error {}
export class HttpStatusError extends Error {}

/**
 * Transfers in progress, keyed by the model's final path. Module scope on
 * purpose: each screen builds its own downloader, and two of them appending to
 * one `.part` make a file the digest rejects, which throws away every byte the
 * user already paid for.
 */
const inFlight = new Map<string, Promise<void>>();

/** Resolves on a later macrotask, so whatever is already queued on the JS thread runs first. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Decimal GB, because that is what a data plan is sold in.
 *
 * Exported so the Privacy centre's "reclaim this space" copy and the download
 * confirmation cannot drift into quoting the same file at two different sizes.
 */
export function formatSize(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * The confirmation names the size IN THE SENTENCE. A generic "Continue?" has
 * not asked: 1.1 GB on a Philippine prepaid plan is real money.
 */
export function meteredConfirmation(spec: ModelSpec): string {
  return `Download ${formatSize(spec.bytes)} over mobile data?`;
}

export type Downloader = {
  stateOf(spec: ModelSpec): Promise<DownloadState>;
  /** The path to load, or null. A `.part` is never a candidate. */
  loadCandidatePath(spec: ModelSpec): Promise<string | null>;
  /**
   * Gets the model onto disk and verified, resuming any `.part`. A call for a
   * model whose transfer is already running joins that transfer instead of
   * starting another, and its own options are ignored.
   */
  download(spec: ModelSpec, opts?: DownloadOptions): Promise<void>;
  remove(spec: ModelSpec): Promise<void>;
};

export function createDownloader(deps: DownloaderDeps): Downloader {
  const finalPath = (spec: ModelSpec) => `${deps.modelsDir}${spec.id}.gguf`;
  const partPath = (spec: ModelSpec) => `${finalPath(spec)}.part`;

  async function stateOf(spec: ModelSpec): Promise<DownloadState> {
    if (await deps.files.exists(finalPath(spec))) return "ready";
    if (await deps.files.exists(partPath(spec))) return "downloading";
    return "absent";
  }

  async function loadCandidatePath(spec: ModelSpec): Promise<string | null> {
    // Deliberately does not consider the `.part`. An unverified file is not a
    // model, however many bytes of it are present.
    return (await deps.files.exists(finalPath(spec))) ? finalPath(spec) : null;
  }

  /**
   * Follows redirects by hand so the https-only rule is ours to enforce.
   *
   * The rule is https-only and deliberately NOT same-host: verified 2026-08-31,
   * a pinned `resolve/<sha>/` URL answers 302 to a Hugging Face CDN host, and
   * only that second hop returns 200. Refusing cross-host redirects would fail
   * every download on the happy path.
   */
  async function fetchFollowing(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<HttpResponse> {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await deps.fetch(target, { headers, signal });
      if (response.status < 300 || response.status >= 400) return response;

      const location = response.headers.get("location");
      if (!location) throw new RedirectError(`redirect with no location from ${target}`);
      if (!location.startsWith("https:")) {
        throw new RedirectError(`refusing a redirect that leaves https: ${location}`);
      }
      target = location;
    }
    throw new RedirectError(`too many redirects starting at ${url}`);
  }

  /** Hashes the file AS WRITTEN TO DISK, in pieces, yielding the JS thread between slices. */
  async function digestOnDisk(path: string): Promise<string> {
    const hasher = sha256.create();
    let pieces = 0;
    for await (const chunk of deps.files.readChunks(path, HASH_CHUNK_BYTES)) {
      hasher.update(chunk);
      pieces += 1;
      if (pieces % YIELD_EVERY_PIECES === 0) await yieldToEventLoop();
    }
    return bytesToHex(hasher.digest());
  }

  /**
   * Appends the bytes the `.part` is missing from `offset` on, refusing before
   * the first byte whenever the transfer cannot or must not finish.
   */
  async function fetchRemainder(
    spec: ModelSpec,
    offset: number,
    opts: DownloadOptions,
  ): Promise<void> {
    const part = partPath(spec);
    let start = offset;

    // BOTH REFUSALS HAPPEN BEFORE THE FIRST BYTE. A check that runs after 2 GB
    // has already landed is not a check.
    const needed = spec.bytes - start + FREE_SPACE_SLACK_BYTES;
    if ((await deps.files.freeSpace()) < needed) {
      throw new InsufficientSpaceError(
        `not enough free space for ${spec.id}: needs ${needed} bytes including slack`,
      );
    }

    if (!opts.allowMetered && (await deps.isMetered())) {
      throw new MeteredNetworkError(meteredConfirmation(spec));
    }

    const headers: Record<string, string> = start > 0 ? { Range: `bytes=${start}-` } : {};
    // Aborted the moment this attempt is done with the network, however it
    // ends. `expo/fetch` keeps pulling a body nobody reads, so a response
    // abandoned on a refusal below would otherwise still arrive in full.
    const transfer = new AbortController();
    try {
      const response = await fetchFollowing(spec.url, headers, transfer.signal);

      if (start > 0 && response.status === 200) {
        // The server ignored the Range and is sending the whole file. Appending
        // would concatenate a prefix onto a complete file and fail verification
        // for a reason no log would explain. Start clean.
        await deps.files.remove(part);
        start = 0;
      }

      // A 404 or 500 page of the right length would otherwise land in the
      // .part, and only the digest would notice, after the data was spent.
      const expectedStatus = start > 0 ? 206 : 200;
      if (response.status !== expectedStatus) {
        throw new HttpStatusError(
          `HTTP ${response.status} for ${spec.id}, expected ${expectedStatus}`,
        );
      }

      // Rejects the common failure early instead of after streaming gigabytes.
      const contentLength = Number(response.headers.get("content-length"));
      const expected = spec.bytes - start;
      if (!Number.isFinite(contentLength) || contentLength !== expected) {
        throw new ContentLengthError(
          `content-length ${contentLength} for ${spec.id}, expected ${expected}`,
        );
      }

      let received = start;
      for await (const chunk of response.body) {
        await deps.files.append(part, chunk);
        received += chunk.length;
        opts.onProgress?.(received, spec.bytes);
      }
    } finally {
      transfer.abort();
    }
  }

  // One attempt at getting the model onto disk and verified: trust the .part
  // only as far as it can be a prefix, fetch what is missing, then hash.
  async function runDownload(spec: ModelSpec, opts: DownloadOptions): Promise<void> {
    if ((await stateOf(spec)) === "ready") return;

    await deps.files.ensureDir(deps.modelsDir);

    const part = partPath(spec);
    let offset = (await deps.files.exists(part)) ? await deps.files.size(part) : 0;

    if (offset > spec.bytes) {
      // Longer than the model, so it cannot be a prefix of it. Resuming past
      // the end earns a 416 from the CDN on every retry.
      await deps.files.remove(part);
      offset = 0;
    }

    // A .part already at full length was killed during verification. It needs
    // a hash, not a request, and not a prompt to spend data on zero bytes.
    if (offset < spec.bytes) await fetchRemainder(spec, offset, opts);

    assertTransition("downloading", "verifying");
    opts.onVerifying?.();

    if ((await digestOnDisk(part)) !== spec.sha256) {
      // Back to `absent`, and the partial is DELETED rather than kept for a
      // resume: a file that hashed wrong is not a prefix of a good download,
      // and resuming it would fail forever at the same byte.
      await deps.files.remove(part);
      assertTransition("verifying", "absent");
      throw new VerificationError(`digest mismatch for ${spec.id}; the download was discarded`);
    }

    assertTransition("verifying", "ready");
    // The atomic activation step.
    await deps.files.rename(part, finalPath(spec));
  }

  function download(spec: ModelSpec, opts: DownloadOptions = {}): Promise<void> {
    // Checked and claimed synchronously, before any await, so a second tap in
    // the same tick cannot slip past the guard.
    const key = finalPath(spec);
    const running = inFlight.get(key);
    if (running !== undefined) return running;

    const attempt = runDownload(spec, opts).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, attempt);
    return attempt;
  }

  async function remove(spec: ModelSpec): Promise<void> {
    await deps.files.remove(finalPath(spec));
    await deps.files.remove(partPath(spec));
  }

  return { stateOf, loadCandidatePath, download, remove };
}
