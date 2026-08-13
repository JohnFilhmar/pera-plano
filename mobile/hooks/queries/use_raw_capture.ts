// hooks/queries/use_raw_capture.ts — m1c plan Task 7's two reads behind the
// "Why was this recorded?" panel.
//
// TWO HOOKS OVER ONE ROW. `getRawCapture` returns `RawCapture`, which is
// interface-contract §4 — the shape the Kotlin listener hands across the native
// bridge — and carries no expiry, because the native side does not assign one.
// Widening that type to save this screen a read would change a native contract
// for the benefit of one panel, so the expiry has its own repository accessor
// and its own hook here.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getRawCapture, getRawCaptureExpiry } from "@/lib/db/repos/raw_notifications_repo";

/**
 * The captured notification text, or `null` when it was never stored or has
 * been purged.
 *
 * `id` is nullable and a `null` id fetches NOTHING — every manual entry has no
 * capture, and so does every notification row past the 30-day purge, which
 * nulls `transactions.raw_notification_id` on its way out. Those are ordinary
 * states of a transaction, not errors, and firing a query for them would put a
 * permanently-failing entry in the cache for each one.
 */
export function useRawCapture(id: string | null) {
  return useQuery({
    queryKey: queryKeys.rawCaptures.detail(id ?? ""),
    queryFn: () => getRawCapture(id as string),
    enabled: id !== null,
  });
}

/**
 * When that capture will be destroyed — the number the countdown renders.
 *
 * THE STORED COLUMN, NEVER `capturedAt + RAW_CAPTURE_TTL_MS`. The expiry was
 * computed from the STORE time, and a replayed or late-drained capture makes
 * the two differ by however long the capture waited in the native buffer. The
 * purge deletes on the stored column, so a countdown derived from anything else
 * is the app promising a date the database will not honour.
 */
export function useRawCaptureExpiry(id: string | null) {
  return useQuery({
    queryKey: queryKeys.rawCaptures.expiry(id ?? ""),
    queryFn: () => getRawCaptureExpiry(id as string),
    enabled: id !== null,
  });
}
