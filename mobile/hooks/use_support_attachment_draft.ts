// hooks/use_support_attachment_draft.ts — the screenshots a user has added to
// a report they have not submitted yet.
//
// DRAFT STATE, NOT SERVER STATE, which is why this is a plain `useState` hook
// and not a React Query family. Nothing is in the database until the report is
// submitted; until then this is the same kind of value as the title text in
// the field above it.
//
// THE FILES ARE COPIED AS SOON AS THEY ARE PICKED, though — before submit,
// not at submit. The picker hands back a URI in the reclaimable cache
// directory (see `lib/support/attachments.ts`), and a user who picks three
// screenshots and then spends five minutes writing a careful description is
// exactly the case where the OS gets a chance to clear it out from under them.
//
// THE COST OF THAT IS ORPHANED FILES: a user who attaches two screenshots and
// then leaves the screen without submitting has two files on disk that no row
// points at. `discardDraft` is the teardown that handles it, and the screen
// calls it on unmount. It is best-effort by design — a process killed on that
// screen leaks the files, and the alternative (deferring the copy to submit
// time) trades a rare few hundred kilobytes for a common broken attachment.
import { useCallback, useRef, useState } from "react";

import {
  AttachmentTooLargeError,
  MAX_SUPPORT_ATTACHMENTS,
  deleteSupportAttachmentFiles,
  persistSupportAttachment,
} from "@/lib/support/attachments";
import { MediaPermissionDeniedError, pickSupportMedia } from "@/lib/support/attachment_picker";
import type { NewSupportReportAttachment } from "@/types/support";

export type SupportAttachmentDraft = {
  attachments: NewSupportReportAttachment[];
  /** A message to render under the attachment row, or `null`. Already user-facing. */
  error: string | null;
  /** True while the picker is open or a copy is in flight. */
  busy: boolean;
  addAttachments: () => Promise<void>;
  removeAttachment: (fileUri: string) => Promise<void>;
  /** Deletes every drafted file. For the screen's unmount path. */
  discardDraft: () => Promise<void>;
  /** Forgets the draft WITHOUT deleting files — for a successful submit, where the rows now own them. */
  releaseDraft: () => void;
  /** Takes files back under the draft's ownership after a submit that failed to
   * queue, so the unmount teardown still cleans them up. See `releaseDraft`'s
   * call site for why the release happens BEFORE the insert. */
  adoptDraft: (attachments: readonly NewSupportReportAttachment[]) => void;
};

export function useSupportAttachmentDraft(): SupportAttachmentDraft {
  const [attachments, setAttachments] = useState<NewSupportReportAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * A mirror of `attachments` that the unmount teardown can read.
   *
   * `discardDraft` is called from an effect cleanup registered ONCE, so it
   * closes over the empty first-render list; and the obvious workaround —
   * reading the current value out of a `setAttachments` updater — makes the
   * updater side-effecting, which React is explicitly allowed to run twice.
   * A ref written on every accepted change is the version that is both
   * current and safe to read.
   */
  const attachmentsRef = useRef<NewSupportReportAttachment[]>([]);

  const commit = useCallback((next: NewSupportReportAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const addAttachments = useCallback(async () => {
    setError(null);
    setBusy(true);
    // The running `accepted` list is what keeps the caps correct when several
    // files come back from one multi-select: each copy is checked against
    // everything accepted so far, not against the list as it was when the
    // picker opened. Without it, five picks of 6MB each would every one see an
    // empty list and all five would pass the 20MB total cap.
    let accepted: NewSupportReportAttachment[] = attachmentsRef.current;
    try {
      const picked = await pickSupportMedia(MAX_SUPPORT_ATTACHMENTS - accepted.length);
      for (const media of picked) {
        const stored = await persistSupportAttachment(media, accepted);
        accepted = [...accepted, stored];
      }
    } catch (caught: unknown) {
      // Both of these carry messages written for this screen (see their own
      // definitions); anything else is a genuine fault and gets a generic
      // line, because a raw filesystem error is not something to put in front
      // of someone already reporting a bug.
      if (caught instanceof AttachmentTooLargeError || caught instanceof MediaPermissionDeniedError) {
        setError(caught.message);
      } else {
        console.warn("[support] could not attach a file", caught);
        setError("We couldn't attach that file. Try a different one.");
      }
    } finally {
      // COMMITTED EVEN ON THE FAILURE PATH. A multi-select that copies two
      // files and then trips the size cap on the third has already written two
      // files to disk; dropping them on the floor here would leave them
      // orphaned AND lose the user two attachments they successfully picked.
      commit(accepted);
      setBusy(false);
    }
  }, [commit]);

  const removeAttachment = useCallback(
    async (fileUri: string) => {
      setError(null);
      commit(attachmentsRef.current.filter((item) => item.fileUri !== fileUri));
      await deleteSupportAttachmentFiles([fileUri]);
    },
    [commit],
  );

  const discardDraft = useCallback(async () => {
    const pending = attachmentsRef.current;
    commit([]);
    await deleteSupportAttachmentFiles(pending.map((item) => item.fileUri));
  }, [commit]);

  const releaseDraft = useCallback(() => {
    commit([]);
    setError(null);
  }, [commit]);

  const adoptDraft = useCallback(
    (items: readonly NewSupportReportAttachment[]) => {
      commit([...items]);
    },
    [commit],
  );

  return {
    attachments,
    error,
    busy,
    addAttachments,
    removeAttachment,
    discardDraft,
    releaseDraft,
    adoptDraft,
  };
}
