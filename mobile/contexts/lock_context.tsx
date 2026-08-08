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
  /** The §11a escape hatch. Callers (RecoveryUnlockForm) own the double-confirmation UI; this only runs the actual destruction once invoked. */
  wipeAndStartOver: () => Promise<void>;
};

const LockContext = createContext<LockContextValue | null>(null);

const FIVE_MINUTES_MS = 5 * 60 * 1000;

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

      const dek = await KeyManager.rewrapAfterInvalidation(phrase);
      await Database.unlockDatabase(dek);
      QueryCache.setCacheEncryptionKey(dek);
      setStatus("unlocked");
    } catch (error) {
      if (error instanceof KeyManager.RecoveryUnlockFailedError) {
        setErrorMessage("That recovery phrase doesn't match. Check the words and try again.");
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
    () => ({ status, errorMessage, unlock, submitRecoveryPhrase, wipeAndStartOver }),
    [status, errorMessage, unlock, submitRecoveryPhrase, wipeAndStartOver],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextValue {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error("useLock must be used within LockProvider");
  return ctx;
}
