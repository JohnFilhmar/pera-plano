// mobile/lib/ai/disclaimer.ts
//
// WHERE THE "SEEN IT" FLAG LIVES, and it is here rather than in the assistant
// screen for one reason: `lib/privacy/data_wipe.ts` has to clear it, and a
// `lib/` module importing a route file would drag expo-router and the whole
// chat surface into the wipe path.
//
// ASYNCSTORAGE, NOT `app_settings`. Same call `contexts/theme_context.tsx`
// makes for the theme preference: this is a UI acknowledgement, not a ledger
// setting, and `app_settings` deliberately has no key for it. The consequence
// is that `resetSettings()` cannot see it, which is exactly why the wipe has
// to name it explicitly.

/**
 * Spec §4.7: the disclaimer appears ONCE at first use, then persists as a
 * quiet marker. "Not a modal every session: nagging trains people to dismiss
 * without reading, which destroys the one disclosure that mattered."
 *
 * A start-over must clear this. A user who has erased everything and is being
 * handed a fresh recovery phrase has not been told what the assistant is, and
 * the design says they are told once.
 */
export const AI_DISCLAIMER_STORAGE_KEY = "peraplano.ai_disclaimer_seen";
