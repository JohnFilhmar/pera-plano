// hooks/queries/use_provider_filter.ts — the capture scope the listener is
// actually applying (GAP-119).
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getProviderFilter } from "@/modules/notification_listener";

/**
 * A live native read of the provider allowlist and the deny-all flag — the
 * counterpart to `usePausedProviderPackages`, which reads the app's RECORD of
 * the same scope.
 *
 * TWO SOURCES, DELIBERATELY, exactly as `use_listener_health.ts` keeps the
 * live grant apart from the user's own switch. Conflating them here would
 * destroy the only signal this hook exists to produce: a Privacy centre that
 * shows a provider paused while the listener is still capturing from it.
 *
 * `retry: false` for the same reason that hook gives: a native bridge that
 * throws will throw again, and a rejection here means the honest answer is
 * "cannot tell" — which the caller renders as SILENCE, never as a mismatch.
 */
export function useProviderFilter() {
  return useQuery({
    queryKey: queryKeys.providerFilter.current(),
    retry: false,
    queryFn: () => getProviderFilter(),
  });
}
