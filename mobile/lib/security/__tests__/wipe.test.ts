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

import { wipeDatabase } from "@/lib/db/database";
import { wipeKeys } from "@/lib/crypto/key_manager";
import { wipeAndStartOver } from "../wipe";

const mockWipeDatabase = wipeDatabase as jest.Mock;
const mockWipeKeys = wipeKeys as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockWipeDatabase.mockResolvedValue(undefined);
  mockWipeKeys.mockResolvedValue(undefined);
});

test("wipes both the database and the key material", async () => {
  await wipeAndStartOver();

  expect(mockWipeDatabase).toHaveBeenCalledTimes(1);
  expect(mockWipeKeys).toHaveBeenCalledTimes(1);
});

test("wipes the database BEFORE the keys -- a database wipe failure must leave the wraps intact, not orphan an unwipeable file with no key left to ever prove it happened", async () => {
  const order: string[] = [];
  mockWipeDatabase.mockImplementation(async () => {
    order.push("database");
  });
  mockWipeKeys.mockImplementation(async () => {
    order.push("keys");
  });

  await wipeAndStartOver();

  expect(order).toEqual(["database", "keys"]);
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

test("requires no arguments and no prior authentication state -- callable in the unrecoverable state where nothing else works", async () => {
  await expect(wipeAndStartOver()).resolves.toBeUndefined();
});
