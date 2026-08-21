import type { MetadataRoute } from "next";
import { getConfig } from "@peraplano/common";

// Dynamic for the same reason as the locale layout: PUBLIC_BASE_URL is a runtime value,
// and a prerendered robots.txt would bake whatever the build host happened to have.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    // Every page here exists to be found — by a person, by a Play reviewer, by a crawler.
    // There is nothing on this site to hide from an index, and a compliance page a
    // regulator cannot search for is a compliance page that is not published.
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${getConfig().publicBaseUrl}/sitemap.xml`,
  };
}
