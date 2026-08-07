import * as Crypto from "expo-crypto";

/** UUIDv4, generated client-side (interface contract §1). */
export function newId(): string {
  return Crypto.randomUUID();
}
