// mobile/lib/ai/model_transfer.ts
//
// THE BYTE TRANSFER BEHIND `createProductionDeps`: `expo/fetch` for a response
// body that can be read as it arrives, and the SDK 54 `File` API for the one
// thing `expo-file-system/legacy` cannot do, an append at the end of a file.
// The digest is native (`modules/llama_bridge/digest.ts`), and everything else
// the downloader needs stays on the legacy store in `model_files.ts`, the same
// split `lib/support/attachments.ts` makes.
//
// `expo/fetch` IS REQUIRED ON FIRST USE, NOT IMPORTED. Its module subclasses a
// native class while loading, and under jest-expo that class does not exist,
// so a top-level import would crash every suite that imports `model_files.ts`
// without ever downloading anything. A plain `require` rather than `import()`,
// because this repo's Jest transform leaves `import()` for Node to reject.
//
// NATIVE FETCH PUSHES, IT DOES NOT WAIT. On Android `expo/fetch` hands JS each
// OkHttp read (about 8 KB) as an event and queues it whether or not anything
// is reading, so the only bound on memory is the consumer keeping up. The body
// therefore reaches the downloader in blocks of about 1 MiB, which means one
// disk write and one progress update per block instead of 128 of each.
import { File } from "expo-file-system";

import type { FetchLike } from "./downloader";

const BLOCK_BYTES = 1024 * 1024;

/** Joins streamed pieces into one block. */
function joined(parts: readonly Uint8Array[], total: number): Uint8Array {
  const block = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    block.set(part, at);
    at += part.length;
  }
  return block;
}

/** Re-chunks a streamed body into blocks of about `BLOCK_BYTES`, gathering one block at a time. */
async function* inBlocks(response: {
  body: ReadableStream<Uint8Array> | null;
}): AsyncGenerator<Uint8Array> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending.push(value);
    pendingBytes += value.length;
    if (pendingBytes >= BLOCK_BYTES) {
      yield joined(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
    }
  }
  if (pendingBytes > 0) yield joined(pending, pendingBytes);
}

/**
 * Sends a GET through `expo/fetch`, the fetch in this app whose body streams.
 *
 * Redirects come back unfollowed, because the downloader follows them itself
 * to hold every hop to https, and it resends the same headers on each hop, so a
 * resume's `Range` reaches the Hugging Face CDN host. It sends and stores no
 * cookies, since a public model download has no use for them.
 *
 * @param url - The https URL to request.
 * @param init - `headers` carries a resume's `Range`; `signal` aborts the transfer.
 * @returns The status and headers as received, and the body as blocks of about 1 MiB.
 * @throws When no response arrives at all: no network, DNS, TLS, or an abort.
 */
export const streamingFetch: FetchLike = async (url, init) => {
  const { fetch }: typeof import("expo/fetch") = require("expo/fetch");
  const response = await fetch(url, {
    headers: init?.headers,
    signal: init?.signal,
    redirect: "manual",
    credentials: "omit",
  });
  return { status: response.status, headers: response.headers, body: inBlocks(response) };
};

/**
 * Writes `chunk` at the end of the file at `path`, creating the file first if needed.
 *
 * The write is positioned at the file's own size rather than truncating it, so
 * a partial that survived a process kill is extended, never overwritten.
 *
 * @param path - A `file://` URI.
 * @param chunk - The bytes to add. An empty chunk leaves the file unchanged.
 * @throws When the file cannot be created or opened, or its size cannot be read.
 *   Writing at an unknown offset could overwrite the partial, so it is refused.
 * @throws When the disk takes fewer bytes than it was given. Android's file
 *   channel reports a full disk that way instead of failing, and the next
 *   append would land at the wrong offset. Stopping here leaves a clean prefix
 *   to resume from.
 */
export async function appendBytes(path: string, chunk: Uint8Array): Promise<void> {
  const file = new File(path);
  if (!file.exists) file.create();
  const handle = file.open();
  try {
    const end = handle.size;
    if (end === null) {
      throw new Error(`cannot read the size of ${path}, so there is no safe offset to write at`);
    }
    handle.offset = end;
    handle.writeBytes(chunk);
    if (handle.offset !== end + chunk.length) {
      throw new Error(`short write to ${path}; the disk may be full`);
    }
  } finally {
    handle.close();
  }
}
