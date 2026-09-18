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
// THE ONE PLACE THIS APP USES THE SDK 54 FILE API, and only for the two
// operations the legacy one cannot do without ruining them: reading and writing
// raw BYTES. The legacy API's only binary form is a base64 string, and
// base64ing an 8 MB screenshot in order to encrypt it would build a ~11 MB
// string on the JS thread and then decode it a byte at a time. Everything else
// here — directory creation, stat, unlink, listing — stays on the legacy API
// alongside `lib/privacy/data_export.ts` and `lib/reports/csv_export.ts`, so
// this is a deliberate two-call exception rather than the start of a migration.
import { File } from "expo-file-system";

import {
  decryptAttachmentBytes,
  encryptAttachmentBytes,
} from "@/lib/crypto/attachment_cipher";
import { newId } from "@/lib/ids";
import type { NewSupportReportAttachment } from "@/types/support";

/** Where persisted attachments live. One directory, created on first use. */
const ATTACHMENT_DIR_NAME = "support_attachments";

/** Where a decrypted attachment lives for the length of one upload. In the
 * CACHE directory so Android reclaims it even if this app never runs again. */
const TEMP_DIR_NAME = "support_attachments_tmp";

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
  //
  // `.enc`, AND THE ORIGINAL EXTENSION IS DELIBERATELY NOT KEPT (GAP-072). The
  // bytes on disk are ciphertext, so naming the file `.png` would be a lie that
  // some future gallery scanner or share-sheet handler would act on. The MIME
  // type the upload needs is carried on the ROW instead, which is where it
  // already was.
  const fileUri = `${directory}${newId()}.enc`;
  // COPY THEN ENCRYPT IS NOT AN OPTION — that would write the plaintext to
  // durable storage first and delete it after, which is the exact window this
  // entry exists to close. The bytes go from the picker's cache file straight
  // into memory, through GCM, and only the ciphertext is ever written here.
  const plaintext = await new File(source.uri).bytes();
  const sealed = await encryptAttachmentBytes(plaintext);
  plaintext.fill(0);
  new File(fileUri).write(sealed);

  // `byteSize` stays the PLAINTEXT size, because it is what the caps were
  // measured against and what the user is told. The file on disk is larger by
  // the nonce and the GCM tag, which is 28 bytes and not worth a second field.
  return { fileUri, mimeType: source.mimeType, byteSize };
}

/**
 * Decrypts an attachment to a plaintext temp file and returns its URI, for the
 * one moment the upload genuinely needs a readable file.
 *
 * WHY A FILE AT ALL. React Native's `FormData` takes `{ uri, name, type }` and
 * streams from disk; there is no byte-array form, and base64ing an 8 MB
 * screenshot into a JSON body would inflate it by a third and build the whole
 * string on the JS thread. So the plaintext window is real, and the honest
 * thing is to make it as short as possible rather than to pretend it is not
 * there: `cleanupDecryptedAttachments` below is called on every send outcome,
 * success or failure, and the launch sweep collects whatever a process kill
 * stranded.
 *
 * The temp files go in the CACHE directory on purpose. It is the one place
 * Android reclaims on its own, so even a device that never opens the app again
 * eventually loses them.
 */
export async function decryptAttachmentToTempFile(fileUri: string): Promise<string> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error("support attachments: expo-file-system reports no cache directory");
  }
  const directory = `${cacheDirectory}${TEMP_DIR_NAME}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

  const sealed = await new File(fileUri).bytes();
  const plaintext = decryptAttachmentBytes(sealed);
  const tempUri = `${directory}${newId()}`;
  new File(tempUri).write(plaintext);
  plaintext.fill(0);
  return tempUri;
}

/**
 * Unlinks decrypted temp files. Best effort and never throws, for the same
 * reason `deleteSupportAttachmentFiles` is: it runs on the success path of a
 * send the server has already acknowledged, and a failed unlink must not turn a
 * delivered report into a redelivered one.
 */
export async function cleanupDecryptedAttachments(tempUris: readonly string[]): Promise<void> {
  for (const tempUri of tempUris) {
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch (error: unknown) {
      console.warn("[support] could not delete a decrypted attachment", tempUri, error);
    }
  }
}

/**
 * Unlinks every file in the attachment directory that no row points at, and
 * every decrypted temp file left behind by a killed process.
 *
 * WHY THIS HAS TO EXIST (GAP-072). `discardDraft` is the ordinary teardown and
 * it is best-effort by design: a process killed on the report screen leaks the
 * files it had already copied, and before this there was no sweep at all, so
 * they stayed until the app was uninstalled. The temp files above make the same
 * problem sharper, because those are PLAINTEXT.
 *
 * NEVER THROWS, and never deletes a file it was not given the full picture for:
 * the caller reads the referenced URIs from the database, so a read that failed
 * would arrive here as an empty list and wipe the queue's own attachments. That
 * is why a caller that cannot produce the list must not call this at all,
 * rather than call it with nothing — see `runRetention`.
 *
 * @param referencedUris Every `file_uri` currently held by a support report row.
 */
export async function sweepOrphanedAttachments(
  referencedUris: readonly string[],
): Promise<{ removed: number }> {
  let removed = 0;
  const referenced = new Set(referencedUris);

  const documentDirectory = FileSystem.documentDirectory;
  const cacheDirectory = FileSystem.cacheDirectory;

  const sweep = async (directory: string, keep: Set<string> | null): Promise<void> => {
    let names: string[];
    try {
      names = await FileSystem.readDirectoryAsync(directory);
    } catch {
      // The directory has never been created, which is the common case on a
      // device that never filed a report.
      return;
    }
    for (const name of names) {
      const uri = `${directory}${name}`;
      if (keep !== null && keep.has(uri)) continue;
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        removed += 1;
      } catch (error: unknown) {
        console.warn("[support] could not sweep an orphaned attachment", uri, error);
      }
    }
  };

  if (documentDirectory) {
    await sweep(`${documentDirectory}${ATTACHMENT_DIR_NAME}/`, referenced);
  }
  if (cacheDirectory) {
    // `null`, not an empty set: a decrypted temp file is NEVER referenced by a
    // row, so every one of them that survives a send is garbage by definition.
    await sweep(`${cacheDirectory}${TEMP_DIR_NAME}/`, null);
  }

  return { removed };
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
