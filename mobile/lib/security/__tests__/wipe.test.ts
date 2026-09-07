// lib/security/__tests__/wipe.test.ts — the §11a "wipe and start over"
// orchestration (docs/12-encryption-and-app-lock.md §11a; contract §9 rule
// 4). Both real dependencies are plain, compiled ES modules (no native
// bridge involved), so a straightforward jest.mock + named-import spy is
// safe here — this is NOT one of the modules bitten by the Jest/Babel
// namespace-import trap key_manager.test.ts documents (that trap only hits
// modules that lack `__esModule`, i.e. native modules or bare mock-factory
// objects; @/lib/db/database and @/lib/crypto/key_manager are neither).
jest.mock("@/lib/db/database", () => ({
  wipeDatabase: jest.fn(),
}));
jest.mock("@/lib/crypto/key_manager", () => ({
  wipeKeys: jest.fn(),
}));
jest.mock("@/modules/notification_listener", () => ({
  clearCaptureBuffer: jest.fn(),
}));
jest.mock("@/lib/support/attachments", () => ({
  deleteAllSupportAttachmentFiles: jest.fn(),
}));

import { wipeDatabase } from "@/lib/db/database";
import { wipeKeys } from "@/lib/crypto/key_manager";
import { clearCaptureBuffer } from "@/modules/notification_listener";
import { deleteAllSupportAttachmentFiles } from "@/lib/support/attachments";
import { wipeAndStartOver, WipeIncompleteError } from "../wipe";

const mockWipeDatabase = wipeDatabase as jest.Mock;
const mockWipeKeys = wipeKeys as jest.Mock;
const mockClearCaptureBuffer = clearCaptureBuffer as jest.Mock;
const mockDeleteAttachments = deleteAllSupportAttachmentFiles as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockWipeDatabase.mockResolvedValue(undefined);
  mockWipeKeys.mockResolvedValue(undefined);
  mockClearCaptureBuffer.mockResolvedValue(undefined);
  mockDeleteAttachments.mockResolvedValue(undefined);
});

test("wipes the database, the key material, AND the capture buffer", async () => {
  await wipeAndStartOver();

  expect(mockWipeDatabase).toHaveBeenCalledTimes(1);
  expect(mockWipeKeys).toHaveBeenCalledTimes(1);
  // The discriminating assertion: a wipe that clears the database and keys
  // but forgets the capture buffer (task-9-report.md's documented gap) would
  // pass every other test in this file -- only this one catches it.
  expect(mockClearCaptureBuffer).toHaveBeenCalledTimes(1);
  // The second thing on this device that lives outside the database file:
  // deleting the SQLite file deletes the rows that POINT at a problem report's
  // screenshots, never the screenshots. Same class of gap as the capture
  // buffer above, caught by the same kind of assertion.
  expect(mockDeleteAttachments).toHaveBeenCalledTimes(1);
});

test("wipes the database BEFORE the keys -- a database wipe failure must leave the wraps intact, not orphan an unwipeable file with no key left to ever prove it happened", async () => {
  const order: string[] = [];
  mockWipeDatabase.mockImplementation(async () => {
    order.push("database");
  });
  mockWipeKeys.mockImplementation(async () => {
    order.push("keys");
  });
  mockClearCaptureBuffer.mockImplementation(async () => {
    order.push("captureBuffer");
  });
  mockDeleteAttachments.mockImplementation(async () => {
    order.push("supportAttachments");
  });

  await wipeAndStartOver();

  expect(order).toEqual(["database", "keys", "captureBuffer", "supportAttachments"]);
});

test("a database wipe failure propagates and skips wiping the keys -- no half-wiped state", async () => {
  mockWipeDatabase.mockRejectedValueOnce(new Error("disk I/O error"));

  await expect(wipeAndStartOver()).rejects.toThrow("disk I/O error");
  expect(mockWipeKeys).not.toHaveBeenCalled();
});

test("a key-wipe failure still propagates rather than reporting a silent success", async () => {
  mockWipeKeys.mockRejectedValueOnce(new Error("secure store unavailable"));

  await expect(wipeAndStartOver()).rejects.toThrow("secure store unavailable");
});

test("a capture-buffer-clear failure still propagates rather than reporting a silent success", async () => {
  mockClearCaptureBuffer.mockRejectedValueOnce(new Error("filesystem error"));

  await expect(wipeAndStartOver()).rejects.toThrow("filesystem error");
});

test("requires no arguments and no prior authentication state -- callable in the unrecoverable state where nothing else works", async () => {
  await expect(wipeAndStartOver()).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// GAP-078 -- WHICH SIDE OF wipeDatabase() THE FAILURE FELL ON.
//
// The four tests above pin that every failure propagates. These pin that a
// caller can tell the two KINDS apart, which is what contexts/lock_context.tsx
// needs in order to answer them oppositely: a wipeDatabase() failure destroyed
// nothing, so the user stays on the recovery screen with their phrase still
// usable; anything after it leaves a device whose database file is already
// deleted, so the recovery screen is a dead end and the user must be moved on
// to onboarding. That context's own suite mocks this module, so these are the
// only tests that hold the real function to the contract it mocks.
// ---------------------------------------------------------------------------

/** The rejection, or `null` for a resolve -- one call, so a `*Once` mock in a
 *  test above cannot be silently consumed by a second invocation. */
async function rejectionFrom(promise: Promise<void>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

test("a database wipe failure is NOT a WipeIncompleteError -- nothing was destroyed, and a caller must not be told otherwise", async () => {
  const cause = new Error("disk I/O error");
  mockWipeDatabase.mockRejectedValueOnce(cause);

  const thrown = await rejectionFrom(wipeAndStartOver());

  // The discriminating assertion. If this function wrapped indiscriminately,
  // lock_context would move a user with a perfectly intact database off the
  // one screen that can still open it.
  expect(thrown).not.toBeInstanceOf(WipeIncompleteError);
  expect(thrown).toBe(cause);
});

test("a key-wipe failure IS a WipeIncompleteError -- the database file is already gone", async () => {
  const cause = new Error("secure store unavailable");
  mockWipeKeys.mockRejectedValueOnce(cause);

  const thrown = await rejectionFrom(wipeAndStartOver());

  expect(thrown).toBeInstanceOf(WipeIncompleteError);
  // The underlying reason is carried, not replaced: this type adds WHERE the
  // sequence stopped, never a new description of what went wrong.
  expect(thrown).toHaveProperty("cause", cause);
});

test("a capture-buffer-clear failure IS a WipeIncompleteError too -- same side of the database wipe", async () => {
  mockClearCaptureBuffer.mockRejectedValueOnce(new Error("filesystem error"));

  expect(await rejectionFrom(wipeAndStartOver())).toBeInstanceOf(WipeIncompleteError);
});
