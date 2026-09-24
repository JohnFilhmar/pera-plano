// lib/support/__tests__/attachments.test.ts — the caps, and the copy that
// makes an attachment survive until the report is delivered.
//
// `expo-file-system` is a native module Jest cannot require, so it is mocked
// here — the same treatment `lib/privacy/__tests__/data_export.test.ts` and
// `lib/reports/__tests__/csv_export.test.ts` give it.
// AN IN-MEMORY FILESYSTEM, NOT AN INERT ONE (GAP-072). The bytes on disk are
// now AES-GCM ciphertext, so "was the file copied" is no longer the question —
// "are the bytes at rest unreadable, and do they come back intact" is. That
// cannot be asserted against a mock that remembers nothing, so this suite keeps
// a real `Map` and runs the REAL cipher over it.
const files = new Map<string, Uint8Array>();

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
  readDirectoryAsync: jest.fn(async (directory: string) =>
    [...mockFiles.keys()]
      .filter((uri) => uri.startsWith(directory))
      .map((uri) => uri.slice(directory.length)),
  ),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1024 })),
}));

jest.mock("expo-file-system", () => ({
  // A plain field, never a `public readonly` parameter property —
  // babel-plugin-jest-hoist reads the annotation as an out-of-scope variable
  // and refuses the factory outright.
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async bytes(): Promise<Uint8Array> {
      const found = mockFiles.get(this.uri);
      if (found === undefined) throw new Error(`ENOENT: ${this.uri}`);
      return found;
    }
    write(content: Uint8Array): void {
      mockFiles.set(this.uri, new Uint8Array(content));
    }
  },
}));

// `mock`-prefixed so babel-plugin-jest-hoist allows the factories above to
// close over it.
const mockFiles = files;

import * as FileSystem from "expo-file-system/legacy";

import { clearAttachmentKey, setAttachmentKey } from "@/lib/crypto/attachment_cipher";
import type { NewSupportReportAttachment } from "@/types/support";

import {
  AttachmentTooLargeError,
  MAX_SUPPORT_ATTACHMENTS,
  MAX_SUPPORT_ATTACHMENTS_TOTAL_BYTES,
  MAX_SUPPORT_ATTACHMENT_BYTES,
  cleanupDecryptedAttachments,
  decryptAttachmentToTempFile,
  deleteSupportAttachmentFiles,
  persistSupportAttachment,
  sweepOrphanedAttachments,
} from "../attachments";

const getInfo = FileSystem.getInfoAsync as jest.Mock;
const copy = FileSystem.copyAsync as jest.Mock;
const remove = FileSystem.deleteAsync as jest.Mock;

/** A fixed, non-secret key — the same shape `test_support/db.ts` uses for the DEK. */
const TEST_KEY = new Uint8Array(32).fill(0x42);

/** Recognisable plaintext, so a test asserting "this is not on disk" is
 * asserting against something that would be unmistakable if it were. */
const SECRET_BYTES = new TextEncoder().encode("GCash: you received PHP 5,000.00 from JUAN DELA CRUZ");

function attached(byteSize: number, index: number): NewSupportReportAttachment {
  return { fileUri: `file:///docs/support_attachments/${index}.enc`, mimeType: "image/png", byteSize };
}

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  setAttachmentKey(TEST_KEY);
  getInfo.mockResolvedValue({ exists: true, size: 1024 });
  remove.mockImplementation(async (uri: string) => {
    files.delete(uri);
  });
  files.set("file:///cache/ImagePicker/abc.jpg", SECRET_BYTES);
  files.set("file:///cache/Screenshot.png", SECRET_BYTES);
});

afterEach(() => {
  clearAttachmentKey();
});

test("a picked file lands in the document directory as .enc, never as a verbatim copy", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );

  expect(stored.fileUri.startsWith("file:///docs/support_attachments/")).toBe(true);
  // `.enc`, not `.jpg`: the bytes are ciphertext, and naming them `.jpg` would
  // be a lie some gallery scanner or share-sheet handler would act on.
  expect(stored.fileUri.endsWith(".enc")).toBe(true);
  // The plaintext copy is gone from the design entirely — a copy-then-encrypt
  // would have written the readable bytes to durable storage first.
  expect(copy).not.toHaveBeenCalled();
  // `byteSize` stays the PLAINTEXT size, because that is what the caps were
  // measured against and what the user is shown.
  expect(stored.byteSize).toBe(1024);
});

// THE LOAD-BEARING ASSERTION OF THIS WHOLE ENTRY. docs/12 §4 claims a rooted
// device or an unencrypted backup sees only ciphertext; before this, a
// screenshot of a bank notification sat there in plain bytes.
test("the bytes at rest are ciphertext -- the plaintext is nowhere on disk", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );

  const onDisk = files.get(stored.fileUri);
  expect(onDisk).toBeDefined();
  expect(Array.from(onDisk!)).not.toEqual(Array.from(SECRET_BYTES));
  // Not merely "different bytes": the readable string is absent outright.
  const asText = new TextDecoder().decode(onDisk!);
  expect(asText).not.toContain("JUAN DELA CRUZ");
  expect(asText).not.toContain("5,000.00");
  // Longer than the plaintext by exactly the nonce and the GCM tag.
  expect(onDisk!.length).toBe(SECRET_BYTES.length + 12 + 16);
});

test("what comes back out of the temp file is the original bytes, exactly", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );

  const tempUri = await decryptAttachmentToTempFile(stored.fileUri);

  expect(tempUri.startsWith("file:///cache/support_attachments_tmp/")).toBe(true);
  expect(Array.from(files.get(tempUri)!)).toEqual(Array.from(SECRET_BYTES));
});

test("a locked app cannot read an attachment back, and says so rather than returning garbage", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );
  clearAttachmentKey();

  await expect(decryptAttachmentToTempFile(stored.fileUri)).rejects.toThrow(
    /attachment cipher key is not set/,
  );
});

test("a tampered file fails authentication instead of yielding altered bytes", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );
  const onDisk = files.get(stored.fileUri)!;
  onDisk[onDisk.length - 1] ^= 0xff;

  await expect(decryptAttachmentToTempFile(stored.fileUri)).rejects.toThrow(
    /could not be decrypted/,
  );
});

test("decrypted temp files are removed, and removing them never throws", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );
  const tempUri = await decryptAttachmentToTempFile(stored.fileUri);
  expect(files.has(tempUri)).toBe(true);

  await cleanupDecryptedAttachments([tempUri]);
  expect(files.has(tempUri)).toBe(false);

  remove.mockRejectedValueOnce(new Error("EACCES"));
  await expect(cleanupDecryptedAttachments([tempUri])).resolves.toBeUndefined();
});

// The sweep is what makes the best-effort teardown survivable: a process killed
// on the report screen leaks files no row points at, and before this there was
// no sweep at all, so they stayed until the app was uninstalled.
test("the sweep removes files no row points at, and keeps the ones that are referenced", async () => {
  const keep = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );
  const orphan = await persistSupportAttachment(
    { uri: "file:///cache/Screenshot.png", mimeType: "image/png" },
    [keep],
  );

  const { removed } = await sweepOrphanedAttachments([keep.fileUri]);

  expect(removed).toBe(1);
  expect(files.has(keep.fileUri)).toBe(true);
  expect(files.has(orphan.fileUri)).toBe(false);
});

// A decrypted temp file is never referenced by a row, so any that survives a
// send is garbage by definition -- and it is PLAINTEXT, which is why it is
// swept unconditionally rather than matched against the reference list.
test("the sweep removes every decrypted temp file, referenced list or not", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );
  const stranded = await decryptAttachmentToTempFile(stored.fileUri);

  const { removed } = await sweepOrphanedAttachments([stored.fileUri]);

  expect(removed).toBe(1);
  expect(files.has(stranded)).toBe(false);
  expect(files.has(stored.fileUri)).toBe(true);
});

// Two screenshots taken a second apart share a filename on many Android
// devices; a copy that kept the original name would overwrite the first.
test("two files picked from the same original name get distinct stored paths", async () => {
  const first = await persistSupportAttachment(
    { uri: "file:///cache/Screenshot.png", mimeType: "image/png" },
    [],
  );
  const second = await persistSupportAttachment(
    { uri: "file:///cache/Screenshot.png", mimeType: "image/png" },
    [first],
  );

  expect(first.fileUri).not.toBe(second.fileUri);
});

/** Files written into the durable attachment directory, which is what a cap is
 * really protecting. Asserting on `copyAsync` stopped meaning anything once the
 * copy was replaced by an encrypt-and-write. */
function storedCount(): number {
  return [...files.keys()].filter((uri) => uri.startsWith("file:///docs/support_attachments/"))
    .length;
}

test("a file over the per-file cap is refused before anything is written", async () => {
  getInfo.mockResolvedValue({ exists: true, size: MAX_SUPPORT_ATTACHMENT_BYTES + 1 });

  await expect(
    persistSupportAttachment({ uri: "file:///cache/huge.mp4", mimeType: "video/mp4" }, []),
  ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  expect(storedCount()).toBe(0);
});

test("a file that would put the report over the total cap is refused", async () => {
  getInfo.mockResolvedValue({ exists: true, size: 5 * 1024 * 1024 });
  const already = [
    attached(MAX_SUPPORT_ATTACHMENTS_TOTAL_BYTES - 1024 * 1024, 1),
  ];

  await expect(
    persistSupportAttachment({ uri: "file:///cache/big.png", mimeType: "image/png" }, already),
  ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  expect(storedCount()).toBe(0);
});

test("the file-count cap is enforced by the module that writes the bytes, not only by the form", async () => {
  const already = Array.from({ length: MAX_SUPPORT_ATTACHMENTS }, (_unused, index) =>
    attached(10, index),
  );

  await expect(
    persistSupportAttachment({ uri: "file:///cache/one-more.png", mimeType: "image/png" }, already),
  ).rejects.toBeInstanceOf(AttachmentTooLargeError);
});

// A cap check against an unmeasured file is a cap that is not being applied.
test("a file whose size could not be read is treated as zero, never as unmeasured", async () => {
  getInfo.mockResolvedValue({ exists: true });
  files.set("file:///cache/unknown.png", SECRET_BYTES);

  const stored = await persistSupportAttachment(
    { uri: "file:///cache/unknown.png", mimeType: "image/png" },
    [],
  );

  // The RECORDED size is zero, because that is what the stat returned and a
  // reading we could not take must never pass a cap it was not measured
  // against. The file itself is still written, and still encrypted.
  expect(stored.byteSize).toBe(0);
  expect(files.has(stored.fileUri)).toBe(true);
});

test("a source file that vanished between the pick and the copy fails loudly", async () => {
  getInfo.mockResolvedValue({ exists: false });

  await expect(
    persistSupportAttachment({ uri: "file:///cache/gone.png", mimeType: "image/png" }, []),
  ).rejects.toThrow(/no longer exists/);
});

// Called on the success path of a send the server has already acknowledged —
// a throw here would turn a delivered report into a duplicate.
test("deleting files never throws, even when the filesystem refuses", async () => {
  remove.mockRejectedValue(new Error("EACCES"));

  await expect(
    deleteSupportAttachmentFiles(["file:///docs/support_attachments/a.png"]),
  ).resolves.toBeUndefined();
});

test("every file in the list is attempted, not just the first", async () => {
  await deleteSupportAttachmentFiles([
    "file:///docs/support_attachments/a.png",
    "file:///docs/support_attachments/b.png",
  ]);

  expect(remove).toHaveBeenCalledTimes(2);
});
