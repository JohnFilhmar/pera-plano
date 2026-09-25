// components/ai/chat_surface.tsx — plan Task 23, spec §4.7/§4.8/§4.9 and §6
// risk 10; answer levels added 2026-09-25.
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
// A CHIP ALWAYS ANSWERS THE SAME WAY; TYPED TEXT DEPENDS ON THE LEVEL. Spec §7.4
// (2026-09-25) fixed each chip's tool. The answer levels decided the same day
// (docs/superpowers/specs/2026-09-25-assistant-levels-design.md) route typed
// text: the app's own replies at every level, the matching chip from level 2,
// and free chat with the model from level 3.
//
// WHAT FREE CHAT MAY SEND BACK is `turnsRef`: the model exchanges still on
// screen, cleared with the screen on lock. A level switch remounts this
// component (the screen keys it by level), which clears it too.
//
// THE PREVIEW IS NOT THE ANSWER. `dispatch.ts` says it outright: "the surface
// must not commit what it renders here... a token stream is a preview, and the
// returned `TurnOutcome` is the verdict." So streamed text lives in `stream`,
// is never appended to `messages`, and is discarded wholesale when the verdict
// is a card, a replacement line or a cancel. That is what makes the degradation
// in §4.8 possible at all: the fabricated ₱9,999.00 the user watched arrive
// leaves the screen, and the true ₱2,400.00 replaces it.
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
import { answerFreely } from "@/lib/ai/freeChat";
import { isFreeChatLevel, type AnswerLevel } from "@/lib/ai/levels";
import type { Turn } from "@/lib/ai/prompt";
import type { ToolResult } from "@/lib/ai/tools/types";
import { onAppEvent } from "@/lib/events/app_events";
import { usePlaceholderColor } from "@/lib/ui/placeholder";
import type { LlamaBridge } from "@/modules/llama_bridge/types";
import type { EpochMs } from "@/types/domain";

import { EMPTY_CHAT, FREE_CHAT_ACTIVITY, LEVEL_MARKER, answerNotice } from "./chat_copy";
import { QuestionChips } from "./question_chips";
import { TranscriptMessage, type Message } from "./TranscriptMessage";

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
   * business knowing how a model is chosen, sized, downloaded or deleted, and
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
   * was first rendered, which is wrong on the first of the month, at midnight,
   * and after the app has sat backgrounded overnight.
   */
  now: () => EpochMs;
  /** Spec §4.9: shown in full once, then as a quiet marker forever after. */
  disclaimerAcknowledged: boolean;
  onAcknowledgeDisclaimer: () => void;
  /** The answer level in force, already clamped by the entitlement. */
  level: AnswerLevel;
  /** The resident model's knowledge-limit month and context size; null before one is loaded. */
  model: { knowledgeLimit: string; contextTokens: number } | null;
  testID?: string;
};

/**
 * Filling the dead air, per spec §4.7: at 4-8 tok/s a tool round is seconds of
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

/**
 * The assistant's chat: the picker before a model exists, a waking screen while
 * one loads, then the transcript, the question chips and the composer.
 *
 * @param props - See `ChatSurfaceProps`.
 */
export function ChatSurface({
  phase,
  picker,
  bridge,
  runTool,
  now,
  disclaimerAcknowledged,
  onAcknowledgeDisclaimer,
  level,
  model,
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
  /** The model exchanges on screen, oldest first, for free chat's follow-ups. */
  const turnsRef = useRef<Turn[]>([]);

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
  // module clears the model's context; nothing there can reach the React state
  // holding what is on screen or what free chat would send back, and either one
  // left behind on a re-locked phone is the plaintext cache of a sealed ledger
  // the whole design exists to prevent.
  useEffect(
    () =>
      onAppEvent("lock:engaged", () => {
        if (abortRef.current !== null) abortRef.current.aborted = true;
        setMessages([]);
        turnsRef.current = [];
        clearInFlight();
      }),
    [clearInFlight],
  );

  // Leaving the screen, or switching level (which remounts this), must stop a
  // generation nobody will see.
  useEffect(
    () => () => {
      if (abortRef.current !== null) abortRef.current.aborted = true;
    },
    [],
  );

  const handleCancel = () => {
    if (abortRef.current !== null) abortRef.current.aborted = true;
    // The preview goes at once. Cancellation "must leave NO assistant message"
    // (`llama_bridge/types.ts`), and a half-finished sentence about money left
    // on screen while the loop unwinds is one.
    clearInFlight();
  };

  const onToken = (token: string) => {
    rawRef.current += token;
    const visible = visiblePrefix(rawRef.current);
    setStream(visible);
    // The first real word is a better liveness signal than any tool line, so
    // the tool line stands down the moment one arrives.
    if (visible.length > 0) setActivity(null);
  };

  const remember = (user: string, assistant: string) => {
    turnsRef.current = [...turnsRef.current, { role: "user", text: user }, { role: "assistant", text: assistant }];
  };

  // Every model turn starts and ends the same way, whichever path answers it.
  const startTurn = (activityLine: string): AbortFlag => {
    const abort: AbortFlag = { aborted: false };
    abortRef.current = abort;
    rawRef.current = "";
    setStream("");
    setActivity(activityLine);
    setGenerating(true);
    return abort;
  };

  const finishTurn = () => {
    abortRef.current = null;
    clearInFlight();
    setGenerating(false);
  };

  // A tapped chip, or typed text the app matched to one (level 2 and up). The
  // tool is fixed either way; `typed` is the user's own words when they typed.
  const runQuestion = async (question: FixedQuestion, typed: string | null) => {
    if (bridge === null) return;

    const abort = startTurn(TOOL_ACTIVITY[question.tool] ?? TOOL_ACTIVITY_FALLBACK);
    const answering = typed === null ? undefined : question.label;

    try {
      const outcome = await answerQuestion(question, { bridge, now: now(), abort, runTool, onToken });
      if (outcome.kind === "prose") {
        setMessages((prior) => [...prior, { id: nextId(), kind: "assistant", text: outcome.text, answering }]);
        remember(typed ?? question.label, outcome.text);
      } else if (outcome.kind === "card") {
        setMessages((prior) => [...prior, { id: nextId(), kind: "card", results: outcome.results, answering }]);
      }
    } finally {
      finishTurn();
    }
  };

  // Levels 3 to 5: the model answers typed text from a fresh records snapshot
  // and the exchanges still on screen.
  const runFreeChat = async (text: string) => {
    if (bridge === null || model === null || !isFreeChatLevel(level)) return;
    const freeLevel = level;
    const resident = model;

    const abort = startTurn(FREE_CHAT_ACTIVITY);

    try {
      const outcome = await answerFreely(text, {
        bridge,
        runTool,
        now: now(),
        level: freeLevel,
        model: resident,
        turns: turnsRef.current,
        abort,
        onToken,
      });
      if (outcome.kind === "prose") {
        const notice = answerNotice(freeLevel, resident.knowledgeLimit);
        setMessages((prior) => [...prior, { id: nextId(), kind: "assistant", text: outcome.text, notice }]);
        remember(text, outcome.text);
      } else if (outcome.kind === "replaced") {
        setMessages((prior) => [
          ...prior,
          { id: nextId(), kind: "replaced", failure: outcome.failure, language: outcome.language },
        ]);
      } else if (outcome.kind === "too_long") {
        setMessages((prior) => [...prior, { id: nextId(), kind: "too_long", language: outcome.language }]);
      }
    } finally {
      finishTurn();
    }
  };

  const handleAsk = async (question: FixedQuestion) => {
    if (generating || bridge === null) return;
    setMessages((prior) => [...prior, { id: nextId(), kind: "user", text: question.label }]);
    await runQuestion(question, null);
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (text.length === 0 || generating) return;

    setDraft("");
    setMessages((prior) => [...prior, { id: nextId(), kind: "user", text }]);
    setGenerating(true);

    const reply = await replyToText(text, { runTool, now: now(), level }).finally(() => {
      setGenerating(false);
    });

    if (reply.kind === "question") {
      await runQuestion(reply.question, text);
    } else if (reply.kind === "free_chat") {
      await runFreeChat(text);
    } else if (reply.kind === "redirect") {
      setMessages((prior) => [...prior, { id: nextId(), kind: "redirect", klass: reply.klass, results: reply.results }]);
    } else if (reply.kind === "smalltalk") {
      setMessages((prior) => [
        ...prior,
        { id: nextId(), kind: "smalltalk", talk: reply.talk, language: reply.language },
      ]);
    } else {
      setMessages((prior) => [...prior, { id: nextId(), kind: "cannot_answer", language: reply.language }]);
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
      <View testID={testID ?? "ai-waking"} className="flex-1 items-center justify-center gap-3 p-8">
        <ActivityIndicator />
        <Text className="text-title font-semibold text-fg dark:text-fg-dark">{WAKING_TITLE}</Text>
        <Text className="text-center text-body text-fg-2 dark:text-fg-2-dark">{WAKING_BODY}</Text>
      </View>
    );
  }

  return (
    <View testID={testID ?? "ai-chat"} className="flex-1">
      {disclaimerAcknowledged ? (
        <Text testID="ai-disclaimer-marker" className="px-4 py-2 text-micro text-fg-2 dark:text-fg-2-dark">
          {LEVEL_MARKER[level]}
        </Text>
      ) : (
        <View testID="ai-disclaimer" className="m-4 gap-2 rounded-2xl bg-brand-soft p-4 dark:bg-brand-soft-dark">
          <Text className="text-section font-semibold text-brand-ink dark:text-brand-ink-dark">{DISCLAIMER_TITLE}</Text>
          <Text className="text-body text-brand-ink dark:text-brand-ink-dark">{DISCLAIMER_BODY}</Text>
          <Button testID="ai-disclaimer-ack" title="Got it" variant="secondary" onPress={onAcknowledgeDisclaimer} />
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
        // The keyboard shrinks this from the bottom and the scroll offset stays
        // put, so without this the newest message slides under the composer.
        onLayout={() => scrollRef.current?.scrollToEnd({ animated: false })}
        ref={scrollRef}
      >
        {messages.length === 0 && !generating ? (
          <Text className="text-body text-fg-2 dark:text-fg-2-dark">{EMPTY_CHAT}</Text>
        ) : null}

        {messages.map((message) => (
          <TranscriptMessage key={message.id} message={message} />
        ))}

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
