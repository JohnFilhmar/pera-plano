// components/support/unsent_report_row.tsx — one report the user is still
// waiting on.
//
// THE ROW'S JOB IS TO MAKE A SILENT QUEUE VISIBLE. Everything about this
// feature happens in the background: the send, the failure, the eight-minute
// wait, the second failure. A user who reports a bug and sees nothing
// afterwards has no way to tell "it went" from "it vanished", and will either
// report it again or stop reporting. So the row says which of the two it is,
// why the last try failed, and roughly when the next one happens.
//
// "ROUGHLY", DELIBERATELY. `formatCountdown` rounds to whole minutes and says
// "in about" — a to-the-second countdown would need a ticking timer on a row
// whose exact value nobody acts on, and would be wrong anyway the moment the
// phone finds signal early (the next foreground flushes immediately, ahead of
// the timer).
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { SUPPORT_TOPIC_LABELS, type SupportReport } from "@/types/support";

export type UnsentReportRowProps = {
  report: SupportReport;
  /** The instant to measure the countdown against — passed in, per lib/clock.ts. */
  now: number;
  onRetry: (reportId: string) => void;
  onDiscard: (reportId: string) => void;
  busy?: boolean;
};

/**
 * "in about 4 minutes" / "any moment now". Exported for its own test — it is
 * the only logic in this file, and the boundary cases (already due, under a
 * minute, exactly one minute) are the ones a reader would get wrong.
 */
export function formatCountdown(dueAt: number, now: number): string {
  const remainingMs = dueAt - now;
  if (remainingMs <= 0) return "any moment now";
  const minutes = Math.round(remainingMs / 60_000);
  if (minutes <= 0) return "in under a minute";
  return minutes === 1 ? "in about a minute" : `in about ${minutes} minutes`;
}

function statusLine(report: SupportReport, now: number): string {
  if (report.status === "rejected") {
    return report.lastError ?? "The server could not accept this report.";
  }
  if (report.attemptCount === 0) {
    return "Waiting to send.";
  }
  const reason = report.lastError ?? "Couldn't send.";
  return `${reason} Trying again ${formatCountdown(report.nextAttemptAt, now)}.`;
}

export function UnsentReportRow({
  report,
  now,
  onRetry,
  onDiscard,
  busy = false,
}: UnsentReportRowProps) {
  const rejected = report.status === "rejected";

  return (
    <Card testID={`support-report-${report.id}`}>
      <View className="gap-2">
        <View className="flex-row items-start justify-between gap-2">
          <Text className="flex-1 font-semibold text-fg dark:text-fg-dark" numberOfLines={2}>
            {report.title}
          </Text>
          <Chip
            label={rejected ? "Needs you" : "Waiting"}
            tone={rejected ? "danger" : "neutral"}
            fill="soft"
            testID={`support-report-status-${report.id}`}
          />
        </View>

        <Text className="text-micro text-fg-2 dark:text-fg-2-dark">
          {SUPPORT_TOPIC_LABELS[report.topic]}
        </Text>

        <Text
          testID={`support-report-detail-${report.id}`}
          className="text-micro text-fg-2 dark:text-fg-2-dark"
          numberOfLines={3}
        >
          {statusLine(report, now)}
        </Text>

        {report.attachments.length > 0 ? (
          <Text className="text-micro text-fg-2 dark:text-fg-2-dark">
            {report.attachments.length === 1
              ? "1 file attached"
              : `${report.attachments.length} files attached`}
          </Text>
        ) : null}

        {/* RETRY ONLY APPEARS ON A REFUSED REPORT. A queued one is already
            retrying on its own schedule, and a button that says "Try again"
            beside "Trying again in about 4 minutes" invites a user to sit on
            it — which, since it resets the attempt count, would keep the
            report at the one-minute step indefinitely. */}
        <View className="flex-row gap-2 pt-1">
          {rejected ? (
            <View className="flex-1">
              <Button
                testID={`support-report-retry-${report.id}`}
                title="Try again"
                variant="secondary"
                onPress={() => onRetry(report.id)}
                disabled={busy}
              />
            </View>
          ) : null}
          <View className="flex-1">
            <Button
              testID={`support-report-discard-${report.id}`}
              title="Discard"
              variant="ghost"
              onPress={() => onDiscard(report.id)}
              disabled={busy}
            />
          </View>
        </View>
      </View>
    </Card>
  );
}
