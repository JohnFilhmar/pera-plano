// components/transactions/why_recorded_panel.tsx — m1c plan Task 7, rules 2–4;
// docs/04-features/11-settings-privacy.md Flow C.
//
// THIS IS THE APP'S HONESTY MECHANISM. PeraPlano reads the user's
// notifications. Nothing about the rest of the product makes that defensible —
// not the on-device parsing, not the encryption, not the absence of a server.
// What makes it defensible is that the user can point at any row in their
// ledger and be shown, immediately: this is the exact text we read, this is the
// app it came from, and this is when we destroy it.
//
// Which is why the failure modes here are not cosmetic:
//
//   A PACKAGE NAME INSTEAD OF A PROVIDER. "com.globe.gcash.android" does not
//   answer "which app was read?" for any human being. The screen resolves the
//   name and hands it in — see constants/providers.ts, which falls back through
//   the installed ruleset, then a shipped package table, and only then to the
//   package itself.
//
//   A COUNTDOWN THAT DISAGREES WITH THE DELETION. The expiry is read from
//   `raw_notifications.expires_at` — the column `purgeExpiredRawCaptures`
//   actually deletes on — and never derived from `capturedAt + TTL`, which is a
//   different number on every replayed or late-drained capture. A panel that
//   promises a date the database will not honour is worse than no panel: it
//   converts a checkable claim into a false one.
//
//   AN EMPTY BOX AFTER EXPIRY. Deletion working exactly as designed has to LOOK
//   like deletion working, in words, or the user reads it as a bug and
//   concludes the transparency feature is broken rather than that the promise
//   was kept.
//
// COLLAPSED BY DEFAULT, and that is a privacy decision rather than a layout
// one. The captured text carries third parties' names — whoever sent the
// padala, whoever was paid — and docs/07 §7 is explicit that keeping it
// view-only and on request is the data-minimisation stance. It opens when the
// user asks the question, not for everyone who glances at their phone.
//
// PRESENTATIONAL. The capture, its expiry and the provider name arrive as
// props, resolved by app/transaction/[id].tsx from hooks. Global Constraints:
// no repository import, and no `Date.now()` that a test cannot pin.
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { registerIcon } from "@/components/ui/button";
import type { EpochMs, RawCapture, TxSource } from "@/types/domain";

const Chevron = registerIcon(ChevronRight);
const ChevronOpen = registerIcon(ChevronDown);

const DAY_MS = 24 * 60 * 60 * 1000;

/** The question, exactly as every spec in the repo words it. */
export const WHY_RECORDED_TITLE = "Why was this recorded?";

/**
 * Rule 4's sentence for a transaction the user typed in themselves.
 *
 * A manual entry has no capture, no provider and no parse — it is ground truth
 * (m1c Task 8 rule 4). Offering "Why was this recorded?" over one would send
 * the user looking for a notification that never existed.
 */
export const MANUAL_SOURCE_NOTE = "You added this manually";

/**
 * Rule 3's copy, taken VERBATIM from
 * docs/04-features/11-settings-privacy.md Flow C step 4 — the plan only asks
 * for "says so plainly", and Global Constraints settle the difference: where
 * the plan and a spec disagree, the spec wins.
 *
 * EVERY CLAUSE IS LOAD-BEARING. "automatically" says no one had to ask.
 * "after 30 days" is the number the user was promised at onboarding. "as
 * designed" is the difference between evidence that the promise was kept and a
 * screen that reads like data loss.
 */
export const RAW_CAPTURE_EXPIRED_NOTICE =
  "The original notification text was automatically deleted after 30 days, as designed.";

/** What a non-notification, non-manual row says instead of a panel. */
const SOURCE_NOTES: Record<Exclude<TxSource, "notification" | "manual">, string> = {
  "recurring-rule": "A recurring rule you set up created this",
  import: "This came from a file you imported",
};

/**
 * "This capture is deleted in 12 days", or the expired notice once the clock
 * has run out.
 *
 * ROUNDS UP, ALWAYS. The direction is not a matter of taste. Rounding down
 * would tell a user their notification text is already gone while it is still
 * on the device — a deletion promise made early is a false statement about data
 * that still exists, and it is the one error this panel cannot afford. Rounding
 * up can only ever overstate the remaining time by less than a day, and the
 * text really is deleted on the day named.
 *
 * At or past the expiry it returns the expired notice rather than "in 0 days":
 * the purge runs at bootstrap, so a long session can hold a row whose expiry
 * passed an hour ago, and the user was promised that instant, not the next
 * launch.
 */
export function captureExpiryLabel(expiresAt: EpochMs, now: EpochMs): string {
  const remaining = expiresAt - now;
  if (remaining <= 0) return RAW_CAPTURE_EXPIRED_NOTICE;

  const days = Math.ceil(remaining / DAY_MS);
  return `This capture is deleted in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Every non-empty line of the capture, in the order the listener saw them.
 *
 * ALL FOUR FIELDS, not just `text`. The parser reads `bigText` too — an
 * expanded notification often carries the reference number the collapsed one
 * omits — so a panel showing only `text` would be hiding part of what the app
 * actually read, which is the one thing it must not do. Duplicates are
 * collapsed, because Android frequently repeats `text` in `bigText` and the
 * same sentence printed twice reads as a rendering bug.
 */
function captureLines(capture: RawCapture): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const field of [capture.title, capture.text, capture.bigText, capture.subText]) {
    const value = field?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    lines.push(value);
  }
  return lines;
}

export type WhyRecordedPanelProps = {
  source: TxSource;
  /** Resolved by the screen — a provider NAME, never an android package. */
  providerName: string;
  /**
   * `undefined` while the read is in flight, `null` once it has resolved to
   * nothing. The distinction is the difference between saying nothing yet and
   * announcing a deletion that has not happened.
   */
  capture: RawCapture | null | undefined;
  /** The STORED expiry (`raw_notifications.expires_at`). Never derived. */
  expiresAt: EpochMs | null | undefined;
  /** Parse confidence at commit time (spec Flow C step 2). */
  confidence?: number;
  /** Injected clock. Defaults to the wall clock, as every screen passes. */
  now?: EpochMs;
  testID?: string;
};

export function WhyRecordedPanel({
  source,
  providerName,
  capture,
  expiresAt,
  confidence,
  now = Date.now(),
  testID = "why-recorded-panel",
}: WhyRecordedPanelProps) {
  const [expanded, setExpanded] = useState(false);

  // Rule 4. Rendered INSTEAD of the panel, never beside it.
  if (source === "manual") {
    return (
      <View className="px-4 pt-3">
        <Card variant="flat">
          <Text
            testID="transaction-manual-note"
            className="text-sm text-fg-2 dark:text-fg-2-dark"
          >
            {MANUAL_SOURCE_NOTE}
          </Text>
        </Card>
      </View>
    );
  }

  if (source !== "notification") {
    return (
      <View className="px-4 pt-3">
        <Card variant="flat">
          <Text
            testID="transaction-source-note"
            className="text-sm text-fg-2 dark:text-fg-2-dark"
          >
            {SOURCE_NOTES[source]}
          </Text>
        </Card>
      </View>
    );
  }

  // "Still loading" is not "already deleted". Both reads resolve to `null` when
  // the capture is genuinely gone; `undefined` means neither has answered yet,
  // and claiming a deletion during that frame is the same lie as claiming none
  // after one.
  const loading = capture === undefined || expiresAt === undefined;
  const expired = !loading && (capture === null || expiresAt === null || expiresAt <= now);
  const Glyph = expanded ? ChevronOpen : Chevron;

  return (
    <View testID={testID} className="px-4 pt-3">
      <Card variant="flat">
        <Pressable
          testID="why-recorded-toggle"
          onPress={() => setExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={WHY_RECORDED_TITLE}
          accessibilityState={{ expanded }}
          className="min-h-[44px] flex-row items-center gap-2"
        >
          <Text className="flex-1 text-base font-semibold text-fg dark:text-fg-dark">
            {WHY_RECORDED_TITLE}
          </Text>
          <Glyph size={18} className="text-fg-2 dark:text-fg-2-dark" />
        </Pressable>

        {expanded ? (
          <View testID="why-recorded-body" className="gap-3 pt-3">
            {expired ? (
              <Text
                testID="why-recorded-expiry"
                className="text-sm text-fg-2 dark:text-fg-2-dark"
              >
                {RAW_CAPTURE_EXPIRED_NOTICE}
              </Text>
            ) : null}

            {/* The text is rendered ONLY while it is genuinely live. Past the
                expiry the row may still be on disk — the purge runs at
                bootstrap — but the user was promised deletion at that instant,
                and showing it anyway would make the promise false on the very
                screen that makes it. */}
            {!expired && !loading && capture ? (
              <>
                <View className="gap-1">
                  <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">Read from</Text>
                  <Text
                    testID="why-recorded-provider"
                    className="text-sm font-semibold text-fg dark:text-fg-dark"
                  >
                    {providerName}
                  </Text>
                </View>

                <View testID="why-recorded-text" className="gap-1 rounded-xl bg-bg p-3 dark:bg-bg-dark">
                  {captureLines(capture).map((line) => (
                    <Text key={line} className="text-sm text-fg dark:text-fg-dark">
                      {line}
                    </Text>
                  ))}
                </View>

                {confidence !== undefined ? (
                  <Text
                    testID="why-recorded-confidence"
                    className="text-xs text-fg-2 dark:text-fg-2-dark"
                  >
                    {`Matched with ${Math.round(confidence * 100)}% confidence`}
                  </Text>
                ) : null}

                <Text
                  testID="why-recorded-expiry"
                  className="text-xs text-fg-2 dark:text-fg-2-dark"
                >
                  {captureExpiryLabel(expiresAt as EpochMs, now)}
                </Text>
              </>
            ) : null}
          </View>
        ) : null}
      </Card>
    </View>
  );
}
