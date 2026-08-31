// mobile/lib/ai/__tests__/session.test.ts
//
// THE SESSION IS SUBORDINATE TO THE LOCK. The lock owns the DEK; the session
// owns nothing that can outlive it.
//
// CONVERSATIONS ARE NEVER STORED. Not in SQLCipher, not in AsyncStorage, not in
// the react-query persister, not in a file. Spec §4.6 gives three compounding
// reasons: it removes an encrypted-chat-log problem entirely; it stops the
// assistant becoming a plaintext cache of a locked ledger; and "your
// conversations are never saved anywhere" is a real privacy line that matches
// what the rest of the product already does.
import * as FileSystem from "expo-file-system/legacy";

import { emitAppEvent } from "@/lib/events/app_events";
import { queryClient } from "@/lib/query_client";
import { fakeLlamaBridge, bridgeCalls, resetLlamaScript } from "@/test_support/llama_bridge_mock";

import { configureSession, destroySession, getSession } from "../session";
import { ok } from "../tools/types";

const RESULT = ok("get_balance_total", { total: 1 }, [
  { key: "total", value: "₱18,320.00", kind: "amount" },
]);

function seedSession() {
  const session = getSession();
  session.transcript.push({ role: "user", text: "How much do I have?" });
  session.transcript.push({ role: "assistant", text: "You have ₱18,320.00." });
  session.toolResults.set("get_balance_total()", RESULT);
  return session;
}

beforeEach(async () => {
  resetLlamaScript();
  configureSession({ bridge: fakeLlamaBridge });
  await destroySession();
  resetLlamaScript();
  queryClient.clear();
  jest.clearAllMocks();
});

describe("on lock:engaged", () => {
  test("the transcript is emptied and tool results are dropped", async () => {
    seedSession();
    expect(getSession().transcript).toHaveLength(2);

    await emitAppEvent("lock:engaged", {});

    expect(getSession().transcript).toEqual([]);
    expect(getSession().toolResults.size).toBe(0);
  });

  test("resetContext is called and unload is NOT", async () => {
    // Spec §4.5. The KV cache holds the conversation and must go; the weights
    // are public and can stay resident, which is what makes re-entry after
    // unlock fast instead of a multi-second reload. "Clean it all up" is the
    // natural instinct and it is wrong.
    seedSession();

    await emitAppEvent("lock:engaged", {});

    expect(bridgeCalls()).toEqual(["resetContext"]);
    expect(bridgeCalls()).not.toContain("unload");
  });

  test("a reference taken BEFORE the lock is cleared too", async () => {
    // The object is emptied IN PLACE rather than replaced. Swapping in a fresh
    // object would leave whoever already held the old one — a mounted screen,
    // a closure mid-render — holding a complete plaintext transcript of a now
    // locked ledger, which is the exact thing this is for.
    const held = seedSession();

    await emitAppEvent("lock:engaged", {});

    expect(held.transcript).toEqual([]);
    expect(held.toolResults.size).toBe(0);
  });

  test("a fresh getSession after re-lock returns an empty transcript", async () => {
    seedSession();
    await emitAppEvent("lock:engaged", {});
    expect(getSession().transcript).toEqual([]);
  });

  test("a second lock with nothing to clear is harmless", async () => {
    await emitAppEvent("lock:engaged", {});
    await emitAppEvent("lock:engaged", {});
    expect(getSession().transcript).toEqual([]);
  });

  test("with no bridge configured the lock still clears the transcript", async () => {
    // The teardown must not depend on a model being resident. A user who never
    // downloaded one still locks the app.
    configureSession({ bridge: null });
    seedSession();

    await emitAppEvent("lock:engaged", {});

    expect(getSession().transcript).toEqual([]);
  });
});

describe("nothing is written anywhere", () => {
  test("no FileSystem write from any session code path", async () => {
    seedSession();
    await emitAppEvent("lock:engaged", {});

    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
  });

  test("assistant state never reaches the persisted query cache", async () => {
    // Spec §5.8. The react-query cache is persisted to disk, so a single
    // `setQueryData` here would turn the "never saved anywhere" claim into a
    // false one.
    seedSession();
    await emitAppEvent("lock:engaged", {});

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
