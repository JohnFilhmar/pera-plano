// mobile/test_support/expo_file_system_memory_mock.ts
//
// An in-memory disk for BOTH `expo-file-system` entry points: the SDK 54 File
// API that the model transfer writes and reads through, and the legacy calls
// the rest of the model store uses. One `memoryDisk` behind both, so bytes
// written by one API are the bytes the other sees, as on a phone. It holds real
// bytes, so the downloader's real SHA-256 runs over what was actually written.
//
// The project-wide mocks in `jest_setup.ts` stay inert and stay the default. A
// suite that needs this disk registers it for each entry point it reaches:
//
//   jest.mock("expo-file-system", () => require("@/test_support/expo_file_system_memory_mock"));
//   jest.mock("expo-file-system/legacy", () => require("@/test_support/expo_file_system_memory_mock"));
//
// IT FOLLOWS THE DOCUMENTED CONTRACT, NOT ANDROID'S LENIENCE. `File.open()`
// throws on a missing file and `create()` throws on an existing one, as the
// typings say, so an adapter that skips either step fails here and not on a
// phone. There is no `bytes()` or `text()`: a whole-file read of a model is
// the thing the transfer must never do, and here it fails as a missing method.

/** The disk, by `file://` URI. Module state: call `resetMemoryDisk` in `beforeEach`. */
export const memoryDisk = new Map<string, Uint8Array>();

/** Every length passed to `FileHandle.readBytes`, in call order. */
export const readRequests: number[] = [];

let openHandles = 0;
let nextWriteLimit: number | null = null;

/** Handles opened and not yet closed. Anything above zero after a transfer is a leak. */
export function openHandleCount(): number {
  return openHandles;
}

/**
 * Makes the next `writeBytes` store only its first `bytes` bytes and return
 * normally, which is how Android's file channel behaves on a full disk.
 */
export function shortenNextWrite(bytes: number): void {
  nextWriteLimit = bytes;
}

/** Empties the disk and the read log, and forgets open handles and write limits. */
export function resetMemoryDisk(): void {
  memoryDisk.clear();
  readRequests.length = 0;
  openHandles = 0;
  nextWriteLimit = null;
}

function contentsOf(uri: string): Uint8Array {
  const bytes = memoryDisk.get(uri);
  if (bytes === undefined) throw new Error(`no such file: ${uri}`);
  return bytes;
}

/** A positioned read/write handle over one file, like `FileHandle`. */
class MemoryFileHandle {
  offset: number | null = 0;

  constructor(private readonly uri: string) {}

  get size(): number | null {
    return contentsOf(this.uri).length;
  }

  readBytes(length: number): Uint8Array {
    readRequests.push(length);
    const bytes = contentsOf(this.uri);
    const at = this.offset ?? 0;
    const piece = bytes.slice(at, Math.min(at + length, bytes.length));
    this.offset = at + piece.length;
    return piece;
  }

  writeBytes(chunk: Uint8Array): void {
    const written = nextWriteLimit === null ? chunk : chunk.subarray(0, nextWriteLimit);
    nextWriteLimit = null;
    const bytes = contentsOf(this.uri);
    const at = this.offset ?? 0;
    const next = new Uint8Array(Math.max(bytes.length, at + written.length));
    next.set(bytes, 0);
    next.set(written, at);
    memoryDisk.set(this.uri, next);
    this.offset = at + written.length;
  }

  close(): void {
    openHandles -= 1;
  }
}

/** The subset of the SDK 54 `File` class the model transfer uses. */
export class File {
  uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  get exists(): boolean {
    return memoryDisk.has(this.uri);
  }

  create(): void {
    if (memoryDisk.has(this.uri)) throw new Error(`already exists: ${this.uri}`);
    memoryDisk.set(this.uri, new Uint8Array(0));
  }

  open(): MemoryFileHandle {
    contentsOf(this.uri);
    openHandles += 1;
    return new MemoryFileHandle(this.uri);
  }
}

/** Legacy `documentDirectory`, so a `MODELS_DIR` built from it lands on this disk. */
export const documentDirectory = "file:///memory/";

/** Legacy `getInfoAsync`: whether the file exists and, if it does, its size. */
export async function getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }> {
  const bytes = memoryDisk.get(uri);
  return bytes === undefined ? { exists: false } : { exists: true, size: bytes.length };
}

/** Legacy `makeDirectoryAsync`. Directories are implicit on this disk. */
export async function makeDirectoryAsync(): Promise<void> {}

/** Legacy `deleteAsync`, always idempotent, as every caller in the model store asks. */
export async function deleteAsync(uri: string): Promise<void> {
  memoryDisk.delete(uri);
}

/** Legacy `moveAsync`. */
export async function moveAsync({ from, to }: { from: string; to: string }): Promise<void> {
  memoryDisk.set(to, contentsOf(from));
  memoryDisk.delete(from);
}

/** Legacy `getFreeDiskStorageAsync`: 50 GB, room for any test model plus the slack. */
export async function getFreeDiskStorageAsync(): Promise<number> {
  return 50_000_000_000;
}
