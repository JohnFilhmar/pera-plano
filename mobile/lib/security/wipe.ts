// lib/security/wipe.ts — the §11a "wipe and start over" primitive
// (docs/12-encryption-and-app-lock.md §11a; contract §9 rule 4; task-9-brief
// rule 7). This is the ONLY way out of the unrecoverable state: the
// Keystore key is gone (screen lock removed) AND the recovery phrase is
// lost, so no wrap on disk can ever produce the DEK again. It needs no
// auth gate by design — someone who cannot decrypt the data also cannot
// read it, so a wipe destroys but never leaks.
//
// Order matters: the database is wiped FIRST, the key material SECOND. If
// wipeDatabase() fails partway (a filesystem error, say), this function
// propagates that failure and never reaches wipeKeys() — the wraps stay on
// disk, so the user's only paths back to their data (device key or
// recovery phrase) are still intact for a retry. Wiping the keys first
// would risk the opposite: an encrypted file nobody can ever open again,
// with nothing left to even prove that was the intent.
import { wipeDatabase } from "@/lib/db/database";
import { wipeKeys } from "@/lib/crypto/key_manager";
import { clearCaptureBuffer } from "@/modules/notification_listener";
import { deleteAllSupportAttachmentFiles } from "@/lib/support/attachments";

/**
 * Destroys the database file, both key wraps (and the in-memory DEK), and
 * the notification listener's pending-capture buffer, then leaves the
 * caller free to treat the device as freshly installed. Settings are not
 * wiped separately: they live as rows inside the same SQLite file
 * wipeDatabase() deletes, so deleting the file already clears them —
 * running `DELETE FROM app_settings` instead would require a decrypted
 * connection this function may never have (see wipeDatabase()'s own doc for
 * why it must work with no key at all).
 *
 * The capture buffer (`pending_captures.ndjson`, native Kotlin —
 * CaptureBuffer.kt) used to be a KNOWN GAP here (see task-9-report.md): no
 * bridge primitive existed to clear it, so a wipe left it on disk, sealed
 * ciphertext under a capture keypair the wipe had just made irrelevant. Not
 * a confidentiality leak on its own, but it broke this function's own
 * promise (docs §11a) to clear "the capture buffer" as part of starting
 * over. `clearCaptureBuffer()` (task-9a-brief) closes that gap and succeeds
 * cleanly whether or not anything was pending — see its doc.
 */
export async function wipeAndStartOver(): Promise<void> {
  await wipeDatabase();
  await wipeKeys();
  await clearCaptureBuffer();
  // Problem-report attachments (migration 015) are the second thing on this
  // device that lives outside the database file, and they land here for
  // exactly the reason the capture buffer above does: deleting the SQLite file
  // deletes the rows that POINT at the screenshots, not the screenshots. Last
  // in the sequence, after the two steps whose ordering carries the
  // recoverability argument in this file's header — and it never throws, so it
  // cannot turn a completed wipe into a failed one.
  await deleteAllSupportAttachmentFiles();
}
