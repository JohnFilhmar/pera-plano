// lib/support/__tests__/attachments.test.ts — the caps, and the copy that
// makes an attachment survive until the report is delivered.
//
// `expo-file-system` is a native module Jest cannot require, so it is mocked
// here — the same treatment `lib/privacy/__tests__/data_export.test.ts` and
// `lib/reports/__tests__/csv_export.test.ts` give it.
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1024 })),
}));

import * as FileSystem from "expo-file-system/legacy";

import type { NewSupportReportAttachment } from "@/types/support";

import {
  AttachmentTooLargeError,
  MAX_SUPPORT_ATTACHMENTS,
  MAX_SUPPORT_ATTACHMENTS_TOTAL_BYTES,
  MAX_SUPPORT_ATTACHMENT_BYTES,
  deleteSupportAttachmentFiles,
  persistSupportAttachment,
} from "../attachments";

const getInfo = FileSystem.getInfoAsync as jest.Mock;
const copy = FileSystem.copyAsync as jest.Mock;
const remove = FileSystem.deleteAsync as jest.Mock;

function attached(byteSize: number, index: number): NewSupportReportAttachment {
  return { fileUri: `file:///docs/support_attachments/${index}.png`, mimeType: "image/png", byteSize };
}

beforeEach(() => {
  jest.clearAllMocks();
  getInfo.mockResolvedValue({ exists: true, size: 1024 });
});

test("a picked file is copied out of the cache into the document directory", async () => {
  const stored = await persistSupportAttachment(
    { uri: "file:///cache/ImagePicker/abc.jpg", mimeType: "image/jpeg" },
    [],
  );

  expect(copy).toHaveBeenCalledWith({
    from: "file:///cache/ImagePicker/abc.jpg",
    to: expect.stringContaining("file:///docs/support_attachments/"),
  });
  // The extension comes from the mime type, never from the picked file's own
  // name — see `extensionFor`.
  expect(stored.fileUri.endsWith(".jpg")).toBe(true);
  expect(stored.byteSize).toBe(1024);
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

test("a file over the per-file cap is refused before anything is copied", async () => {
  getInfo.mockResolvedValue({ exists: true, size: MAX_SUPPORT_ATTACHMENT_BYTES + 1 });

  await expect(
    persistSupportAttachment({ uri: "file:///cache/huge.mp4", mimeType: "video/mp4" }, []),
  ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  expect(copy).not.toHaveBeenCalled();
});

test("a file that would put the report over the total cap is refused", async () => {
  getInfo.mockResolvedValue({ exists: true, size: 5 * 1024 * 1024 });
  const already = [
    attached(MAX_SUPPORT_ATTACHMENTS_TOTAL_BYTES - 1024 * 1024, 1),
  ];

  await expect(
    persistSupportAttachment({ uri: "file:///cache/big.png", mimeType: "image/png" }, already),
  ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  expect(copy).not.toHaveBeenCalled();
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

  const stored = await persistSupportAttachment(
    { uri: "file:///cache/unknown.png", mimeType: "image/png" },
    [],
  );

  expect(stored.byteSize).toBe(0);
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
