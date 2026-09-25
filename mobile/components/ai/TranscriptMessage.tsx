// components/ai/TranscriptMessage.tsx
//
// ONE MESSAGE IN THE CHAT, BY KIND. Moved out of `chat_surface.tsx` when the
// answer levels added kinds of their own and that file had passed 400 lines.
import { Text, View } from "react-native";

import type { FreeChatFailure } from "@/lib/ai/freeChat";
import type { ReplyLanguage, SmallTalk } from "@/lib/ai/small_talk";
import type { ToolResult } from "@/lib/ai/tools/types";
import type { AdviceClass } from "@/lib/ai/triage";

import {
  CANNOT_ANSWER_REPLY,
  FREE_CHAT_REPLACED,
  REDIRECT_LINE,
  SMALL_TALK_REPLY,
  TOO_LONG_REPLY,
  answeringLabel,
} from "./chat_copy";
import { GroundedCard } from "./grounded_card";

/** Everything the chat can show. `answering` holds a matched question's label. */
export type Message =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; answering?: string; notice?: string }
  | { id: string; kind: "card"; results: ToolResult<unknown>[]; answering?: string }
  | { id: string; kind: "redirect"; klass: AdviceClass; results: ToolResult<unknown>[] }
  | { id: string; kind: "smalltalk"; talk: SmallTalk; language: ReplyLanguage }
  | { id: string; kind: "cannot_answer"; language: ReplyLanguage }
  | { id: string; kind: "replaced"; failure: FreeChatFailure; language: ReplyLanguage }
  | { id: string; kind: "too_long"; language: ReplyLanguage };

function AnsweringLabel({ label }: { label: string | undefined }) {
  if (label === undefined) return null;
  return (
    <Text testID="ai-answering" className="text-micro text-fg-2 dark:text-fg-2-dark">
      {answeringLabel(label)}
    </Text>
  );
}

/**
 * Renders one chat message.
 *
 * @param props.message - The message; its `kind` decides how it looks.
 */
export function TranscriptMessage({ message }: { message: Message }) {
  switch (message.kind) {
    case "user":
      return (
        <View className="self-end rounded-2xl bg-brand px-4 py-3 dark:bg-brand-dark">
          <Text className="text-body text-on-brand dark:text-on-brand-dark">{message.text}</Text>
        </View>
      );
    case "assistant":
      return (
        <View className="gap-1">
          <AnsweringLabel label={message.answering} />
          <Text className="text-body text-fg dark:text-fg-dark">{message.text}</Text>
          {message.notice === undefined ? null : (
            <Text testID="ai-answer-notice" className="text-micro text-fg-2 dark:text-fg-2-dark">
              {message.notice}
            </Text>
          )}
        </View>
      );
    case "card":
      return (
        <View className="gap-1">
          <AnsweringLabel label={message.answering} />
          <GroundedCard results={message.results} />
        </View>
      );
    case "redirect":
      return (
        <View className="gap-2">
          <Text className="text-body text-fg dark:text-fg-dark">{REDIRECT_LINE[message.klass]}</Text>
          <GroundedCard results={message.results} />
        </View>
      );
    case "smalltalk":
      return (
        <Text className="text-body text-fg dark:text-fg-dark">{SMALL_TALK_REPLY[message.talk][message.language]}</Text>
      );
    case "cannot_answer":
      return <Text className="text-body text-fg-2 dark:text-fg-2-dark">{CANNOT_ANSWER_REPLY[message.language]}</Text>;
    case "replaced":
      return (
        <Text className="text-body text-fg-2 dark:text-fg-2-dark">
          {FREE_CHAT_REPLACED[message.failure][message.language]}
        </Text>
      );
    case "too_long":
      return <Text className="text-body text-fg-2 dark:text-fg-2-dark">{TOO_LONG_REPLY[message.language]}</Text>;
  }
}
