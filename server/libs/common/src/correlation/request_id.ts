// apps/web/middleware.ts (a later task) imports this module and runs on Next's Edge
// runtime, where `import { randomUUID } from "node:crypto"` fails to build. Use the
// Web Crypto global instead — it exists in both Node 22 and Edge.

export const REQUEST_ID_HEADER = "x-request-id";

/** Anything longer or stranger than this is not an id someone upstream meant to send. */
const MAX_LENGTH = 200;
const SAFE = /^[\w.:-]+$/;

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * An inbound id is attacker-controllable and ends up in every log line for the request.
 * A newline in it forges a log record; an unbounded one bloats every line. Reject rather
 * than sanitise, so a rejected id is visibly a fresh one instead of a mangled original.
 */
export function readOrCreateRequestId(headers: { get(name: string): string | null }): string {
  const inbound = headers.get(REQUEST_ID_HEADER);
  if (inbound !== null && inbound.length > 0 && inbound.length <= MAX_LENGTH && SAFE.test(inbound)) {
    return inbound;
  }
  return newRequestId();
}
