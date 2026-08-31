// mobile/lib/ai/session.ts
//
// THE SESSION IS SUBORDINATE TO THE LOCK. The lock owns the DEK; the session
// owns nothing that can outlive it. Spec §4.5/4.6.
//
// CONVERSATIONS ARE NEVER STORED. Not in SQLCipher, not in AsyncStorage, not in
// the react-query persister, not in a file. Three compounding reasons, and all
// three matter:
//
//   1. It removes an encrypted-chat-log problem entirely. There is no log, so
//      there is no key management, no retention policy and no export request
//      for it.
//   2. It stops the assistant becoming a plaintext cache of a LOCKED ledger.
//      A stored transcript would say "you have ₱18,320.00" on a phone whose
//      database is sealed, which is the one thing the lock exists to prevent.
//   3. "Your conversations are never saved anywhere" is a real privacy line,
//      and it matches what the rest of the product already does.
//
// THIS IS A MODULE-SCOPED STORE, NOT A REACT CONTEXT, and that is why
// `lock:engaged` had to exist. Assistant state must never reach react-query,
// which is persisted to disk, so this cannot live in a provider whose unmount
// would clean it up. It learns about a lock from the event bus instead — which
// is also the only thing a test can fire at a chosen point in a token stream,
// where spec §4.5's race actually lives: tokens arrive from a native thread and
// the lock arrives from the UI.
//
// `resetContext()`, NOT `unload()`. The KV cache holds the conversation and
// must go; the weights are public and can stay resident, which is what makes
// re-entry after unlock fast instead of a multi-second reload. "Clean it all
// up" is the natural instinct and it is wrong.
import { onAppEvent } from "@/lib/events/app_events";
import type { LlamaBridge } from "@/modules/llama_bridge/types";

import type { Turn } from "./prompt";
import type { ToolResult } from "./tools/types";

export type Session = {
  transcript: Turn[];
  /** Keyed by tool name and arguments, for the turn cache. */
  toolResults: Map<string, ToolResult<unknown>>;
};

/**
 * ONE OBJECT FOR THE PROCESS LIFETIME, emptied in place rather than replaced.
 *
 * Swapping in a fresh object on lock would leave whoever already held the old
 * one — a mounted screen, a closure mid-render — holding a complete plaintext
 * transcript of a ledger that is now sealed. Clearing in place reaches every
 * holder at once.
 */
const session: Session = { transcript: [], toolResults: new Map() };

let bridge: LlamaBridge | null = null;

/**
 * Injects the bridge whose context must be reset on lock.
 *
 * Injected rather than imported so this module stays testable without native
 * inference, and so a user who has never downloaded a model — where there is no
 * bridge at all — still locks cleanly.
 */
export function configureSession(next: { bridge: LlamaBridge | null }): void {
  bridge = next.bridge;
}

export function getSession(): Session {
  return session;
}

export async function destroySession(): Promise<void> {
  session.transcript.length = 0;
  session.toolResults.clear();
  // The teardown must not depend on a model being resident.
  await bridge?.resetContext();
}

// Subscribed at module load, and never unsubscribed: this store lives as long
// as the process does, and a lock that arrived while nothing happened to be
// listening would leave the transcript behind.
onAppEvent("lock:engaged", () => destroySession());
