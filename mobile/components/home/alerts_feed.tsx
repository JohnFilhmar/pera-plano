// components/home/alerts_feed.tsx — M3 Part 2 Task 4.
//
// The in-app half of the alerts system. Two specs require it explicitly:
// bills rule 12 ("if POST_NOTIFICATIONS is denied, every reminder that would
// have fired renders as an in-app alert card on Home") and bills rule 22
// ("after that, in-app surfaces only — Home alert card"). A user who declined
// notifications, or who has exhausted the three-notice overdue cap, still has
// to be able to find out that something needs paying.
//
// DERIVED, NOT STORED. Every item here is computed from limits and bills the
// screen has already loaded — nothing is written, nothing is marked read, and
// an alert disappears exactly when the thing it describes is resolved. A stored
// feed would need its own lifecycle, its own read state, and its own bugs about
// alerts that outlive their cause.
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section_header";
import type { BillStatus } from "@/lib/bills/bills_service";
import type { LimitStatus } from "@/lib/limits/limit_service";
import { limitDisplayName } from "@/lib/limits/limit_label";

export type HomeAlert = {
  id: string;
  title: string;
  body: string;
  tone: "danger" | "warn";
  /** Where tapping it goes. */
  target: { kind: "bill"; billId: string; dueDate: string } | { kind: "limit"; limitId: string };
};

export type AlertsFeedProps = {
  alerts: HomeAlert[];
  onOpen: (alert: HomeAlert) => void;
  testID?: string;
};

/**
 * What needs attention right now, most urgent first.
 *
 * ORDERED BY WHAT THE USER CAN STILL GET WRONG. An overdue bill is money that
 * will attract a late fee or a disconnection; a limit already exceeded is
 * money already spent. The first is actionable and leads.
 */
export function deriveHomeAlerts(
  limits: LimitStatus[] | undefined,
  bills: BillStatus[] | undefined,
  categoryNames?: ReadonlyMap<string, string>,
): HomeAlert[] {
  const alerts: HomeAlert[] = [];

  for (const status of bills ?? []) {
    if (status.state !== "overdue") continue;
    const days = Math.abs(status.daysUntil);
    alerts.push({
      id: `bill:${status.bill.id}:${status.dueDate}`,
      title: `${status.bill.name} is overdue`,
      body: days === 1 ? "Due yesterday." : `Due ${days} days ago.`,
      tone: "danger",
      target: { kind: "bill", billId: status.bill.id, dueDate: status.dueDate },
    });
  }

  for (const status of limits ?? []) {
    // `paused` and `inactive` are not alerts — the user switched them off.
    if (status.uiState !== "over" && status.uiState !== "warning") continue;
    alerts.push({
      id: `limit:${status.limit.id}`,
      title:
        status.uiState === "over"
          ? `${limitDisplayName(status.limit, categoryNames)} exceeded`
          : `${limitDisplayName(status.limit, categoryNames)} nearly spent`,
      body:
        status.effectiveLimit === null
          ? "Spending is past this limit."
          : `${status.spend >= status.effectiveLimit ? "Over" : "Close to"} your cap for this period.`,
      tone: status.uiState === "over" ? "danger" : "warn",
      target: { kind: "limit", limitId: status.limit.id },
    });
  }

  return alerts;
}

export function AlertsFeed({ alerts, onOpen, testID }: AlertsFeedProps) {
  // Nothing at all when there is nothing wrong. An "all clear" card is a row
  // the user learns to skip, which makes the real alerts harder to see.
  if (alerts.length === 0) return null;

  return (
    <View testID={testID ?? "alerts-feed"} className="gap-3">
      <SectionHeader title="Needs attention" />
      {alerts.map((alert) => (
        <Pressable
          key={alert.id}
          testID={`home-alert-${alert.id}`}
          accessibilityRole="button"
          onPress={() => onOpen(alert)}
        >
          <Card>
            <Text
              className={
                alert.tone === "danger"
                  ? "font-semibold text-danger dark:text-danger-dark"
                  : "font-semibold text-warn dark:text-warn-dark"
              }
            >
              {alert.title}
            </Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">{alert.body}</Text>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}
