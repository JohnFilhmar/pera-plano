// components/ai/LevelPicker.tsx
//
// THE ANSWER-LEVEL SHEET. Assistant levels spec §6: five rows with their
// descriptions and a check on the current one. Levels 4 and 5 sit inside the
// Plus gate and, the first time, behind a read-and-accept notice.
//
// THE SHEET STEPS ASIDE FOR THE NOTICE rather than stacking a dialog on top of
// it: two platform modals open at once is the kind of thing that works on one
// Android version and not the next.
import { useState } from "react";
import { Check } from "lucide-react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { registerIcon } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import { ListRow } from "@/components/ui/list_row";
import { ANSWER_LEVELS, LEVEL_ORDER, describeLevel, type AnswerLevel } from "@/lib/ai/levels";

const CheckGlyph = registerIcon(Check);

export type LevelPickerProps = {
  visible: boolean;
  /** The level in force now. */
  level: AnswerLevel;
  /** Whether the notice for levels 4 and 5 was already accepted. */
  accepted: boolean;
  /** The resident model's release month, for level 5's description and the notice. */
  knowledgeLimit: string;
  /** Called with the chosen level; `acceptedNow` is true when the notice was just accepted. */
  onChoose: (level: AnswerLevel, acceptedNow: boolean) => void;
  onDismiss: () => void;
};

/**
 * The notice a user accepts before level 4 or 5 turns on (spec §6).
 *
 * @param knowledgeLimit - The resident model's release month.
 * @returns The notice's body text.
 */
export function acceptNotice(knowledgeLimit: string): string {
  return `Levels 4 and 5 answer from the model's memory. It can be wrong, and it knows nothing after ${knowledgeLimit}. Peso figures still come only from your records, and it still won't advise you on money.`;
}

/**
 * Lets the user choose how much the assistant may do.
 *
 * @param props - See `LevelPickerProps`.
 */
export function LevelPicker({ visible, level, accepted, knowledgeLimit, onChoose, onDismiss }: LevelPickerProps) {
  const [pending, setPending] = useState<AnswerLevel | null>(null);

  const choose = (next: AnswerLevel) => {
    if (ANSWER_LEVELS[next].gated && !accepted) {
      setPending(next);
      return;
    }
    onChoose(next, false);
  };

  return (
    <>
      <BottomSheet visible={visible && pending === null} title="Answer style" onDismiss={onDismiss}>
        {LEVEL_ORDER.map((candidate) => {
          const info = ANSWER_LEVELS[candidate];
          const row = (
            <ListRow
              key={candidate}
              testID={`ai-level-${candidate}`}
              title={`${candidate}. ${info.name}`}
              subtitle={describeLevel(candidate, knowledgeLimit)}
              subtitleLines={3}
              right={
                candidate === level ? <CheckGlyph size={18} className="text-brand dark:text-brand-dark" /> : undefined
              }
              onPress={() => choose(candidate)}
            />
          );
          return info.gated ? (
            <PlusGate key={candidate} capability="assistant_levels">
              {row}
            </PlusGate>
          ) : (
            row
          );
        })}
      </BottomSheet>
      <ConfirmDialog
        visible={pending !== null}
        title="Before you turn this on"
        body={acceptNotice(knowledgeLimit)}
        confirmLabel={pending === null ? "Turn it on" : `Turn on level ${pending}`}
        onConfirm={() => {
          if (pending !== null) onChoose(pending, true);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
