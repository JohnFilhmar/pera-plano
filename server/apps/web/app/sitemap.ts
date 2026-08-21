import type { MetadataRoute } from "next";
import { getConfig } from "@peraplano/common";
import { SUPPORTED_LOCALES } from "@/messages/index";

export const dynamic = "force-dynamic";

/**
 * The same six paths the header and footer link, for every supported locale. Kept as a
 * literal list rather than derived from NAV_ITEMS on purpose: NAV_ITEMS is a navigation
 * concern and could reasonably gain a link that is not its own page (an anchor, an
 * external policy), whereas this file must only ever name real, indexable routes.
 * __tests__/structure.test.ts asserts the route inventory those six describe.
 */
const PATHS = ["", "/support", "/privacy", "/terms", "/installed-apps", "/data-deletion"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getConfig().publicBaseUrl;
  const lastModified = new Date();
  return SUPPORTED_LOCALES.flatMap((locale) =>
    PATHS.map((path) => ({
      url: `${base}/${locale}${path}`,
      lastModified,
      changeFrequency: "monthly" as const,
      // The home page is the entry point; the legal pages are the reason the site exists,
      // so nothing here is deprioritised below the marketing page by much.
      priority: path === "" ? 1 : 0.8,
    })),
  );
}
