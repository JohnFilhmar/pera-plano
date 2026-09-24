import path from "node:path";
import type { NextConfig } from "next";

/**
 * The policy is written against what this site actually serves, checked against a real
 * production build rather than guessed:
 *
 * - `script-src` carries `'unsafe-inline'` because every HTML response contains inline
 *   scripts that cannot be hashed. Two of them are Next's own streaming RSC payload
 *   (`self.__next_f.push(...)`), whose contents differ per page and per request, and the
 *   third is the theme bootstrap in app/layout.tsx. The alternative Next supports is a
 *   per-request nonce set from proxy.ts, and it costs more than it looks: Next only reads
 *   a nonce off the *request* headers during a dynamic render, so every route would have
 *   to opt out of static rendering (`await connection()`), and `/` and `/_not-found`,
 *   which are prerendered, would serve HTML whose inline scripts no longer match the
 *   header. That is the upgrade path if this site ever renders untrusted HTML; today it
 *   renders none, so the cheaper policy is the honest one.
 * - `style-src` carries `'unsafe-inline'` for the same reason on the style side: motion
 *   emits `style="opacity:1;transform:none"` on ~29 elements of the marketing page during
 *   SSR, and the reveal components set `--reveal-delay` as an inline custom property.
 *   Narrowing this to `style-src-attr` would drop content that is only visible because of
 *   those attributes on any browser that does not implement the CSP3 directive.
 * - No `upgrade-insecure-requests`. This site is deployed HTTP-only until `certbot --nginx`
 *   rewrites the vhost (see docs/nginx/peraplano-production.conf); the directive would
 *   upgrade the page's own same-origin subresources to an https:// port that is not
 *   listening yet and take the site down for the length of that window. HSTS covers the
 *   same ground once the certificate exists.
 * - Everything else is closed. `form-action 'self'` is the directive that matters most
 *   here: the beta form is the one place a visitor hands over an email, and it stops an
 *   injected form from posting that email anywhere but our own route. `frame-ancestors`
 *   stops the framed copy of the page that would harvest the same field by overlay.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
].join("; ");

/**
 * One day, not one year, deliberately. Nothing has been served over TLS yet: the vhost is
 * HTTP-only until certbot runs, so the first visitors to pin this are pinning a
 * certificate whose renewal has never been observed to work. A year is unrecoverable if it
 * does not; a day costs one day. Raise this to 31536000 once renewal has run unattended at
 * least once, and only then consider `preload`, which cannot be undone at all.
 */
const STRICT_TRANSPORT_SECURITY = "max-age=86400; includeSubDomains";

/**
 * Set here rather than in proxy.ts or in nginx, on purpose.
 *
 * proxy.ts runs per request on the Edge runtime and its own comment argues for keeping it
 * to the one thing it has to do; none of these values vary per request, so nothing is
 * bought by computing them there, and its matcher excludes /_next/static, which is exactly
 * where `nosniff` still earns its keep. nginx is not the place either: the vhost is a
 * reference file the box's other sites do not share, `add_header` there would be a second
 * copy of the policy that drifts from this one, and its `location /_next/static/` block
 * already has an `add_header`, which under nginx's inheritance rules would silently drop
 * any server-level header from that location.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The site is a public compliance surface; advertising the framework version buys
  // an attacker a version-specific exploit list and buys us nothing.
  poweredByHeader: false,
  output: "standalone",
  // Tracing must see the whole npm workspace, not just apps/web, or the standalone
  // bundle ships without the hoisted node_modules and without @peraplano/common.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@peraplano/common"],
  // Not `async`: there is nothing to await, and the type only asks for a promise.
  headers() {
    // `/:path*` matches the root as well as every nested path, so the redirect at `/`,
    // the API routes and the build assets under /_next/ all carry the set.
    return Promise.resolve([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  },
};

export default nextConfig;
