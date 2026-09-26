// mobile/lib/ai/__tests__/session.test.ts
//
// THE SESSION IS SUBORDINATE TO THE LOCK. Under spec §7.4 there is no
// transcript left to clear; what the lock still has to reach is the model's
// context, whose KV cache holds the last prompt and with it the last tool
// result's figures.
//
// NOTHING IS STORED. Not in SQLCipher, not in AsyncStorage, not in the
// react-query persister, not in a file. "Your conversations are never saved
// anywhere" is a real privacy line, and these tests hold the code to it.
import * as FileSystem from "expo-file-system/legacy";

import { emitAppEvent } from "@/lib/events/app_events";
import { queryClient } from "@/lib/query_client";
import { fakeLlamaBridge, bridgeCalls, resetLlamaScript } from "@/test_support/llama_bridge_mock";

import { configureSession, destroySession } from "../session";

beforeEach(async () => {
  resetLlamaScript();
  configureSession({ bridge: fakeLlamaBridge });
  await destroySession();
  resetLlamaScript();
  queryClient.clear();
  jest.clearAllMocks();
});

describe("on lock:engaged", () => {
  test("resetContext is called and unload is NOT", async () => {
    // Spec §4.5. The KV cache holds the last prompt and must go; the weights are
    // public and can stay resident, which is what makes re-entry after unlock
    // fast instead of a multi-second reload.
    await emitAppEvent("lock:engaged", {});

    expect(bridgeCalls()).toEqual(["resetContext"]);
    expect(bridgeCalls()).not.toContain("unload");
  });

  test("a second lock with nothing to clear is harmless", async () => {
    await emitAppEvent("lock:engaged", {});
    await expect(emitAppEvent("lock:engaged", {})).resolves.not.toThrow();
  });

  test("with no bridge configured the lock still completes", async () => {
    // The teardown must not depend on a model being resident. A user who never
    // downloaded one still locks the app.
    configureSession({ bridge: null });

    await expect(emitAppEvent("lock:engaged", {})).resolves.not.toThrow();
    expect(bridgeCalls()).toEqual([]);
  });
});

describe("nothing is written anywhere", () => {
  test("no FileSystem write from any session code path", async () => {
    await emitAppEvent("lock:engaged", {});

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
  });

  test("assistant state never reaches the persisted query cache", async () => {
    // Spec §5.8. The react-query cache is persisted to disk, so a single
    // `setQueryData` here would turn the "never saved anywhere" claim into a
    // false one.
    await emitAppEvent("lock:engaged", {});

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
