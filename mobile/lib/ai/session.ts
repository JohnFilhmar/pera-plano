// mobile/lib/ai/session.ts
//
// THE SESSION IS SUBORDINATE TO THE LOCK. The lock owns the DEK; the session
// owns nothing that can outlive it. Spec §4.5/4.6.
//
// THE RECENT TURNS LIVE IN THE CHAT SURFACE, AND NOTHING IS STORED. A tapped
// question is answered on its own (spec §7.4). From answer level 3 the surface
// sends back the model exchanges still on screen (assistant levels spec §4.4),
// held in its own memory and cleared on the same lock event. Not in SQLCipher,
// not in AsyncStorage, not in the react-query persister, not in a file.
//
// WHAT THE LOCK STILL HAS TO CLEAR is the model's context. Its KV cache holds the
// last prompt, and that prompt carried the tool result's figures inside the
// delimited channel. `resetContext()`, NOT `unload()`: the weights are public
// and can stay resident, which is what makes re-entry after unlock fast instead
// of a multi-second reload.
//
// A MODULE-SCOPED STORE, NOT A REACT CONTEXT, which is why `lock:engaged` exists:
// assistant state must never reach react-query, which is persisted to disk, so
// this cannot live in a provider whose unmount would clean it up.
import { onAppEvent } from "@/lib/events/app_events";
import type { LlamaBridge } from "@/modules/llama_bridge/types";

let bridge: LlamaBridge | null = null;

/**
 * Injects the bridge whose context must be reset on lock.
 *
 * Injected rather than imported so this module stays testable without native
 * inference, and so a user who has never downloaded a model, where there is no
 * bridge at all, still locks cleanly.
 *
 * @param next - The loaded bridge, or `null` when no model is resident.
 */
export function configureSession(next: { bridge: LlamaBridge | null }): void {
  bridge = next.bridge;
}

/**
 * Clears what the model still holds of the last answer.
 *
 * @returns Once the bridge's context is reset, or at once when there is no bridge.
 */
export async function destroySession(): Promise<void> {
  // The teardown must not depend on a model being resident.
  await bridge?.resetContext();
}

// Subscribed at module load, and never unsubscribed: this store lives as long
// as the process does, and a lock that arrived while nothing happened to be
// listening would leave the last prompt in the model's context.
onAppEvent("lock:engaged", () => destroySession());
