// components/ai/chat_copy.ts
//
// EVERY REPLY THE APP WRITES ITSELF, as opposed to one the model narrates. Under
// spec §7.4 typed text never reaches the model, so these lines are the whole
// voice of the chat for anything that is not a tapped question. Each one points
// back at the question chips, because they are the way in.
//
// FILIPINO COPY IS A FIRST DRAFT for the owner to read, not a translation anyone
// has checked yet.
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
