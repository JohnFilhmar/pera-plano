// app/(tabs)/more/report_problem.tsx — Route: /more/report_problem. The screen
// behind the More hub's "Report a problem" row.
//
// NESTED UNDER app/(tabs)/more/, matching every other screen in this tab — NOT
// a sibling app/more/ tree, which collides on the same /more/* URL space (the
// mistake reports.tsx's header records has landed five times already).
//
// FREE-TIER, UNGATED. Reporting a bug is not a feature to sell; a user on the
// free tier hitting a crash is exactly the person whose report is most worth
// having.
//
// SUBMIT DOES NOT NAVIGATE AWAY. The form clears and the report appears in the
// list below it, still on this screen. A `router.back()` on submit — what every
// other form in this app does — would be lying by omission here: the report has
// been SAVED, not sent, and the difference is the whole feature. Seeing it land
// in "Waiting to send" is what tells the user their words are safe on the phone
// even with no signal.
//
// THE DRAFT'S FILES ARE CLEANED UP ON UNMOUNT. `useSupportAttachmentDraft`'s
// own header explains why the copies happen at pick time and what that costs;
// the effect below is the teardown that pays it. `releaseDraft` (not
// `discardDraft`) runs on a successful submit, because by then the rows own
// those files and deleting them would strip the attachments off a report that
// is about to be uploaded.
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { AttachmentStrip } from "@/components/support/attachment_strip";
import { ReportProblemForm } from "@/components/support/report_problem_form";
import { UnsentReportRow } from "@/components/support/unsent_report_row";
import { FormScreen } from "@/components/ui/form_screen";
import { systemClock } from "@/lib/clock";
import { useSupportAttachmentDraft } from "@/hooks/use_support_attachment_draft";
import { useUnsentSupportReports } from "@/hooks/queries/use_support_reports";
import {
  useDiscardSupportReport,
  useRetrySupportReport,
  useSubmitSupportReport,
} from "@/hooks/mutations/use_support_reports";

export default function ReportProblemScreen() {
  const draft = useSupportAttachmentDraft();
  const submit = useSubmitSupportReport();
  const retry = useRetrySupportReport();
  const discard = useDiscardSupportReport();
  const { data: unsent } = useUnsentSupportReports();

  // Bumped on every successful queue, and used as the form's `key` so React
  // remounts it with empty fields. The form owns its own text and topic state
  // (it is presentational and has no idea a queue exists), so the alternatives
  // were lifting three pieces of state into this screen or adding a
  // reset-token prop the form would have to honour in an effect. A key is the
  // one option where "cleared" cannot be got half-right.
  const [submittedCount, setSubmittedCount] = useState(0);

  // A ref, not a dependency: the cleanup below must run exactly once, on
  // unmount, and re-running it whenever the draft object changed identity
  // would delete the files the user just picked.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    return () => {
      void draftRef.current.discardDraft();
    };
  }, []);

  // ONE READING FOR THE WHOLE LIST. Each row's countdown is measured against
  // the same instant, so two reports due a minute apart never render as due at
  // the same time because their clock reads drifted between renders. It is
  // deliberately not on a ticking timer — see `formatCountdown`'s own note.
  const now = systemClock.now();

  return (
    <View testID="report-problem-screen" className="flex-1 bg-bg dark:bg-bg-dark">
      <FormScreen>
        <View className="gap-2 p-4 pb-0">
          <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Report a problem</Text>
          <Text className="text-fg-2 dark:text-fg-2-dark">
            Send this even with no signal. PeraPlano keeps the report on your phone and sends it
            the next time you are online.
          </Text>
        </View>

        <ReportProblemForm
          key={submittedCount}
          busy={submit.isPending}
          attachmentSlot={
            <View className="gap-1">
              <AttachmentStrip
                attachments={draft.attachments}
                busy={draft.busy}
                onAdd={() => {
                  void draft.addAttachments();
                }}
                onRemove={(fileUri) => {
                  void draft.removeAttachment(fileUri);
                }}
              />
              {draft.error ? (
                <Text
                  testID="support-attachment-error"
                  className="text-micro text-danger dark:text-danger-dark"
                >
                  {draft.error}
                </Text>
              ) : null}
            </View>
          }
          onSubmit={(values) => {
            void submit
              .mutateAsync({ ...values, attachments: draft.attachments })
              .then(() => {
                // The rows own the files from here — release, never discard.
                draft.releaseDraft();
                setSubmittedCount((count) => count + 1);
              })
              .catch((error: unknown) => {
                // The LOCAL write failed, which is a different and much rarer
                // thing than a failed send: the database is locked or full.
                // Nothing was queued, so the draft keeps its files and the
                // user keeps their text.
                console.error("[support] could not queue the report", error);
              });
          }}
        />

        {unsent && unsent.length > 0 ? (
          <View testID="support-unsent-list" className="gap-3 p-4 pt-0">
            <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
              WAITING TO SEND
            </Text>
            {unsent.map((report) => (
              <UnsentReportRow
                key={report.id}
                report={report}
                now={now}
                busy={retry.isPending || discard.isPending}
                onRetry={(reportId) => {
                  void retry.mutateAsync(reportId).catch(() => undefined);
                }}
                onDiscard={(reportId) => {
                  void discard.mutateAsync(reportId).catch(() => undefined);
                }}
              />
            ))}
          </View>
        ) : null}

        {/* Clears the tab bar on short devices, same as every other More screen. */}
        <View className="h-8" />
      </FormScreen>
    </View>
  );
}
