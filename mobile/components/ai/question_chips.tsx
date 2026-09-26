// components/ai/question_chips.tsx
//
// THE WAY IN, UNDER SPEC §7.4. Each chip is a question whose tool is already
// decided (`lib/ai/fixed_questions.ts`), so tapping one is the only way the
// model is ever asked anything. The row scrolls sideways so it never costs the
// transcript more than one line of height.
import { ScrollView } from "react-native";

import { Chip } from "@/components/ui/chip";
import { FIXED_QUESTIONS, type FixedQuestion } from "@/lib/ai/fixed_questions";

export type QuestionChipsProps = {
  /** Omitted while an answer is being written: the chips then render as labels, not controls. */
  onAsk?: (question: FixedQuestion) => void;
  testID?: string;
};

/**
 * One tappable chip per fixed question, in a single sideways-scrolling row.
 *
 * @param props.onAsk - Called with the tapped question. Leave it out to show the chips without letting them be tapped.
 * @param props.testID - Root id; each chip gets `<testID>-<question id>`.
 */
export function QuestionChips({ onAsk, testID = "ai-question-chips" }: QuestionChipsProps) {
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-2 px-3 py-2"
    >
      {FIXED_QUESTIONS.map((question) => (
        <Chip
          key={question.id}
          testID={`${testID}-${question.id}`}
          label={question.label}
          tone="brand"
          fill="soft"
          onPress={onAsk === undefined ? undefined : () => onAsk(question)}
        />
      ))}
    </ScrollView>
  );
}
