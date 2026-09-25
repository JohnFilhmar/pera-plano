// components/ai/chat_surface.tsx — plan Task 23, spec §4.7/§4.8/§4.9 and §6
// risk 10.
//
// FOUR STATES, NOT THREE. Spec §4.7 names three; §6 risk 10 adds the fourth,
// and it is the one that bites: Android kills the app, the user comes back, and
// a 2.5 GB model has to be re-read from storage. "The 'no model yet' state and
// the 'model loading' state need different copy so the picker never flashes at
// a user who already has a model." `phase` therefore separates `no_model` from
// `waking` explicitly rather than deriving both from `bridge === null`.
//
// GENERATING IS NOT A PHASE THE CALLER OWNS. It is this component's own state,
// because only this component knows a turn is in flight, and because a screen
// that had to keep a `generating` flag in sync with the dispatch loop would
// drift out of sync exactly when it mattered.
//
// SPEC §7.4, CHOSEN 2026-09-25: QUESTIONS ARE TAPPED, NOT TYPED. A chip is
// the only thing that reaches the model, and its tool is already decided.
// Typed text gets a reply the app writes itself (`chat_copy.ts`): small talk,
// the advice redirect, or a pointer back at the chips.
//
// THE PREVIEW IS NOT THE ANSWER. `dispatch.ts` says it outright: "the surface
// must not commit what it renders here... a token stream is a preview, and the
// returned `TurnOutcome` is the verdict." So streamed text lives in `stream`,
// is never appended to `messages`, and is discarded wholesale when the verdict
// is a card or a cancel. That is what makes the degradation in §4.8 possible at
// all: the fabricated ₱9,999.00 the user watched arrive leaves the screen, and
// the true ₱2,400.00 replaces it.
//
// THE JS THREAD IS NEVER THE BOTTLENECK HERE. Decode happens behind
// `LlamaBridge` on a native thread; per token this component appends to a ref
// and sets one string of state. The message list stays in a plain ScrollView
// that is mounted in every state, so the chat scrolls while the model decodes
// (spec §5.6 gate 8 is the on-device confirmation of the same claim).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { answerQuestion, replyToText, type AbortFlag } from "@/lib/ai/dispatch";
import type { FixedQuestion } from "@/lib/ai/fixed_questions";
import type { ReplyLanguage, SmallTalk } from "@/lib/ai/small_talk";
import type { ToolResult } from "@/lib/ai/tools/types";
import type { AdviceClass } from "@/lib/ai/triage";
import { onAppEvent } from "@/lib/events/app_events";
import { usePlaceholderColor } from "@/lib/ui/placeholder";
import type { LlamaBridge } from "@/modules/llama_bridge/types";
import type { EpochMs } from "@/types/domain";

import { CANNOT_ANSWER_REPLY, EMPTY_CHAT, REDIRECT_LINE, SMALL_TALK_REPLY } from "./chat_copy";
import { GroundedCard } from "./grounded_card";
import { QuestionChips } from "./question_chips";

export type SurfacePhase =
  /** Nothing downloaded. The surface is the picker; see `picker`. */
  | "no_model"
  /** A model exists on disk and is being read back into RAM. Risk 10. */
  | "waking"
  /** Loaded and idle. Generating is derived from this component's own state. */
  | "ready";

export type ChatSurfaceProps = {
  phase: SurfacePhase;
  /**
   * Task 22's `model_picker`, injected rather than imported.
   *
   * The no-model state IS the picker (spec §4.7), but this component has no
   * business knowing how a model is chosen, sized, downloaded or deleted — and
   * taking it as a node keeps the picker's props out of the chat's type.
   */
  picker: ReactNode;
  /** `null` in `no_model`. Nothing can be asked without one. */
  bridge: LlamaBridge | null;
  runTool: (
    name: string,
    args: Record<string, unknown>,
    now: EpochMs,
  ) => Promise<ToolResult<unknown>>;
  /**
   * A FUNCTION, NOT A VALUE. A mounted chat outlives the moment it was opened,
   * and a captured timestamp would resolve "this month" to the month the screen
   * was first rendered — which is wrong on the first of the month, at midnight,
   * and after the app has sat backgrounded overnight.
   */
  now: () => EpochMs;
  /** Spec §4.9: shown in full once, then as a quiet marker forever after. */
  disclaimerAcknowledged: boolean;
  onAcknowledgeDisclaimer: () => void;
  testID?: string;
};

type Message =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "card"; results: ToolResult<unknown>[] }
  | { id: string; kind: "redirect"; klass: AdviceClass; results: ToolResult<unknown>[] }
  | { id: string; kind: "smalltalk"; talk: SmallTalk; language: ReplyLanguage }
  | { id: string; kind: "cannot_answer"; language: ReplyLanguage };

/**
 * Filling the dead air, per spec §4.7: at 4–8 tok/s a tool round is seconds of
 * nothing, "because that is otherwise dead air in which the user concludes the
 * app has frozen".
 *
 * Keyed by the wire names in `lib/ai/tools/schemas.ts`. An unmapped tool falls
 * back rather than showing its wire name: a new handler landing without a line
 * here should read vaguely, never like a leaked internal.
 */
const TOOL_ACTIVITY: Record<string, string> = {
  get_wallets: "Looking at your wallets…",
  get_balance_total: "Adding up your balances…",
  get_safe_to_spend: "Working out your safe-to-spend…",
  get_limits: "Looking at your limits…",
  get_income_profile: "Looking at your income…",
  get_spend_by_category: "Looking at your spending…",
  list_transactions: "Looking through your transactions…",
};

const TOOL_ACTIVITY_FALLBACK = "Looking at your ledger…";

/** Spec §4.7: an invitation, not an error and not an empty state. */
const NO_MODEL_TITLE = "Ask about your money";
const NO_MODEL_BODY =
  "Pick a model to download and it can explain what is already recorded in your ledger. It runs on this phone, and your conversations are never saved anywhere.";

/**
 * Risk 10's copy. It says a model EXISTS and is being read back, which is the
 * whole difference from the state above: someone who already downloaded 2.5 GB
 * must never be shown a download list again because Android reclaimed the
 * process while they were in the camera.
 */
const WAKING_TITLE = "Waking up…";
const WAKING_BODY =
  "Your model is being read back from storage. This takes a few seconds after Android has closed the app.";

/**
 * Spec §4.9. The one thing it must be precise about is the split: wording can
 * be wrong, figures cannot, because every figure on screen came from the ledger
 * and not from the model (spec §5.2/7).
 */
const DISCLAIMER_TITLE = "Before you start";
const DISCLAIMER_BODY =
  "This runs entirely on your phone and only explains what is already recorded here. It can word things oddly or miss the point of a question, but every peso figure it shows is read straight from your ledger, never written by the model.";
const DISCLAIMER_MARKER = "On-device · explains your ledger · figures come from your records";

/**
 * What may be shown of the raw output SO FAR.
 *
 * JSON must never reach the screen as prose, and it is only recognisable from a
 * partial string: `llama_bridge_mock.ts` reproduces a consumer rendering
 * `{"tool":"get_wal` as an answer before the closing brace arrives. Tested over
 * RAW output, not a trimmed copy, for the same reason `dispatch.ts` does: a
 * single leading space is invisible after trimming.
 */
function visiblePrefix(raw: string): string {
  return raw.trimStart().startsWith("{") ? "" : raw;
}

export function ChatSurface({
  phase,
  picker,
  bridge,
  runTool,
  now,
  disclaimerAcknowledged,
  onAcknowledgeDisclaimer,
  testID,
}: ChatSurfaceProps) {
  const placeholderColor = usePlaceholderColor();

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [stream, setStream] = useState("");
  const [activity, setActivity] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** The current turn's raw output, so `visiblePrefix` can rule on all of it. */
  const rawRef = useRef("");
  const abortRef = useRef<AbortFlag | null>(null);
  const idRef = useRef(0);

  const nextId = () => {
    idRef.current += 1;
    return `m${idRef.current}`;
  };

  const clearInFlight = useCallback(() => {
    rawRef.current = "";
    setStream("");
    setActivity(null);
  }, []);

  // THE SURFACE IS SUBORDINATE TO THE LOCK, exactly as `session.ts` is. That
  // module clears the transcript the model sees; nothing there can reach the
  // React state holding what is on screen, and a rendered transcript left
  // behind on a re-locked phone is the plaintext cache of a sealed ledger the
  // whole design exists to prevent.
  useEffect(
    () =>
      onAppEvent("lock:engaged", () => {
        if (abortRef.current !== null) abortRef.current.aborted = true;
        setMessages([]);
        clearInFlight();
      }),
    [clearInFlight],
  );

  const handleCancel = () => {
    if (abortRef.current !== null) abortRef.current.aborted = true;
    // The preview goes at once. Cancellation "must leave NO assistant message"
    // (`llama_bridge/types.ts`), and a half-finished sentence about money left
    // on screen while the loop unwinds is one.
    clearInFlight();
  };

  // A tapped question: its tool is fixed, so the tool line can show at once.
  const handleAsk = async (question: FixedQuestion) => {
    if (generating || bridge === null) return;

    const abort: AbortFlag = { aborted: false };
    abortRef.current = abort;
    rawRef.current = "";
    setStream("");
    setActivity(TOOL_ACTIVITY[question.tool] ?? TOOL_ACTIVITY_FALLBACK);
    setMessages((prior) => [...prior, { id: nextId(), kind: "user", text: question.label }]);
    setGenerating(true);

    try {
      const outcome = await answerQuestion(question, {
        bridge,
        now: now(),
        abort,
        runTool,
        onToken: (token) => {
          rawRef.current += token;
          const visible = visiblePrefix(rawRef.current);
          setStream(visible);
          // The first real word is a better liveness signal than any tool line,
          // so the tool line stands down the moment one arrives.
          if (visible.length > 0) setActivity(null);
        },
      });

      if (outcome.kind === "prose") {
        setMessages((prior) => [...prior, { id: nextId(), kind: "assistant", text: outcome.text }]);
      } else if (outcome.kind === "card") {
        setMessages((prior) => [...prior, { id: nextId(), kind: "card", results: outcome.results }]);
      }
    } finally {
      abortRef.current = null;
      clearInFlight();
      setGenerating(false);
    }
  };

  // Typed text never reaches the model; every reply here is the app's own.
  const handleSend = async () => {
    const text = draft.trim();
    if (text.length === 0 || generating) return;

    setDraft("");
    setMessages((prior) => [...prior, { id: nextId(), kind: "user", text }]);
    setGenerating(true);

    try {
      const reply = await replyToText(text, { runTool, now: now() });
      if (reply.kind === "redirect") {
        setMessages((prior) => [
          ...prior,
          { id: nextId(), kind: "redirect", klass: reply.klass, results: reply.results },
        ]);
      } else if (reply.kind === "smalltalk") {
        setMessages((prior) => [
          ...prior,
          { id: nextId(), kind: "smalltalk", talk: reply.talk, language: reply.language },
        ]);
      } else {
        setMessages((prior) => [
          ...prior,
          { id: nextId(), kind: "cannot_answer", language: reply.language },
        ]);
      }
    } finally {
      setGenerating(false);
    }
  };

  if (phase === "no_model") {
    return (
      <View testID={testID ?? "ai-no-model"} className="flex-1 gap-4 p-4">
        <Text className="text-title font-semibold text-fg dark:text-fg-dark">{NO_MODEL_TITLE}</Text>
        <Text className="text-body text-fg-2 dark:text-fg-2-dark">{NO_MODEL_BODY}</Text>
        {picker}
      </View>
    );
  }

  if (phase === "waking") {
    return (
      <View
        testID={testID ?? "ai-waking"}
        className="flex-1 items-center justify-center gap-3 p-8"
      >
        <ActivityIndicator />
        <Text className="text-title font-semibold text-fg dark:text-fg-dark">{WAKING_TITLE}</Text>
        <Text className="text-center text-body text-fg-2 dark:text-fg-2-dark">{WAKING_BODY}</Text>
      </View>
    );
  }

  return (
    <View testID={testID ?? "ai-chat"} className="flex-1">
      {disclaimerAcknowledged ? (
        <Text
          testID="ai-disclaimer-marker"
          className="px-4 py-2 text-micro text-fg-2 dark:text-fg-2-dark"
        >
          {DISCLAIMER_MARKER}
        </Text>
      ) : (
        <View
          testID="ai-disclaimer"
          className="m-4 gap-2 rounded-2xl bg-brand-soft p-4 dark:bg-brand-soft-dark"
        >
          <Text className="text-section font-semibold text-brand-ink dark:text-brand-ink-dark">
            {DISCLAIMER_TITLE}
          </Text>
          <Text className="text-body text-brand-ink dark:text-brand-ink-dark">
            {DISCLAIMER_BODY}
          </Text>
          <Button
            testID="ai-disclaimer-ack"
            title="Got it"
            variant="secondary"
            onPress={onAcknowledgeDisclaimer}
          />
        </View>
      )}

      {/* Mounted in every state and never swapped for a spinner, so the chat
          stays scrollable while the model decodes. */}
      <ScrollView
        testID="ai-transcript"
        className="flex-1"
        contentContainerClassName="gap-3 p-4"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        ref={scrollRef}
      >
        {messages.length === 0 && !generating ? (
          <Text className="text-body text-fg-2 dark:text-fg-2-dark">{EMPTY_CHAT}</Text>
        ) : null}

        {messages.map((message) => {
          if (message.kind === "user") {
            return (
              <View
                key={message.id}
                className="self-end rounded-2xl bg-brand px-4 py-3 dark:bg-brand-dark"
              >
                <Text className="text-body text-on-brand dark:text-on-brand-dark">
                  {message.text}
                </Text>
              </View>
            );
          }
          if (message.kind === "assistant") {
            return (
              <Text key={message.id} className="text-body text-fg dark:text-fg-dark">
                {message.text}
              </Text>
            );
          }
          if (message.kind === "smalltalk") {
            return (
              <Text key={message.id} className="text-body text-fg dark:text-fg-dark">
                {SMALL_TALK_REPLY[message.talk][message.language]}
              </Text>
            );
          }
          if (message.kind === "cannot_answer") {
            return (
              <Text key={message.id} className="text-body text-fg-2 dark:text-fg-2-dark">
                {CANNOT_ANSWER_REPLY[message.language]}
              </Text>
            );
          }
          if (message.kind === "redirect") {
            return (
              <View key={message.id} className="gap-2">
                <Text className="text-body text-fg dark:text-fg-dark">
                  {REDIRECT_LINE[message.klass]}
                </Text>
                <GroundedCard results={message.results} />
              </View>
            );
          }
          return <GroundedCard key={message.id} results={message.results} />;
        })}

        {activity === null ? null : (
          <Text testID="ai-activity" className="text-body text-fg-2 dark:text-fg-2-dark">
            {activity}
          </Text>
        )}

        {stream.length === 0 ? null : (
          <Text testID="ai-stream" className="text-body text-fg dark:text-fg-dark">
            {stream}
          </Text>
        )}
      </ScrollView>

      <View className="border-t border-line dark:border-line-dark">
        <QuestionChips onAsk={generating ? undefined : (question) => void handleAsk(question)} />
        <View className="flex-row items-end gap-2 px-3 pb-3">
          <TextInput
            testID="ai-composer-input"
            accessibilityLabel="Message the assistant"
            className="min-h-[44px] flex-1 rounded-xl bg-chip px-3 py-3 text-fg dark:bg-chip-dark dark:text-fg-dark"
            multiline
            onChangeText={setDraft}
            placeholder="Or type a message"
            placeholderTextColor={placeholderColor}
            value={draft}
          />
          {generating ? (
            <Button testID="ai-cancel" title="Stop" variant="secondary" onPress={handleCancel} />
          ) : (
            <Button
              testID="ai-composer-send"
              title="Send"
              disabled={draft.trim().length === 0}
              onPress={() => void handleSend()}
            />
          )}
        </View>
      </View>
    </View>
  );
}
