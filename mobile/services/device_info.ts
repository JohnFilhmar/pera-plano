// services/device_info.ts — version-context headers for the MVP's two public
// server calls (M3c Task 4).
//
// WHAT THIS FILE MUST NEVER DO. These headers exist so the server can reason
// about client compatibility (a very old app talking to a new parser-rules
// schema, for instance) — nothing more. No device token, no install id, no
// advertising id, no anything that could correlate two requests to one
// handset. The Privacy Centre tells the user in writing that only aggregate,
// content-free counters are ever sent (docs/07-privacy-and-compliance.md §5,
// §2.3's telemetry row); a stray identifier here would make that a lie.
// Guarded by services/__tests__/api.test.ts's "carries no identifier field"
// regression test — that test enumerates every key below by name, so adding
// a fifth header of any name breaks it on purpose.
//
// Every value below is read from Expo's/React Native's own runtime constants
// (never a hardcoded string), so it can't drift from what actually shipped.
import { Platform } from "react-native";

import Constants from "expo-constants";

/** Assembled fresh per request; nothing here is cached or persisted. */
export async function getDeviceHeaders(): Promise<Record<string, string>> {
  return {
    "X-App-Version": Constants.expoConfig?.version ?? "unknown",
    "X-Device-OS": Platform.OS,
    "X-Device-OS-Version": String(Platform.Version),
    "X-Client-Type": "mobile",
  };
}
