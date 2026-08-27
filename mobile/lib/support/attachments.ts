// lib/support/attachments.ts — the file half of a problem report: taking the
// screenshot the user picked and making it survive until the report is
// actually delivered.
//
// WHY THE FILE IS COPIED AT ALL. `expo-image-picker` hands back a URI in the
// app's CACHE directory. Android treats the cache directory as reclaimable:
// it is what the OS empties when storage runs low, and it is what "Clear
// cache" in app settings wipes. A report that has been waiting three days for
// signal would then upload a screenshot that no longer exists. Copying into
// the DOCUMENT directory — the same durability class as the encrypted
// database itself — is what makes "we'll send it when you're back online"
// true for the attachments and not just for the text.
//
// `expo-file-system/legacy`, matching `lib/privacy/data_export.ts` and
// `lib/reports/csv_export.ts`. SDK 54 ships a new `File`/`Directory` API
// alongside the legacy one; adopting it here — in the third file in this app
// to touch the filesystem, while the other two stay on the old one — would
// mean two filesystem idioms and two sets of Jest mocks for one small app.
// Migrating all three is its own task.
//
// LIMITS ARE ENFORCED HERE, NOT IN THE FORM. A screen can forget to check;
// the module that writes the bytes cannot. The caps below exist because the
// upload has to complete over Philippine mobile data on a retry budget
// measured in minutes — a 40MB video attached to a bug report is not evidence,
// it is a report that never sends.
import * as FileSystem from "expo-file-system/legacy";

import { newId } from "@/lib/ids";
import type { NewSupportReportAttachment } from "@/types/support";

/** Where persisted attachments live. One directory, created on first use. */
const ATTACHMENT_DIR_NAME = "support_attachments";

/** At most this many files on one report. */
export const MAX_SUPPORT_ATTACHMENTS = 5;

/** At most this much for any single file (8 MB). */
export const MAX_SUPPORT_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** At most this much across one report (20 MB). */
export const MAX_SUPPORT_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * Raised when a pick breaks one of the caps above. Carries a message written
 * for the user, because the form renders it directly — there is no second
 * translation layer between here and the screen.
 */
export class AttachmentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentTooLargeError";
  }
}

/**
 * Extension for the copied file, derived from the MIME type the picker
 * reported.
 *
 * The extension is cosmetic on this device — nothing here opens the file by
 * type — but it is NOT cosmetic at the other end: the multipart part's
 * filename is what a ticketing system shows in its attachment list, and
 * "IMG_0042" with no extension is a file a developer has to guess at before
 * they can look at the bug. Unknown types fall back to `.bin` rather than
 * being rejected, since the size caps are the limit that actually matters.
 */
function extensionFor(mimeType: string): string {
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  return known[mimeType.toLowerCase()] ?? "bin";
}

async function attachmentDirectory(): Promise<string> {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    throw new Error("support attachments: expo-file-system reports no document directory");
  }
  const directory = `${documentDirectory}${ATTACHMENT_DIR_NAME}/`;
  // `intermediates: true` makes this idempotent — no exists-check race
  // between two picks made in quick succession.
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

/**
 * Copies a picked file into durable app storage and returns the attachment
 * record to hand to `enqueueSupportReport`.
 *
 * `alreadyAttached` is the report's current attachments, so the count and the
 * running total can be checked BEFORE the copy — writing 8MB to disk and then
 * refusing it would be the worst of both.
 *
 * Throws `AttachmentTooLargeError` with a user-facing message when a cap is
 * hit. Every other failure (a source URI that vanished, a full disk)
 * propagates as-is: those are genuine faults, and the form shows a generic
 * "couldn't attach that" for them.
 */
export async function persistSupportAttachment(
  source: { uri: string; mimeType: string },
  alreadyAttached: readonly NewSupportReportAttachment[],
): Promise<NewSupportReportAttachment> {
  if (alreadyAttached.length >= MAX_SUPPORT_ATTACHMENTS) {
    throw new AttachmentTooLargeError(
      `You can attach up to ${MAX_SUPPORT_ATTACHMENTS} files to one report.`,
    );
  }

  const info = await FileSystem.getInfoAsync(source.uri);
  if (!info.exists) {
    throw new Error(`support attachments: ${source.uri} no longer exists`);
  }
  // `size` is only present on the exists-branch of the legacy API's union (and
  // the option that used to request it is gone from `InfoOptions`), so a
  // missing one is treated as zero — a reading we could not take must never
  // silently pass a cap check it was not measured against.
  const byteSize = "size" in info && typeof info.size === "number" ? info.size : 0;

  if (byteSize > MAX_SUPPORT_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError(
      `That file is too big to send. Each attachment has to be under ${formatMegabytes(MAX_SUPPORT_ATTACHMENT_BYTES)}.`,
    );
  }

  const totalAfter = alreadyAttached.reduce((sum, item) => sum + item.byteSize, byteSize);
  if (totalAfter > MAX_SUPPORT_ATTACHMENTS_TOTAL_BYTES) {
    throw new AttachmentTooLargeError(
      `That would put the report over ${formatMegabytes(MAX_SUPPORT_ATTACHMENTS_TOTAL_BYTES)} of attachments. Remove one first.`,
    );
  }

  const directory = await attachmentDirectory();
  // A fresh UUID, never the picked file's own name: two screenshots taken a
  // second apart are both "Screenshot_20260828-101500.png" on some devices,
  // and the second copy would silently overwrite the first.
  const fileUri = `${directory}${newId()}.${extensionFor(source.mimeType)}`;
  await FileSystem.copyAsync({ from: source.uri, to: fileUri });

  return { fileUri, mimeType: source.mimeType, byteSize };
}

/**
 * Deletes attachment files from disk — after a successful send, after a
 * discard, and after retention purges a sent report.
 *
 * BEST EFFORT, AND NEVER THROWS. It is called on the success path of a send
 * that has already been acknowledged by the server; letting a failed unlink
 * reject there would turn a delivered report into a visibly failed one and
 * queue it for redelivery. A file that survives is a few hundred kilobytes the
 * next purge will try again on; a report sent twice is a duplicate ticket.
 */
export async function deleteSupportAttachmentFiles(fileUris: readonly string[]): Promise<void> {
  for (const fileUri of fileUris) {
    try {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    } catch (error: unknown) {
      console.warn("[support] could not delete attachment file", fileUri, error);
    }
  }
}

/**
 * Deletes the whole attachment directory, without reading a single row.
 *
 * FOR `lib/security/wipe.ts`'s `wipeAndStartOver`, which is the one caller
 * that CANNOT use `deleteSupportAttachmentFiles`: it runs when the database
 * can never be opened again (the Keystore key is gone and the recovery phrase
 * is lost), so there is nothing left to ask which files exist. Naming the
 * directory instead of its contents is the only form of the question that
 * still has an answer there.
 *
 * Silent when the directory was never created — `idempotent: true` — because
 * a device that never filed a report is the common case, not an error.
 */
export async function deleteAllSupportAttachmentFiles(): Promise<void> {
  try {
    const documentDirectory = FileSystem.documentDirectory;
    if (!documentDirectory) return;
    await FileSystem.deleteAsync(`${documentDirectory}${ATTACHMENT_DIR_NAME}/`, {
      idempotent: true,
    });
  } catch (error: unknown) {
    // Same disposition as `deleteSupportAttachmentFiles`: a wipe must not fail
    // over an unlink. Its caller wipes key material immediately afterwards, and
    // a report whose ciphertext keys are gone is unreadable anyway.
    console.warn("[support] could not clear the attachment directory", error);
  }
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
