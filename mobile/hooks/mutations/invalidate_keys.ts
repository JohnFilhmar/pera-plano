// hooks/mutations/invalidate_keys.ts — m1c plan Task 3, Rule 2.
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Invalidates exactly the keys it is given, and returns a promise every caller
 * hands back from `onSuccess` so the mutation stays pending until the screens
 * it affects are actually fresh.
 *
 * THE POINT IS THE ARGUMENT. `queryClient.invalidateQueries()` with no filter
 * matches every query in the cache, so one incoming notification makes every
 * screen in the app refetch — on a mid-range phone that is visible jank at the
 * exact moment the user is watching a balance move. Every mutation in this
 * directory goes through here with a named key set from
 * constants/query_keys.ts, which makes a keyless invalidation a thing you have
 * to go out of your way to write.
 */
export function invalidateKeys(client: QueryClient, keys: readonly QueryKey[]): Promise<void> {
  return Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}
