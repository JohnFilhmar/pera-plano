// contexts/lock_context.tsx — the app lock (docs/12-encryption-and-app-lock.md
// §7, §11a; interface contract §10; task-9-brief.md). This is the thing that
// makes seven tasks of key plumbing into an app a person can actually open:
// nothing before this task ever called unlockDatabase() or
// setCacheEncryptionKey(), so every cold start on a real device hit the
// bootstrap-error screen (Task 7's carried-forward note).
//
// THE THREE-STEP UNLOCK SEQUENCE (task-9-brief rule 1) is the single most
// load-bearing thing in this file: get the DEK, THEN unlockDatabase(dek),
// THEN setCacheEncryptionKey(dek), always in that order, on every path that
// produces a DEK (the device-key path in unlock() and the recovery path in
// submitRecoveryPhrase()). Missing the third step means the persisted React
// Query cache silently fails to decrypt on every launch (lib/query_client.ts's
// header comment); missing the second means every repository call throws
// DatabaseLockedError. Both unlock() and submitRecoveryPhrase() below run all
// three, in order, before ever reporting "unlocked".
//
// WHY COLD START NEVER TRUSTS AN IN-MEMORY DEK: key_manager.getKeyState() can
// report "unlocked" if something already populated its module-level `dek`
// this same process (there is no such caller yet, but nothing prevents one
// existing later). The rule is "locked on cold start" (docs §7), not "locked
// unless key_manager happens to already hold a key" — so the mount effect
// below maps BOTH "locked" and "unlocked" to this context's own "locked"
// status, and only a real, fresh unlock() call (through THIS context) is
// ever allowed to report "unlocked" here.
//
// WHY unlock() calls expo-local-authentication BEFORE the native unwrap:
// the device KEK's Keystore key only becomes usable for a short validity
// window (10s, docs §7) after the user passes a system authentication
// challenge — nothing invokes that challenge automatically just because
// Kotlin code attempts to use the key. authenticateAsync() is the JS-level
// trigger for that system prompt. `disableDeviceFallback: false` is pinned
// explicitly (task-9-brief rule 2 / contract §10): biometric-or-device-
// credential, NEVER biometric-only, so a user with no enrolled fingerprint
// can still open their own app with just their PIN/pattern/password.
//
// ...AND WHY submitRecoveryPhrase() NOW DOES THE SAME. rewrapAfterInvalidation()
// runs recreateDeviceKek() and then wrapWithDeviceKek() — the same auth-gated
// Keystore key, the same ~10s window, the same requirement that something
// raise the system challenge first. Nothing here ever did: unlike unlock(),
// which is reached BY authenticating, this path is reached by TYPING TWELVE
// WORDS, so no challenge has been passed and the window has never been open.
// On a physical Samsung A54 the identical omission in onboarding
// (app/(onboarding)/recovery_phrase.tsx, commit e3ec7cb) failed every single
// time with NotAuthenticatedError; only the fact that this path is reached
// from "needs_recovery" — a removed screen lock, not a first run — kept that
// device session from exercising it too. It is the same defect on the one
// flow whose entire purpose is preventing data loss, so it gets the same
// resolved shape as that screen: authenticate immediately before the call,
// treat a cancelled prompt as a step to take again rather than an error, and
// re-prompt exactly ONCE on a NotAuthenticatedError from the call itself.
// `disableDeviceFallback: false` for the same reason as everywhere else.
//
// WHY NO AUTO-RETRY LOOP ANYWHERE HERE: the plan's own retrospective names
// "a forever-looping recovery" as one of the bug shapes that has shipped
// green suites before. Every failure path below (a cancelled prompt,
// NotAuthenticatedError, a wrong recovery phrase) returns to an IDLE status
// and requires a NEW, explicit call (a fresh button tap) to retry — nothing
// here re-invokes itself. unlockInFlightRef/recoveryInFlightRef additionally
// guard against a double-tap starting a SECOND concurrent attempt while one
// is already running (the DEK-split bug class Task 6 found and fixed for
// initializeKeys — this file's own version of the same discipline).
//
// "needs_device_lock" (task-9a-brief; docs §5a) is the resolution of the
// TODO this file used to carry: submitRecoveryPhrase() checks isDeviceSecure()
// BEFORE ever calling KeyManager.rewrapAfterInvalidation(phrase), because
// that call ends in recreateDeviceKek() — which cannot create a new
// auth-gated Keystore key on a device with no screen lock present, no
// differently from initializeKeys() at onboarding. An insecure device is
// routed to "needs_device_lock" (rendered by app/lock.tsx via
// DeviceLockExplainer) with the phrase deliberately NOT retained anywhere —
// same "no auto-retry, requires a fresh explicit action" discipline as
// above, just extended to a case that would otherwise mean quietly holding
// a decrypted recovery phrase in memory across an indefinite trip to
// Settings. The AppState effect below re-checks isDeviceSecure() on return
// and, once satisfied, moves back to "needs_recovery" — never straight to
// re-attempting the rewrap — so the user submits their phrase again, this
// time with recreateDeviceKek() actually able to succeed.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as KeyManager from "@/lib/crypto/key_manager";
import * as Database from "@/lib/db/database";
import * as QueryCache from "@/lib/query_client";
import { wipeAndStartOver as performWipeAndStartOver } from "@/lib/security/wipe";
import {
  DeviceKeyInvalidatedError,
  DeviceKeyMissingError,
  NotAuthenticatedError,
  isDeviceSecure,
} from "@/modules/notification_listener";

export type LockStatus =
  | "checking" // getKeyState() has not resolved yet -- render nothing, same bucket as fonts/theme
  | "needs_onboarding" // no first-run state exists at all, or the bridge reports DeviceKeyMissing
  | "locked" // idle, waiting for the user to tap Unlock (first attempt or a retry)
  | "authenticating" // a device-key unlock attempt is in flight
  | "needs_recovery" // the device Keystore key was permanently invalidated
  | "needs_device_lock" // needs_recovery, but the device ALSO has no screen lock right now (docs §5a) -- recreateDeviceKek() cannot make a new auth-gated key without one, so this runs before rewrapAfterInvalidation is ever attempted
  | "unlocked"; // the DEK is in memory, the database is open, the cache key is set

type LockContextValue = {
  status: LockStatus;
  /** A fixed, non-sensitive message for the current failure, if any. Never the raw error text — see unlock()'s catch-all. */
  errorMessage: string | null;
  /** Triggers the device-key unlock path: authenticate, then the three-step sequence above. */
  unlock: () => Promise<void>;
  /** The recovery-phrase path for needs_recovery: rewrapAfterInvalidation, then the same three-step sequence. */
  submitRecoveryPhrase: (phrase: string[]) => Promise<void>;
  /** Onboarding's first-run handoff: "keys now exist on this device" — moves "needs_onboarding" to "locked", and nothing else. See its implementation for why this is the only correct destination. */
  keysProvisioned: () => void;
  /** The §11a escape hatch. Callers (RecoveryUnlockForm) own the double-confirmation UI; this only runs the actual destruction once invoked. */
  wipeAndStartOver: () => Promise<void>;
};

const LockContext = createContext<LockContextValue | null>(null);

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Says what did not happen and what to do next, and never implies the words
 * are the problem — the user is looking at the phrase they just typed while
 * reading this, and "that recovery phrase doesn't match" would send them
 * hunting for a typo that does not exist.
 */
const RECOVERY_AUTH_NOT_COMPLETED_MESSAGE =
  "We couldn't confirm it's you, so nothing was unlocked. Your words are still here — tap Unlock to try again.";

/**
 * The system authentication challenge that opens the Keystore's ~10s window
 * for rewrapAfterInvalidation(). Same options as unlock(), including the one
 * that matters most:
 *
 * `disableDeviceFallback: false` — NEVER biometric-only (task-9-brief rule 2 /
 * contract §10). This user's screen lock was just removed and re-created;
 * their fingerprint enrollment went with the old one, so device
 * PIN/pattern/password is frequently the ONLY credential they still have.
 *
 * The prompt message is recovery's, not unlock()'s: "Unlock PeraPlano" is the
 * copy on a door whose key still works, and this user is here precisely
 * because theirs stopped working.
 */
async function authenticateForRecovery(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm it's you to restore access to PeraPlano",
    disableDeviceFallback: false,
  });
  return result.success;
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mirrors `status` for the AppState handler below, which subscribes once
  // and must always see the CURRENT status, not the one captured at
  // subscribe-time.
  const statusRef = useRef<LockStatus>(status);
  statusRef.current = status;

  const unlockInFlightRef = useRef(false);
  const recoveryInFlightRef = useRef(false);
  const wipeInFlightRef = useRef(false);
  // Timestamp of the most recent transition TO the background, or null when
  // currently foregrounded / never backgrounded. Set ONLY on the
  // "background" transition and read ONLY on the next "active" transition —
  // never touched by any interaction event, which is what makes the 5-minute
  // window measured "from when the app backgrounded, not from last
  // interaction" (docs §7) true by construction rather than by care.
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    KeyManager.getKeyState()
      .then((state) => {
        if (cancelled) return;
        setStatus(state === "uninitialized" ? "needs_onboarding" : "locked");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("locked");
        setErrorMessage("Couldn't check your device. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The composite teardown (task-9-brief rule 4 / contract §10): clears the
   * cache key, closes the database handle, and zeroes the in-memory DEK.
   * Order: cache key first (cheap, synchronous), then await the database
   * close (SQLCipher's page cache must not survive), and the DEK last —
   * never scrub key material before everything that might still need it
   * has finished. Nothing here depends on the DEK still being valid, so this
   * ordering is a safety margin, not a strict requirement.
   */
  const lockNow = useCallback(async () => {
    QueryCache.clearCacheEncryptionKey();
    await Database.closeDatabase();
    KeyManager.lock();
    setStatus("locked");
    setErrorMessage(null);
  }, []);

  /**
   * task-9a-brief rule 5 / docs §5a's "mid-life removal" paragraph: while
   * status is "needs_device_lock", a return to the foreground re-checks
   * isDeviceSecure() and, once satisfied, moves back to "needs_recovery" --
   * NEVER straight to re-attempting rewrapAfterInvalidation, since the
   * phrase that got the user here was deliberately never retained (see this
   * file's header comment). Still insecure: no-op, same "loop until secure"
   * shape as app/(onboarding)/device_lock.tsx, bounded by a real user action
   * (leaving for Settings and coming back) every time, never a timer.
   */
  const recheckDeviceLockRef = useRef(false);
  const recheckDeviceLock = useCallback(async () => {
    if (recheckDeviceLockRef.current) return;
    recheckDeviceLockRef.current = true;
    try {
      const secure = await isDeviceSecure();
      if (secure) {
        setStatus("needs_recovery");
      }
    } finally {
      recheckDeviceLockRef.current = false;
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background") {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (next !== "active") return;

      if (statusRef.current === "needs_device_lock") {
        void recheckDeviceLock();
        return;
      }

      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (backgroundedAt === null) return;
      if (statusRef.current !== "unlocked") return; // nothing to tear down
      if (Date.now() - backgroundedAt >= FIVE_MINUTES_MS) {
        void lockNow();
      }
    });
    return () => subscription.remove();
  }, [lockNow, recheckDeviceLock]);

  /**
   * THE FIRST-RUN HANDOFF. app/(onboarding)/index.tsx's pre-flow sequencer
   * (device lock -> recovery phrase -> provider picker) is rendered DIRECTLY
   * by app/lock.tsx while this context reports "needs_onboarding", which is
   * to say: above the render gate, with no Stack mounted. That is correct
   * for those three screens -- none of them touches the database. It is a
   * dead end for everything after them. The nine numbered steps that follow
   * (app/(onboarding)/welcome.tsx onward) navigate with `router.push`, and
   * the last four of them read and write the ledger; without a mounted
   * navigator every push goes nowhere, and without an unlocked database
   * every write throws DatabaseLockedError. Before this handoff existed, a
   * first-session user reached the end of the provider step and simply
   * stopped: `<Redirect href="/(onboarding)/welcome">` updated router state
   * that nothing was rendering, and only force-quitting the app (which
   * restarts at getKeyState() === "locked") ever got them any further.
   *
   * MOVES TO "locked", NEVER TO "unlocked" -- this function cannot open
   * anything. initializeKeys() has by then minted a DEK and left it in
   * key_manager's module-level `dek` (see performInitializeKeys's own
   * comment), so getKeyState() would already answer "unlocked"; this file's
   * header explains at length why that is exactly the answer this context
   * refuses to trust. "locked" sends the user through the ordinary
   * UnlockPrompt and the ordinary three-step unlock() sequence -- one
   * authentication, immediately after they set up the screen lock the device
   * key depends on -- which is the only thing that both proves the freshly
   * created Keystore key actually works and leaves the database genuinely
   * open for the wallet/income/limit steps ahead. The transition can only
   * ADD an authentication requirement, never remove one.
   *
   * GUARDED TO ONE SOURCE STATUS so it can never be a back door. Called from
   * any other status it is a no-op: it cannot pull a user out of
   * "needs_recovery" or "needs_device_lock" (both of which mean the device
   * key is dead and only the recovery phrase can help), and it cannot
   * short-circuit "authenticating".
   */
  const keysProvisioned = useCallback(() => {
    setStatus((current) => (current === "needs_onboarding" ? "locked" : current));
  }, []);

  const unlock = useCallback(async () => {
    if (unlockInFlightRef.current) return;
    unlockInFlightRef.current = true;
    setStatus("authenticating");
    setErrorMessage(null);
    try {
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock PeraPlano",
        // Never biometric-only (task-9-brief rule 2 / contract §10): a user
        // with no enrolled biometric must still be able to open their own
        // app with their device PIN/pattern/password.
        disableDeviceFallback: false,
      });
      if (!authResult.success) {
        setStatus("locked");
        setErrorMessage("Authentication wasn't completed. Try again.");
        return;
      }

      const dek = await KeyManager.unlockWithDeviceKey();
      await Database.unlockDatabase(dek);
      QueryCache.setCacheEncryptionKey(dek);
      setStatus("unlocked");
    } catch (error) {
      if (error instanceof DeviceKeyMissingError) {
        // First run on this device (contract §9 rule 3) — never ask for
        // recovery words the user has never seen.
        setStatus("needs_onboarding");
      } else if (error instanceof DeviceKeyInvalidatedError) {
        setStatus("needs_recovery");
      } else if (error instanceof NotAuthenticatedError) {
        // Re-promptable, not a failure (task-9-brief rule 3): stays locked
        // with a benign message; a fresh unlock() tap retries.
        setStatus("locked");
        setErrorMessage("Please authenticate again to continue.");
      } else {
        setStatus("locked");
        setErrorMessage("Something went wrong. Try again.");
      }
    } finally {
      unlockInFlightRef.current = false;
    }
  }, []);

  const submitRecoveryPhrase = useCallback(async (phrase: string[]) => {
    if (recoveryInFlightRef.current) return;
    recoveryInFlightRef.current = true;
    setErrorMessage(null);
    try {
      // task-9a-brief rule 5 / docs §5a: recreateDeviceKek() (inside
      // rewrapAfterInvalidation below) cannot create a new auth-gated
      // Keystore key on a device with no screen lock present -- checked
      // HERE, before that call ever runs, so an insecure device is routed
      // to set one first rather than spending the phrase on an attempt that
      // could only fail. See this file's header comment for why the phrase
      // is deliberately NOT retained across that trip.
      const secure = await isDeviceSecure();
      if (!secure) {
        setStatus("needs_device_lock");
        return;
      }

      // AFTER the screen-lock gate, never before it: a device with no screen
      // lock has no credential to authenticate against, so a prompt raised
      // there could only be a dead end in front of the explainer that
      // actually tells the user what to do.
      if (!(await authenticateForRecovery())) {
        // NOT an error, and deliberately NOT a status change. The status
        // staying "needs_recovery" is what keeps RecoveryUnlockForm mounted
        // with the words the user typed still in its box — anything else
        // unmounts it and silently discards them, on the screen where
        // retyping twelve words from paper is the whole cost of the mistake.
        setErrorMessage(RECOVERY_AUTH_NOT_COMPLETED_MESSAGE);
        return;
      }

      let dek: Uint8Array;
      try {
        dek = await KeyManager.rewrapAfterInvalidation(phrase);
      } catch (error) {
        if (!(error instanceof NotAuthenticatedError)) throw error;
        // The window expired between the prompt and the call. One re-prompt,
        // one retry of the identical call with the identical phrase — the
        // response this rejection's contract requires
        // (modules/notification_listener/index.ts).
        if (!(await authenticateForRecovery())) {
          setErrorMessage(RECOVERY_AUTH_NOT_COMPLETED_MESSAGE);
          return;
        }
        // A second NotAuthenticatedError falls through to the catch below and
        // STOPS there. There is no third attempt — see this file's "WHY NO
        // AUTO-RETRY LOOP ANYWHERE HERE".
        dek = await KeyManager.rewrapAfterInvalidation(phrase);
      }

      await Database.unlockDatabase(dek);
      QueryCache.setCacheEncryptionKey(dek);
      setStatus("unlocked");
    } catch (error) {
      if (error instanceof KeyManager.RecoveryUnlockFailedError) {
        setErrorMessage("That recovery phrase doesn't match. Check the words and try again.");
      } else if (error instanceof NotAuthenticatedError) {
        // Re-promptable, not a failure — the same taxonomy unlock() already
        // applies. Until this branch existed, a NotAuthenticatedError that
        // survived the one retry above landed in the generic bucket below
        // and told the user "something went wrong" about the one failure
        // whose cause and remedy are both perfectly well known.
        setErrorMessage("Please authenticate again to continue.");
      } else {
        setErrorMessage("Something went wrong. Try again.");
      }
      // Status deliberately stays "needs_recovery" on every failure path —
      // nothing here schedules a retry. The next attempt only happens if the
      // user submits again.
    } finally {
      recoveryInFlightRef.current = false;
    }
  }, []);

  const wipeAndStartOver = useCallback(async () => {
    // Same double-tap guard as unlock()/submitRecoveryPhrase() — a rapid
    // second press of the final confirmation button (recovery_unlock_form.tsx
    // does not disable it while the first call is in flight) must not start
    // a SECOND concurrent wipeDatabase()/wipeKeys() cycle racing the first.
    if (wipeInFlightRef.current) return;
    wipeInFlightRef.current = true;
    try {
      await performWipeAndStartOver();
      setErrorMessage(null);
      setStatus("needs_onboarding");
    } finally {
      wipeInFlightRef.current = false;
    }
  }, []);

  const value = useMemo<LockContextValue>(
    () => ({
      status,
      errorMessage,
      unlock,
      submitRecoveryPhrase,
      keysProvisioned,
      wipeAndStartOver,
    }),
    [status, errorMessage, unlock, submitRecoveryPhrase, keysProvisioned, wipeAndStartOver],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextValue {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error("useLock must be used within LockProvider");
  return ctx;
}
