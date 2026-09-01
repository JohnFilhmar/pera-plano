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
// THE PREVIEW IS NOT THE ANSWER. `dispatch.ts` says it outright: "the surface
// must not commit what it renders here... a token stream is a preview, and the
// returned `TurnOutcome` is the verdict." So streamed text lives in `stream`,
// is never appended to `messages`, and is discarded wholesale when the verdict
// is a card, a decline or a cancel. That is what makes the degradation in §4.8
// possible at all: the fabricated ₱9,999.00 the user watched arrive leaves the
// screen, and the true ₱2,400.00 replaces it.
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
import { runTurn, type AbortFlag } from "@/lib/ai/dispatch";
import { getSession } from "@/lib/ai/session";
import { CANNOT_ANSWER } from "@/lib/ai/tools/grammar";
import type { ToolResult } from "@/lib/ai/tools/types";
import type { AdviceClass } from "@/lib/ai/triage";
import { onAppEvent } from "@/lib/events/app_events";
import { usePlaceholderColor } from "@/lib/ui/placeholder";
import type { LlamaBridge } from "@/modules/llama_bridge/types";
import type { EpochMs } from "@/types/domain";

import { GroundedCard } from "./grounded_card";

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
  | { id: string; kind: "declined" };

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

const EMPTY_CHAT =
  "Ask about your spending, your limits, your wallets or what is safe to spend.";

/** Spec §4.3: a refusal with no data attached is a failed redirect. */
const REDIRECT_LINE: Record<AdviceClass, string> = {
  permission: "PeraPlano does not tell you what to do with your money. Here is what it can show you.",
  affordability: "PeraPlano will not decide this for you. Here are the numbers you would decide on.",
  worth: "Whether it is worth it is your call. Here is what your ledger says.",
  direction: "PeraPlano does not give financial advice. Here is what is recorded.",
};

const DECLINED_LINE = "That one is outside what your ledger can answer.";

/**
 * What may be shown of the raw output SO FAR.
 *
 * Two things must never reach the screen as prose, and both are only
 * recognisable from a partial string:
 *
 *   - A TOOL CALL. `llama_bridge_mock.ts` reproduces the exact bug: a consumer
 *     rendering `{"tool":"get_wal` as an answer before the closing brace
 *     arrives. Tested over RAW output, not a trimmed copy, for the same reason
 *     `dispatch.ts` does — a single leading space is invisible after trimming.
 *   - THE DECLINE SENTINEL. `CANNOT_ANSWER` is a grammar branch, not English,
 *     and flashing it before `dispatch.ts` translates it into a decline is a
 *     wire token on a user's screen.
 */
function visiblePrefix(raw: string): string {
  const leading = raw.trimStart();
  if (leading.startsWith("{")) return "";
  const settled = leading.trimEnd();
  if (settled.length > 0 && CANNOT_ANSWER.startsWith(settled)) return "";
  return raw;
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

  const handleSend = async () => {
    const question = draft.trim();
    if (question.length === 0 || generating || bridge === null) return;

    const abort: AbortFlag = { aborted: false };
    abortRef.current = abort;
    rawRef.current = "";
    setDraft("");
    setStream("");
    setActivity(null);
    setMessages((prior) => [...prior, { id: nextId(), kind: "user", text: question }]);
    setGenerating(true);

    const session = getSession();

    try {
      const outcome = await runTurn(question, {
        bridge,
        now: now(),
        transcript: session.transcript,
        abort,
        runTool: async (name, args, at) => {
          setActivity(TOOL_ACTIVITY[name] ?? TOOL_ACTIVITY_FALLBACK);
          try {
            return await runTool(name, args, at);
          } finally {
            // The round that produced this call has ended. Its raw output was a
            // JSON tool call, so leaving the accumulator populated would keep
            // `visiblePrefix` suppressing the NEXT round's first tokens.
            rawRef.current = "";
            setStream("");
          }
        },
        onToken: (token) => {
          rawRef.current += token;
          const visible = visiblePrefix(rawRef.current);
          setStream(visible);
          // The first real word is a better liveness signal than any tool line,
          // so the tool line stands down the moment one arrives.
          if (visible.length > 0) setActivity(null);
        },
      });

      switch (outcome.kind) {
        case "prose":
          // Only a surviving answer joins the transcript. A degraded turn is
          // deliberately not remembered: feeding the model back a sentence that
          // was rejected for being ungrounded invites it to say it again.
          session.transcript.push(
            { role: "user", text: question },
            { role: "assistant", text: outcome.text },
          );
          setMessages((prior) => [...prior, { id: nextId(), kind: "assistant", text: outcome.text }]);
          break;
        case "card":
          setMessages((prior) => [...prior, { id: nextId(), kind: "card", results: outcome.results }]);
          break;
        case "redirect":
          setMessages((prior) => [
            ...prior,
            { id: nextId(), kind: "redirect", klass: outcome.klass, results: outcome.results },
          ]);
          break;
        case "declined":
          setMessages((prior) => [...prior, { id: nextId(), kind: "declined" }]);
          break;
        case "cancelled":
          break;
      }
    } finally {
      abortRef.current = null;
      clearInFlight();
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
          if (message.kind === "declined") {
            return (
              <Text key={message.id} className="text-body text-fg-2 dark:text-fg-2-dark">
                {DECLINED_LINE}
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

      <View className="flex-row items-end gap-2 border-t border-line p-3 dark:border-line-dark">
        <TextInput
          testID="ai-composer-input"
          accessibilityLabel="Ask about your money"
          className="min-h-[44px] flex-1 rounded-xl bg-chip px-3 py-3 text-fg dark:bg-chip-dark dark:text-fg-dark"
          multiline
          onChangeText={setDraft}
          placeholder="Ask about your money"
          placeholderTextColor={placeholderColor}
          value={draft}
        />
        {generating ? (
          <Button testID="ai-cancel" title="Stop" variant="secondary" onPress={handleCancel} />
        ) : (
          <Button
            testID="ai-composer-send"
            title="Ask"
            disabled={draft.trim().length === 0}
            onPress={() => void handleSend()}
          />
        )}
      </View>
    </View>
  );
}
