// hooks/queries/use_categories.ts — m1c plan Task 3.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listCategories } from "@/lib/db/repos/categories_repo";

/**
 * Every visible category, parents before children, siblings name-ascending —
 * the order the category picker renders in. Hidden categories are excluded:
 * hiding is the model's archival mechanism for categories, and a hidden one
 * must not come back as a pickable option.
 */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: () => listCategories(),
  });
}
