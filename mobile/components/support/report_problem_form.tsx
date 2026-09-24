// components/support/report_problem_form.tsx — the form itself. Presentational:
// it renders fields and calls back. The screen owns the outbox, the picker and
// the navigation.
//
// THE FORM NEVER TALKS ABOUT THE NETWORK. There is no "you appear to be
// offline" banner, no connectivity check, and no disabled Send button when
// signal is bad — the whole point of the outbox behind it is that pressing
// Send is a complete action either way. What the screen shows afterwards
// ("Waiting to send") is honest about where the report is; putting a warning
// here would only teach the user to wait for signal before reporting a bug,
// which is the behaviour this feature was built to make unnecessary.
//
// TOPIC IS REQUIRED AND HAS NO DEFAULT SELECTION. A pre-selected first chip is
// the answer most users would leave in place, which turns a routing field into
// noise — every ticket arriving as "Transactions not showing up" is worse for
// triage than no category at all.
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SUPPORT_TOPICS, SUPPORT_TOPIC_LABELS, type SupportTopic } from "@/types/support";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

/** Enough to be a subject line, short enough to stay one. */
const MAX_TITLE_LENGTH = 120;

/**
 * Generous, and enforced here as well as (eventually) on the server. A user
 * describing an intermittent bug writes paragraphs; a user whose keyboard has
 * pasted their clipboard writes a novel, and the report then fails a server
 * limit it can never satisfy on retry.
 */
const MAX_DESCRIPTION_LENGTH = 4000;

/** Short enough that "it broke" passes. The field is not a quality gate. */
const MIN_DESCRIPTION_LENGTH = 10;

export type ReportProblemFormValues = {
  title: string;
  description: string;
  topic: SupportTopic;
};

export type ReportProblemFormProps = {
  onSubmit: (values: ReportProblemFormValues) => void;
  /** The attachment strip, injected by the screen — it owns the picker. */
  attachmentSlot?: ReactNode;
  busy?: boolean;
};

/** The label rhythm the rest of this app's forms use (components/goals/goal_form.tsx). */
function FieldLabel({ children }: { children: string }) {
  return <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">{children}</Text>;
}

export function ReportProblemForm({
  onSubmit,
  attachmentSlot,
  busy = false,
}: ReportProblemFormProps) {
  const placeholderColor = usePlaceholderColor();
  const [topic, setTopic] = useState<SupportTopic | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const titleError = trimmedTitle.length === 0 ? "Give it a short title." : null;
  const descriptionError =
    trimmedDescription.length < MIN_DESCRIPTION_LENGTH
      ? "Tell us a bit more about what happened."
      : null;
  const topicError = topic === null ? "Pick what this is about." : null;
  const valid = titleError === null && descriptionError === null && topicError === null;

  // ERRORS APPEAR ON THE FIRST SEND ATTEMPT, not while typing. A required-field
  // message under a field nobody has reached yet reads as a scolding, and this
  // is a form people arrive at already annoyed.
  const handleSubmit = () => {
    if (!valid || topic === null) {
      setShowErrors(true);
      return;
    }
    onSubmit({ title: trimmedTitle, description: trimmedDescription, topic });
  };

  return (
    <View className="flex-1 gap-5 p-4">
      <View className="gap-2">
        <FieldLabel>What is this about?</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {SUPPORT_TOPICS.map((candidate) => (
            <Chip
              key={candidate}
              testID={`support-topic-${candidate}`}
              label={SUPPORT_TOPIC_LABELS[candidate]}
              tone={topic === candidate ? "brand" : "neutral"}
              selected={topic === candidate}
              onPress={() => setTopic(candidate)}
            />
          ))}
        </View>
        {showErrors && topicError ? (
          <Text testID="support-topic-error" className="text-micro text-danger dark:text-danger-dark">
            {topicError}
          </Text>
        ) : null}
      </View>

      <View className="gap-1">
        <FieldLabel>Title</FieldLabel>
        <TextInput
          placeholderTextColor={placeholderColor}
          testID="support-title"
          className="min-h-[44px] rounded-xl bg-chip px-3 py-3 text-fg dark:bg-chip-dark dark:text-fg-dark"
          placeholder="Transfers show up twice"
          maxLength={MAX_TITLE_LENGTH}
          value={title}
          onChangeText={setTitle}
        />
        {showErrors && titleError ? (
          <Text testID="support-title-error" className="text-micro text-danger dark:text-danger-dark">
            {titleError}
          </Text>
        ) : null}
      </View>

      <View className="gap-1">
        <FieldLabel>What happened?</FieldLabel>
        <TextInput
          placeholderTextColor={placeholderColor}
          testID="support-description"
          className="min-h-[120px] rounded-xl bg-chip px-3 py-3 text-fg dark:bg-chip-dark dark:text-fg-dark"
          placeholder="What you did, what you expected, what happened instead."
          multiline
          textAlignVertical="top"
          maxLength={MAX_DESCRIPTION_LENGTH}
          value={description}
          onChangeText={setDescription}
        />
        {showErrors && descriptionError ? (
          <Text
            testID="support-description-error"
            className="text-micro text-danger dark:text-danger-dark"
          >
            {descriptionError}
          </Text>
        ) : null}
      </View>

      {attachmentSlot ? (
        <View className="gap-1">
          <FieldLabel>Screenshots</FieldLabel>
          {attachmentSlot}
        </View>
      ) : null}

      {/* The one paragraph that makes the feature legible: the report leaves the
          phone, and only the parts below travel. Stated before Send, not after
          — this app's Privacy Centre makes the same promise about telemetry in
          the same place, and a report is the one payload that carries what the
          user typed.

          IT NAMES EVERY FIELD ON THE WIRE, and it used to name only four of
          them before claiming nothing else was included. The rest —
          `services/support_reports.ts`'s reportId/createdAt/attemptCount and
          `services/device_info.ts`'s four headers — are harmless, but an
          absolute claim the payload does not meet is not, least of all on the
          one screen where the user consents to sending anything.
          `__tests__/report_problem_form.test.tsx` walks both of those sources
          and fails on a field this sentence does not mention. */}
      <Text testID="support-disclosure" className="text-micro text-fg-2 dark:text-fg-2-dark">
        Sending this shares your title, description, topic and any files you attached with the
        PeraPlano developer. It also carries a report id, when you wrote it, how many send attempts
        it took, and the app version, phone system and system version of the mobile app you are
        using. Nothing else from the app is included, and nothing is sent until you press Send.
      </Text>

      <Button
        testID="support-submit"
        title="Send report"
        onPress={handleSubmit}
        loading={busy}
      />
    </View>
  );
}
