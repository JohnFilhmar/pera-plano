// components/ai/chat_copy.ts
//
// EVERY REPLY THE APP WRITES ITSELF, as opposed to one the model narrates. Under
// spec §7.4 typed text never reaches the model, so these lines are the whole
// voice of the chat for anything that is not a tapped question. Each one points
// back at the question chips, because they are the way in.
//
// FILIPINO COPY IS A FIRST DRAFT for the owner to read, not a translation anyone
// has checked yet.
import type { FreeChatFailure } from "@/lib/ai/freeChat";
import type { AnswerLevel, FreeChatLevel } from "@/lib/ai/levels";
import type { ReplyLanguage, SmallTalk } from "@/lib/ai/small_talk";
import type { AdviceClass } from "@/lib/ai/triage";

/** Spec §4.3: a refusal with no data attached is a failed redirect. */
export const REDIRECT_LINE: Record<AdviceClass, string> = {
  permission: "PeraPlano does not tell you what to do with your money. Here is what it can show you.",
  affordability: "PeraPlano will not decide this for you. Here are the numbers you would decide on.",
  worth: "Whether it is worth it is your call. Here is what your ledger says.",
  direction: "PeraPlano does not give financial advice. Here is what is recorded.",
};

export const SMALL_TALK_REPLY: Record<SmallTalk, Record<ReplyLanguage, string>> = {
  greeting: {
    en: "Hi! I can explain what is recorded in your ledger. Tap a question below to start.",
    fil: "Kumusta! Kaya kong ipaliwanag ang nakatala sa ledger mo. Pumili ng tanong sa ibaba.",
  },
  thanks: {
    en: "You're welcome. Tap another question whenever you like.",
    fil: "Walang anuman. Pumili ulit ng tanong kung may gusto ka pang malaman.",
  },
  help: {
    en: "I answer questions about your own records: your balance, wallets, safe-to-spend, limits, spending and income. Tap one below.",
    fil: "Sumasagot ako tungkol sa sarili mong records: balance, wallets, safe-to-spend, limits, gastos at kita. Pumili ng tanong sa ibaba.",
  },
  goodbye: {
    en: "Bye! Nothing from this chat is saved.",
    fil: "Paalam! Walang nase-save sa usapang ito.",
  },
};

/** For typed text that is neither small talk nor an advice question. */
export const CANNOT_ANSWER_REPLY: Record<ReplyLanguage, string> = {
  en: "I can only answer the questions below, from your own records. Tap one to see the answer.",
  fil: "Ang mga tanong lang sa ibaba ang kaya kong sagutin, mula sa sarili mong records. Pumili ng isa.",
};

export const EMPTY_CHAT = "Tap a question below and I will answer it from your own records.";

/**
 * The line at the top of the chat, per answer level (assistant levels spec
 * §5.3). "Peso figures come from your records" is true at every level.
 */
export const LEVEL_MARKER: Record<AnswerLevel, string> = {
  1: "On-device · explains your ledger · figures come from your records",
  2: "On-device · explains your ledger · figures come from your records",
  3: "On-device · chats about your ledger · figures come from your records",
  4: "On-device · your ledger and general money topics · peso figures come from your records",
  5: "On-device · answers from memory can be wrong · peso figures come from your records",
};

export const MONEY_TALK_NOTICE = "From the model's general knowledge. It can be wrong.";

/**
 * The line under a free-chat answer (spec §5.3). Chip answers never get one.
 *
 * @param level - The free-chat level the answer was given at.
 * @param knowledgeLimit - The resident model's release month, named at level 5.
 * @returns The notice, or undefined at level 3.
 */
export function answerNotice(level: FreeChatLevel, knowledgeLimit: string): string | undefined {
  switch (level) {
    case 3:
      return undefined;
    case 4:
      return MONEY_TALK_NOTICE;
    case 5:
      return `From the model's memory. It can be wrong, and it knows nothing after ${knowledgeLimit}.`;
  }
}

/**
 * The label over an answer to typed text the app matched to a question, so a
 * wrong match is visible (spec §2).
 *
 * @param questionLabel - The fixed question's own label.
 * @returns The label as shown.
 */
export function answeringLabel(questionLabel: string): string {
  return `Answering: ${questionLabel}`;
}

/** What replaces a free-chat answer that failed a check (spec §5.2). */
export const FREE_CHAT_REPLACED: Record<FreeChatFailure, Record<ReplyLanguage, string>> = {
  ungrounded: {
    en: "That answer had an amount or a date that isn't in your records, so I didn't show it. Tap a question below for the exact figure.",
    fil: "May halaga o petsa sa sagot na wala sa records mo, kaya hindi ko ito ipinakita. Pumili ng tanong sa ibaba para sa eksaktong halaga.",
  },
  advice: {
    en: "I can't tell you what to do with your money. Tap a question below to see what your records say.",
    fil: "Hindi ako makakapagpayo kung ano ang gagawin mo sa pera mo. Pumili ng tanong sa ibaba para makita ang records mo.",
  },
  contact: {
    en: "That answer included a link or a phone number, so I didn't show it.",
    fil: "May link o numero ng telepono sa sagot, kaya hindi ko ito ipinakita.",
  },
  unreadable: {
    en: "I couldn't put that into words. Try asking another way.",
    fil: "Hindi ko iyon masagot nang maayos. Subukang itanong sa ibang paraan.",
  },
};

export const TOO_LONG_REPLY: Record<ReplyLanguage, string> = {
  en: "That message is too long for me. Try a shorter question.",
  fil: "Masyadong mahaba ang mensahe para sa akin. Subukan ang mas maikling tanong.",
};

/** Fills the wait before free chat's first word, like the tool lines do for chips. */
export const FREE_CHAT_ACTIVITY = "Reading your records…";
