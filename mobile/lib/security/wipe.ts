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

/**
 * KNOWN GAP, stated plainly (see task-9-report.md): this does not yet clear
 * the notification listener's pending-capture buffer
 * (`pending_captures.ndjson`, native Kotlin — CaptureBuffer.kt). No bridge
 * primitive exists for that today (the module only exposes get/wrap/unwrap/
 * drain — see modules/notification_listener/index.ts), and adding one is a
 * Kotlin change explicitly out of scope for the task that wrote this file.
 * The buffer's contents remain sealed ciphertext under the (untouched)
 * capture RSA keypair, so this is NOT a confidentiality leak — but it does
 * not fulfil docs §11a's promise to clear "the capture buffer" as part of
 * starting over, and stale captures would sit unopenable forever after a
 * fresh initializeKeys() run. MUST be closed with a real
 * `clearCaptureBuffer()` AsyncFunction on NotificationListenerModule.kt
 * before this wipe path ships to real users.
 */
async function clearCaptureBuffer(): Promise<void> {
  // Intentionally a no-op today — see this function's doc above.
}

/**
 * Destroys the database file, both key wraps (and the in-memory DEK), and
 * — once implemented — the capture buffer, then leaves the caller free to
 * treat the device as freshly installed. Settings are not wiped separately:
 * they live as rows inside the same SQLite file wipeDatabase() deletes, so
 * deleting the file already clears them — running `DELETE FROM app_settings`
 * instead would require a decrypted connection this function may never have
 * (see wipeDatabase()'s own doc for why it must work with no key at all).
 */
export async function wipeAndStartOver(): Promise<void> {
  await wipeDatabase();
  await wipeKeys();
  await clearCaptureBuffer();
}
