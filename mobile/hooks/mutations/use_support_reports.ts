// hooks/mutations/use_support_reports.ts — the three writes the report screen
// makes: file one, retry a refused one, throw one away.
//
// THREE HOOKS IN ONE FILE, the same bundling `hooks/queries/use_capture_settings.ts`
// uses for its closely-related pair. They share a family, a key set, and the
// one rule worth stating once: every one of them kicks the outbox afterwards.
//
// EVERY MUTATION ENDS WITH A FLUSH, AND THE FLUSH IS NOT AWAITED. Submitting
// must return the instant the report is on disk — that is the promise the
// screen makes ("saved, we'll send it") and it is true with or without signal.
// Awaiting the send instead would put a three-minute upload timeout between
// the user's tap and the screen closing, and would make the success of a
// LOCAL write look like it depended on the network, which is the exact
// confusion this feature exists to remove.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { deleteSupportAttachmentFiles } from "@/lib/support/attachments";
import { flushSupportOutbox } from "@/lib/support/outbox_runner";
import {
  deleteSupportReport,
  enqueueSupportReport,
  requeueSupportReport,
} from "@/lib/support/support_reports_repo";
import type { NewSupportReport, SupportReport } from "@/types/support";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Nudges the outbox without making the caller wait for it. Rejections are
 * impossible by `flushSupportOutbox`'s contract and swallowed anyway — a
 * mutation must not fail because a send did.
 */
function kickOutbox(): void {
  void flushSupportOutbox(systemClock.now()).catch(() => undefined);
}

/**
 * Writes a new report to the local outbox and immediately tries to send it.
 *
 * RESOLVES ON THE LOCAL WRITE, not on delivery — see this file's header. The
 * returned `SupportReport` is the stored row, so the screen can show the user
 * their report in the waiting list straight away.
 */
export function useSubmitSupportReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewSupportReport): Promise<SupportReport> =>
      enqueueSupportReport(input, systemClock.now()),
    onSuccess: async () => {
      await invalidateKeys(queryClient, [queryKeys.supportReports.all]);
      kickOutbox();
    },
  });
}

/**
 * Puts a refused report back in the queue at attempt zero — the user's "Try
 * again" (see `requeueSupportReport` for why the attempt count resets).
 */
export function useRetrySupportReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reportId: string): Promise<void> =>
      requeueSupportReport(reportId, systemClock.now()),
    onSuccess: async () => {
      await invalidateKeys(queryClient, [queryKeys.supportReports.all]);
      kickOutbox();
    },
  });
}

/**
 * Deletes a report and unlinks its attachment files.
 *
 * THE FILES GO IN THE SAME BREATH AS THE ROW. `deleteSupportReport` returns
 * the URIs precisely so this pairing has to be written down somewhere; skipping
 * it would leave the largest files this app writes on disk with nothing left
 * pointing at them, and no later pass would ever find them (retention only
 * looks at rows).
 *
 * No flush afterwards — there is nothing new to send, and a discard is the one
 * action here that is only ever about removing something.
 */
export function useDiscardSupportReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reportId: string): Promise<void> => {
      const fileUris = await deleteSupportReport(reportId);
      await deleteSupportAttachmentFiles(fileUris);
    },
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.supportReports.all]),
  });
}
