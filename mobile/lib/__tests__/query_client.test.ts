// lib/__tests__/query_client.test.ts — every default asserted individually
// against the exact STACK_BASIS §6 numbers, especially `mutations.retry: 0`.
// React Query's own default for mutations is already 0, which is exactly why
// this is easy to leave unset and easy for someone later to "improve" by
// adding retries uniformly — a retried mutation double-writes (a duplicate
// ledger transaction, a goal contribution applied twice, a loan payment
// recorded twice). This suite asserts each value, not just "is a number", so
// a millisecond typo or a dropped option fails a specific, named test.
import { persistOptions, queryClient } from "../query_client";

describe("query defaults match STACK_BASIS §6", () => {
  const queries = queryClient.getDefaultOptions().queries;

  test("staleTime is exactly 5 minutes in milliseconds", () => {
    expect(queries?.staleTime).toBe(5 * 60 * 1000);
  });

  test("gcTime is exactly 30 minutes in milliseconds", () => {
    expect(queries?.gcTime).toBe(30 * 60 * 1000);
  });

  test("retry is exactly 3", () => {
    expect(queries?.retry).toBe(3);
  });

  test("refetchOnWindowFocus is false", () => {
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });

  test("refetchOnReconnect is true", () => {
    expect(queries?.refetchOnReconnect).toBe(true);
  });
});

test("mutations.retry is exactly 0 — a retried mutation double-writes the ledger", () => {
  expect(queryClient.getDefaultOptions().mutations?.retry).toBe(0);
});

describe("persistOptions", () => {
  test("maxAge is Infinity — this app has no login, so the on-disk cache is never age-expired", () => {
    expect(persistOptions.maxAge).toBe(Infinity);
  });

  test("buster is a non-empty version string for cache-shape breaks", () => {
    expect(typeof persistOptions.buster).toBe("string");
    expect(persistOptions.buster.length).toBeGreaterThan(0);
  });

  test("persister implements the Persister contract", () => {
    expect(typeof persistOptions.persister.persistClient).toBe("function");
    expect(typeof persistOptions.persister.restoreClient).toBe("function");
    expect(typeof persistOptions.persister.removeClient).toBe("function");
  });
});
